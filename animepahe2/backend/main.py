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
        api_results = []
        if q:
            logger.debug("Starte Suche auf AnimePahe-API...")
            api_results = crawler.search_anime(q)
            logger.debug(f"AnimePahe-API-Suche ergab {len(api_results)} Ergebnisse")
        
        logger.debug("Starte Suche im lokalen Cache...")
        db_results = anime_cache_db.search_cached_anime(q, type, genre, studio, year)
        logger.debug(f"Cache-Suche ergab {len(db_results)} Ergebnisse")
        
        merged_dict = {anime["session"]: anime for anime in db_results}
        for anime in api_results:
            session_id = anime.get("session")
            if session_id and session_id not in merged_dict:
                merged_dict[session_id] = anime
        
        merged_list = list(merged_dict.values())
        logger.info(f"Suche abgeschlossen. Insgesamt {len(merged_list)} eindeutige Ergebnisse.")
        return merged_list
    except Exception as e:
        logger.error(f"Fehler bei der Suche: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

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
            episode_url = f"{CONFIG['ANIMEPAHE_BASE_URL']}/play/{ep.session}/{ep.episode_session}"
            m3u8_url = crawler.get_stream_url(episode_url)
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
            episode_url = f"{CONFIG['ANIMEPAHE_BASE_URL']}/play/{ep.session}/{ep.episode_session}"
            m3u8_url = crawler.get_stream_url(episode_url)
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