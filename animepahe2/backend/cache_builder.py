import threading
import time
import logging
from .database import anime_cache_db
from .crawler import crawler
from .config import CONFIG
from .main import broadcast_cache_status
import os
import requests

logger = logging.getLogger(__name__)

class CacheBuilder:
    def __init__(self, interval_sec: int = CONFIG["CACHE_BUILDER_INTERVAL_SEC"]):
        self.interval_sec = interval_sec
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)

    def start(self):
        if not self._thread.is_alive():
            logger.info("Starte CacheBuilder Thread...")
            self._stop_event.clear()
            self._thread = threading.Thread(target=self._run_loop, daemon=True)
            self._thread.start()

    def stop(self):
        logger.info("Stoppe CacheBuilder Thread...")
        self._stop_event.set()
        self._thread.join()
        logger.info("CacheBuilder Thread gestoppt.")

    async def _run_loop(self):
        while not self._stop_event.is_set():
            try:
                await self._build_cache_cycle()
            except Exception as e:
                logger.error(f"Fehler im CacheBuilder Zyklus: {e}", exc_info=True)
            self._stop_event.wait(self.interval_sec)

    async def _build_cache_cycle(self):
        logger.info("Starte Cache-Build Zyklus")
        await broadcast_cache_status("Running")

        cached_ids = anime_cache_db.get_cached_session_ids()
        logger.debug(f"{len(cached_ids)} Session-IDs im Cache gefunden.")

        try:
            all_sessions = crawler.get_all_session_ids()
            logger.debug(f"{len(all_sessions)} Session-IDs vom Crawler insgesamt.")
        except Exception as e:
            logger.error(f"Fehler beim Abrufen der Session-IDs vom Crawler: {e}")
            await broadcast_cache_status("Error")
            return

        missing_sessions = [s for s in all_sessions if s not in cached_ids]
        logger.info(f"{len(missing_sessions)} fehlende Session-IDs gefunden.")

        limit = CONFIG.get("CACHE_BUILDER_LIMIT_PER_CYCLE", 10)
        sessions_to_process = missing_sessions[:limit]

        if not sessions_to_process:
            logger.info("Keine neuen Session-IDs zu verarbeiten. Zyklus beendet.")
            await broadcast_cache_status("Idle")
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
                if thumb_url:
                    self._cache_image(thumb_url)

                details["source"] = "pahe"
                details["identifier"] = session_id
                details_to_cache.append(details)
            except Exception as e:
                logger.error(f"Fehler beim Verarbeiten von Session {session_id}: {e}")

        if details_to_cache:
            try:
                anime_cache_db.set_details_bulk(details_to_cache)
                logger.info(f"{len(details_to_cache)} Anime-Details zum Cache hinzugefügt.")
                await broadcast_cache_status(f"Cached {len(details_to_cache)} items")
            except Exception as e:
                logger.error(f"Fehler beim Speichern der Details in der DB: {e}")
                await broadcast_cache_status("Error")

        logger.info("Cache-Build Zyklus abgeschlossen.")
        await broadcast_cache_status("Idle")

    def _cache_image(self, image_url: str):
        try:
            filename = os.path.basename(image_url.split("?")[0])
            cache_dir = CONFIG["IMAGE_CACHE_DIR"]
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
            logger.error(f"Fehler beim Cachen des Bildes {image_url}: {e}")

cache_builder = CacheBuilder()