# backend/main.py
import logging
from fastapi import FastAPI, HTTPException, Query, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from typing import List, Optional
from .cache_builder import cache_builder
import os
import subprocess
from .config import CONFIG
from .crawler import crawler
from .database import anime_cache_db
from .api_models import SearchQuery, AnimeListItem, AnimeDetails, Episode, FilterOptions, StreamUrlsRequest, StreamUrlResponse

logging.basicConfig(level=getattr(logging, CONFIG["LOGGING_LEVEL"]))
logger = logging.getLogger(__name__)

app = FastAPI(title="AnimePahe Streamer API - Schritt 4e")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# WebSocket clients for cache builder status
connected_clients = set()

@app.on_event("startup")
async def startup_event():
    logger.info("Backend-Server startet...")
    try:
        crawler.get_site_cookies()
        logger.info("Crawler initialisiert.")
    except Exception as e:
        logger.error(f"Fehler bei der Initialisierung des Crawlers: {e}", exc_info=True)
    cache_builder.start()
    logger.info("CacheBuilder gestartet.")
    logger.info("Backend-Server bereit.")

@app.get("/api/filters", response_model=FilterOptions)
async def get_filters():
    logger.info("Abrufen der Filteroptionen.")
    try:
        filters = anime_cache_db.get_unique_filters()
        logger.debug("Filteroptionen erfolgreich abgerufen.")
        return FilterOptions(**filters)
    except Exception as e:
        logger.error(f"Fehler beim Abrufen der Filter: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/search", response_model=List[AnimeListItem])
async def search_anime(
    q: str = Query(default="", description="Suchbegriff"),
    type: str = Query(default="All", description="Filter nach Typ"),
    genre: str = Query(default="All", description="Filter nach Genre"),
    studio: str = Query(default="All", description="Filter nach Studio"),
    year: str = Query(default="All", description="Filter nach Jahr")
):
    logger.info(f"Suche angefordert: q='{q}', type='{type}', genre='{genre}', studio='{studio}', year='{year}'")
    try:
        # 1) Zuerst: lokale DB abfragen (Cache-first)
        logger.debug("Starte lokale Cache-Suche...")
        db_results = anime_cache_db.search_cached_anime(q, type, genre, studio, year)
        logger.debug(f"Cache-Suche ergab {len(db_results)} Ergebnisse")

        # Wenn DB Treffer vorhanden, liefere diese sofort (Cache-first Verhalten)
        if db_results:
            logger.info(f"Returniere {len(db_results)} Ergebnisse aus lokalem Cache für q='{q}'")
            return db_results

        # 2) Wenn keine DB-Treffer und ein Query vorhanden ist, versuche Remote-Crawler
        api_results = []
        if q:
            logger.debug("Keine lokalen Treffer — versuche Crawler-Remote-Suche...")
            try:
                api_results = crawler.search_anime(q) or []
                logger.debug(f"Crawler lieferte {len(api_results)} Ergebnisse")
            except Exception as e:
                # Crawler-Fehler dürfen nicht zu 500 im Frontend führen — loggen und fallbacken
                logger.error(f"Crawler-Fehler bei Suche '{q}': {e}", exc_info=True)
                api_results = []

        # 3) Falls Remote Ergebnisse da sind, persistiere minimal in Cache und liefere DB-Ergebnisse zurück
        if api_results:
            # Normalisiere remote Ergebnisse in das minimale DB-Format
            normalized = []
            for r in api_results:
                session = r.get("session") or r.get("id") or r.get("identifier") or r.get("slug")
                title = r.get("title") or r.get("name") or "Unknown"
                normalized.append({
                    "session": session,
                    "title": title,
                    "thumbnail": r.get("thumbnail") or r.get("image"),
                    "type": r.get("type"),
                    "genre": r.get("genre") if isinstance(r.get("genre"), str) else (", ".join(r.get("genre")) if isinstance(r.get("genre"), (list, tuple)) else r.get("genre")),
                    "studio": r.get("studio"),
                    "year": r.get("year"),
                    "synopsis": r.get("synopsis") or r.get("info"),
                    "identifier": session,
                    "source": "pahe"
                })
            try:
                anime_cache_db.set_details_bulk(normalized)
            except Exception as e:
                logger.exception("Fehler beim Speichern der remote Ergebnisse in der DB (upsert), fahre trotzdem fort.")

            # Frage erneut aus DB (damit Format & thumbnails konsistent sind)
            try:
                db_results = anime_cache_db.search_cached_anime(q, type, genre, studio, year)
                logger.debug(f"Nach Persistierung: Cache-Suche ergab {len(db_results)} Ergebnisse")
                return db_results
            except Exception as e:
                logger.exception("Fehler beim erneuten Lesen der DB nach Persistierung, gebe remote results direkt zurück")
                # Fallback: entferne evtl. None/invalid Einträge und return
                return [ { "session": r.get("session"), "title": r.get("title") } for r in api_results ]

        # 4) Kein DB- und kein Remote-Result => leere Liste
        logger.info("Keine Ergebnisse gefunden (lokal und remote).")
        return []

    except Exception as e:
        # Sicherheitsnetz: sollte selten eintreten
        logger.error(f"Fehler bei der Suche: {e}", exc_info=True)
        # Liefere sauber 502 statt 500 mit Nachricht
        raise HTTPException(status_code=502, detail="Fehler bei der Suche (Upstream/Cache) — siehe Server-Logs")

