import asyncio
import logging
import os
import requests
from threading import Event, Thread
import random
from .database import anime_cache_db
from .crawler import crawler
from .config import CONFIG

logger = logging.getLogger(__name__)

# Event zum Stoppen des Threads
_stop_event = Event()

class CacheBuilder:
    def __init__(self, interval_sec: int = CONFIG.get("CACHE_BUILDER_INTERVAL_SEC", 300)):
        self.interval_sec = interval_sec
        self._thread = Thread(target=self._run_loop_thread, daemon=True)

    def start(self):
        if not self._thread.is_alive():
            logger.info("Starte CacheBuilder Thread...")
            _stop_event.clear()
            self._thread = Thread(target=self._run_loop_thread, daemon=True)
            self._thread.start()

    def stop(self):
        logger.info("Stoppe CacheBuilder Thread...")
        _stop_event.set()
        self._thread.join()
        logger.info("CacheBuilder Thread gestoppt.")

    def _run_loop_thread(self):
        asyncio.run(self._run_loop_async())

    async def _run_loop_async(self):
        while not _stop_event.is_set():
            try:
                await self._build_cache_cycle()
            except Exception as e:
                logger.error(f"Fehler im CacheBuilder Zyklus: {e}", exc_info=True)
            await asyncio.sleep(self.interval_sec)

    async def _build_cache_cycle(self):
        logger.info("Starte Cache-Build Zyklus")

        cached_ids = anime_cache_db.get_cached_session_ids()
        logger.debug(f"{len(cached_ids)} Session-IDs im Cache gefunden: {cached_ids[:10]}")

        try:
            all_sessions = crawler.get_all_session_ids()
            logger.debug(f"{len(all_sessions)} Session-IDs vom Crawler insgesamt: {all_sessions[:10]}")
        except Exception as e:
            logger.error(f"Fehler beim Abrufen der Session-IDs vom Crawler: {e}")
            return

        # Bestimme welche fehlen
        missing_sessions = [s for s in all_sessions if s not in cached_ids]
        logger.info(f"{len(missing_sessions)} fehlende Session-IDs gefunden: {missing_sessions[:10]}")

        # Mische die Liste und logge die ersten 10 nach dem Mischen
        random.shuffle(missing_sessions)
        logger.debug(f"Nach Shuffle, erste 10 fehlende Session-IDs: {missing_sessions[:10]}")

        limit = CONFIG.get("CACHE_BUILDER_LIMIT_PER_CYCLE", 10)
        sessions_to_process = missing_sessions[:limit]

        if not sessions_to_process:
            logger.info("Keine neuen Session-IDs zu verarbeiten. Zyklus beendet.")
            return

        details_to_cache = []
        for session_id in sessions_to_process:
            anime_dict = {"source": "pahe", "session": session_id}
            try:
                details = crawler.get_details(anime_dict)
                if not details:
                    logger.warning(f"Details für Session {session_id} nicht gefunden.")
                    continue

                thumb_url = details.get("thumbnail")
                if thumb_url and not thumb_url.startswith("/cached_images/"):
                    # Prüfe, ob das Bild bereits lokal existiert
                    filename = os.path.basename(thumb_url.split("?")[0])
                    cache_dir = CONFIG.get("IMAGE_CACHE_DIR", "cached_images")
                    local_path = os.path.join(cache_dir, filename)
                    if os.path.exists(local_path):
                        logger.debug(f"Bild {filename} bereits vorhanden, überspringe Download.")
                        details["thumbnail"] = f"/cached_images/{filename}"
                    else:
                        self._cache_image(thumb_url)
                        # Wenn Download geglückt, setze auf /cached_images/... sonst behalte Original
                        if os.path.exists(os.path.join(cache_dir, filename)):
                            details["thumbnail"] = f"/cached_images/{filename}"
                        else:
                            logger.warning(f"Bild {filename} konnte nicht gecached werden, belasse Thumbnail als Original.")
                            details["thumbnail"] = thumb_url

                details["source"] = "pahe"
                details["identifier"] = session_id
                details["session"] = session_id  # Explizit sicherstellen, dass 'session' gesetzt ist
                logger.debug(f"Details für Session {session_id}: {details}")
                details_to_cache.append(details)
            except Exception as e:
                logger.error(f"Fehler beim Verarbeiten von Session {session_id}: {e}", exc_info=True)

        if details_to_cache:
            try:
                anime_cache_db.set_details_bulk(details_to_cache)
                logger.info(f"{len(details_to_cache)} Anime-Details zum Cache hinzugefügt.")
            except Exception as e:
                logger.error(f"Fehler beim Speichern der Details in der DB: {e}", exc_info=True)

        logger.info("Cache-Build Zyklus abgeschlossen.")

    def _cache_image(self, image_url: str):
        try:
            filename = os.path.basename(image_url.split("?")[0])
            cache_dir = CONFIG.get("IMAGE_CACHE_DIR", "cached_images")
            if not os.path.exists(cache_dir):
                os.makedirs(cache_dir)

            filepath = os.path.join(cache_dir, filename)
            if os.path.exists(filepath):
                logger.debug(f"Bild {filename} bereits gecached.")
                return

            logger.info(f"Lade Bild {filename} herunter...")
            resp = requests.get(image_url, timeout=15)
            resp.raise_for_status()

            with open(filepath, "wb") as f:
                f.write(resp.content)
            logger.info(f"Bild {filename} erfolgreich gecached.")
        except Exception as e:
            logger.error(f"Fehler beim Cachen des Bildes {image_url}: {e}", exc_info=True)

cache_builder = CacheBuilder()
