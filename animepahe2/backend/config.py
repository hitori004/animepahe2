# backend/config.py
import os

# Basis-Konfiguration
CONFIG = {
    "IMAGE_CACHE_DIR": "cached_images",
    "DATABASE_PATH": "anime_cache.db",
    "PAGE_SIZE": 20,
    "BATCH_SIZE": 100,
    "MAX_WORKER_THREADS": 5,
    "IMAGE_CACHE_MAX_WORKERS": 5,
    "ANILIST_API_URL": "https://graphql.anilist.co",
    "JIKAN_API_BASE_URL": "https://api.jikan.moe/v4",
    "ANIMEPAHE_BASE_URL": "https://animepahe.ru",
    "DEFAULT_USER_AGENT": 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    "DEFAULT_IMAGE_SIZE": (200, 300),
    "LOGGING_LEVEL": "INFO",  # Wird später in logging konvertiert
    "PLAYER_COMMAND": ["mpv"],
    "BACKGROUND_CACHE_INTERVAL_MS": 30000,       # 30 Sekunden, falls du das brauchst
    "BACKGROUND_CACHE_BATCH_SIZE": 5,            # Anzahl der Animes pro Batch
    "PROACTIVE_CACHE_INTERVAL_MS": 120000,       # 2 Minuten (120.000 ms)
    # Für den CacheBuilder:
    "CACHE_BUILDER_INTERVAL_SEC": 300,           # 5 Minuten
    "CACHE_BUILDER_LIMIT_PER_CYCLE": 100          # Wie viele fehlende Animes pro Zyklus verarbeitet werden
}

# Stelle sicher, dass das Cache-Verzeichnis existiert
if not os.path.exists(CONFIG["IMAGE_CACHE_DIR"]):
    os.makedirs(CONFIG["IMAGE_CACHE_DIR"])