@app.get("/api/anime/all")
async def get_all_cached_anime(page: int = Query(default=1, ge=1, description="Seite der Ergebnisse"), limit: int = Query(default=20, ge=1, le=100, description="Anzahl der Ergebnisse pro Seite")):
    """
    Liefert alle gecachten Animes (paginiert).
    Frontend nutzt das, wenn keine Suche / alle Filter = All sind.
    """
    try:
        # Verwende die DB-Suchfunktion ohne Filter, um alle Einträge zu erhalten
        all_results = anime_cache_db.search_cached_anime(query="", type_filter="All", genre_filter="All", studio_filter="All", year_filter="All")
        total = len(all_results)  # Gesamtzahl der Anime
        start = max(0, (page - 1) * limit)
        end = start + limit
        paged_results = all_results[start:end]
        logger.info(f"Returniere {len(paged_results)} gecachte Animes (page={page}, limit={limit}, total={total})")
        return {"results": paged_results, "total": total}
    except Exception as e:
        logger.exception(f"Fehler beim Abrufen aller gecachten Animes: {e}")
        raise HTTPException(status_code=500, detail=f"Fehler beim Abrufen der Anime: {str(e)}")

@app.get("/api/anime/{session}", response_model=AnimeDetails)
async def get_anime_details(session: str):
    logger.info(f"Abrufen der Details für Anime mit Session: {session}")
    try:
        anime = {"source": "pahe", "session": session}
        details = crawler.get_details(anime)
        if not details:
            raise HTTPException(status_code=404, detail="Anime not found")
        logger.info(f"Details für '{details['title']}' erfolgreich abgerufen.")
        details["source"] = "pahe"
        details["identifier"] = session
        return AnimeDetails(**details)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Fehler beim Abrufen der Details für Session {session}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/anime/{session}/episodes", response_model=List[Episode])
async def get_anime_episodes(session: str):
    logger.info(f"Abrufen der Episoden für Anime mit Session: {session}")
    try:
        anime = {"source": "pahe", "session": session}
        episodes = crawler.fetch_episodes(anime)
        if episodes is None:
            logger.info(f"Keine Episoden für Anime mit Session {session} gefunden.")
            episodes = []
        logger.info(f"Erfolgreich {len(episodes)} Episoden für Session {session} abgerufen.")
        
        corrected_episodes = []
        for ep in episodes:
            ep["source"] = "pahe"
            if "episode" in ep and not isinstance(ep["episode"], str):
                ep["episode"] = str(ep["episode"])
            corrected_episodes.append(ep)
            
        return [Episode(**ep) for ep in corrected_episodes]
    except Exception as e:
        logger.error(f"Fehler beim Abrufen der Episoden für Session {session}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/stream_urls", response_model=List[StreamUrlResponse])
async def get_stream_urls(request: StreamUrlsRequest):
    logger.info(f"Abrufen der Stream-URLs für {len(request.episodes)} Episoden")
    try:
        results = []
        for ep in request.episodes:
            m3u8_url = crawler.get_stream_url(ep.session, ep.episode_session)
            results.append({"title": f"Episode {ep.episode_session}", "m3u8_url": m3u8_url})
        return results
    except Exception as e:
        logger.error(f"Fehler beim Abrufen der Stream-URLs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/play_external")
async def play_external(request: StreamUrlsRequest):
    logger.info(f"Starte externen Player für {len(request.episodes)} Episoden")
    try:
        for ep in request.episodes:
            m3u8_url = crawler.get_stream_url(ep.session, ep.episode_session)
            player_cmd = CONFIG["PLAYER_COMMAND"] + [m3u8_url]
            subprocess.run(player_cmd, check=True)
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Fehler beim Starten des externen Players: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.websocket("/ws/cache_status")
async def cache_status_websocket(websocket: WebSocket):
    await websocket.accept()
    connected_clients.add(websocket)
    try:
        while True:
            await websocket.receive_text()  # Keep connection alive
    except Exception:
        connected_clients.remove(websocket)
        await websocket.close()

async def broadcast_cache_status(status: str):
    for client in connected_clients:
        try:
            await client.send_text(status)
        except Exception:
            connected_clients.remove(client)

cache_dir = CONFIG["IMAGE_CACHE_DIR"]
if os.path.exists(cache_dir):
    app.mount("/cached_images", StaticFiles(directory=cache_dir), name="cached_images")
    logger.info(f"Cache-Verzeichnis '{cache_dir}' für statische Dateien gemountet unter /cached_images")
else:
    logger.warning(f"Cache-Verzeichnis '{cache_dir}' existiert nicht. Bilder können nicht serviert werden.")

frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
    logger.info(f"Frontend bereitgestellt von: {frontend_dir}")
else:
    logger.warning(f"Frontend-Verzeichnis nicht gefunden unter {frontend_dir}. Statische Dateien werden nicht serviert.")

@app.on_event("shutdown")
async def shutdown_event():
    cache_builder.stop()
    logger.info("CacheBuilder gestoppt.")