import sqlite3
import os
import logging
from typing import List, Dict, Optional
from .config import CONFIG

logger = logging.getLogger(__name__)

class AnimeCacheDB:
    def __init__(self, db_path: str = CONFIG.get("DB_PATH", "anime_cache.db")):
        """Initialisiert die SQLite-Datenbank."""
        self.db_path = db_path
        self._init_db()
        logger.info(f"Datenbank initialisiert unter: {self.db_path}")

    def _init_db(self):
        """Erstellt die Datenbanktabellen, falls sie nicht existieren."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS anime_cache (
                        session TEXT PRIMARY KEY,
                        title TEXT,
                        thumbnail TEXT,
                        type TEXT,
                        genre TEXT,
                        studio TEXT,
                        year TEXT,
                        synopsis TEXT,
                        info TEXT,
                        source TEXT,
                        identifier TEXT
                    )
                """)
                conn.commit()
                logger.debug("Datenbanktabellen erfolgreich erstellt oder überprüft.")
        except sqlite3.Error as e:
            logger.error(f"Fehler beim Initialisieren der Datenbank: {e}")
            raise

    def _build_thumbnail_url(self, thumb_input: Optional[str]) -> Optional[str]:
        """Erstellt eine Thumbnail-URL basierend auf dem Input, prüft lokale Existenz."""
        if not thumb_input:
            return None
        # Extrahiere den Basenamen (z. B. 'xxx.png' aus '/cached_images/xxx.png' oder voller URL)
        basename = os.path.basename(thumb_input)
        cache_dir = CONFIG.get("IMAGE_CACHE_DIR", "cached_images")
        local_path = os.path.join(cache_dir, basename)
        if os.path.exists(local_path):
            return f"/cached_images/{basename}"
        logger.warning(f"Thumbnail-Datei {local_path} nicht im Cache gefunden. Rückgabe der Original-URL falls vorhanden.")
        # Wenn das Original eine URL oder relative Pfad ist, gib es zurück — besser für das Frontend
        if isinstance(thumb_input, str) and (thumb_input.startswith("http") or thumb_input.startswith("/")):
            return thumb_input
        return None

    def set_details_bulk(self, anime_details: List[Dict]):
        """Speichert eine Liste von Anime-Details in der Datenbank."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                inserted_count = 0
                for anime in anime_details:
                    session_id = anime.get('session')
                    if not session_id:
                        logger.error(f"Keine Session-ID für Anime {anime.get('title')} gefunden. Überspringe Eintrag: {anime}")
                        continue
                    logger.debug(f"Speichere Anime: session={session_id}, title={anime.get('title')}, thumbnail={anime.get('thumbnail')}, identifier={anime.get('identifier')}")
                    cursor.execute("""
                        INSERT OR REPLACE INTO anime_cache (
                            session, title, thumbnail, type, genre, studio, year, synopsis, info, source, identifier
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        session_id,
                        anime.get("title"),
                        self._build_thumbnail_url(anime.get("thumbnail")),
                        anime.get("type"),
                        anime.get("genre"),
                        anime.get("studio"),
                        anime.get("year"),
                        anime.get("synopsis"),
                        anime.get("info"),
                        anime.get("source", "pahe"),
                        anime.get("identifier")
                    ))
                    inserted_count += 1
                conn.commit()
                # Überprüfe, wie viele Einträge tatsächlich in der DB sind
                cursor.execute("SELECT COUNT(*) FROM anime_cache")
                count = cursor.fetchone()[0]
                cursor.execute("SELECT session, title, identifier FROM anime_cache LIMIT 5")
                sample_entries = cursor.fetchall()
                logger.info(f"{inserted_count} Anime-Details erfolgreich in die Datenbank eingefügt. Gesamtanzahl Einträge: {count}")
                logger.debug(f"Beispielhafte Einträge: {sample_entries}")
        except sqlite3.Error as e:
            logger.error(f"Fehler beim Speichern der Anime-Details: {e}")
            raise

    def search_cached_anime(self, query: str, type_filter: str, genre_filter: str, studio_filter: str, year_filter: str) -> List[Dict]:
        """Sucht im Cache nach Anime basierend auf dem Suchbegriff und Filtern."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                sql = """
                    SELECT session, title, thumbnail, type, genre, studio, year, synopsis, info, source, identifier
                    FROM anime_cache
                    WHERE 1=1
                """
                params = []
                if query:
                    sql += " AND title LIKE ?"
                    params.append(f"%{query}%")
                if type_filter and type_filter != "All":
                    sql += " AND type = ?"
                    params.append(type_filter)
                if genre_filter and genre_filter != "All":
                    sql += " AND genre LIKE ?"
                    params.append(f"%{genre_filter}%")
                if studio_filter and studio_filter != "All":
                    sql += " AND studio = ?"
                    params.append(studio_filter)
                if year_filter and year_filter != "All":
                    sql += " AND year = ?"
                    params.append(year_filter)

                cursor.execute(sql, params)
                rows = cursor.fetchall()
                results = [
                    {
                        "session": row[0],
                        "title": row[1],
                        "thumbnail": row[2],
                        "type": row[3],
                        "genre": row[4],
                        "studio": row[5],
                        "year": row[6],
                        "synopsis": row[7],
                        "info": row[8],
                        "source": row[9],
                        "identifier": row[10]
                    } for row in rows
                ]
                logger.debug(f"Cache-Suche ergab {len(results)} Ergebnisse für Abfrage: {query}")
                return results
        except sqlite3.Error as e:
            logger.error(f"Fehler bei der Cache-Suche: {e}")
            raise

    def get_unique_filters(self) -> Dict:
        """Gibt eindeutige Filteroptionen zurück (Typen, Genres, Studios, Jahre)."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                filters = {
                    "types": ["All"],
                    "genres": ["All"],
                    "studios": ["All"],
                    "years": ["All"]
                }

                # Typen
                cursor.execute("SELECT DISTINCT type FROM anime_cache WHERE type IS NOT NULL")
                types = [row[0] for row in cursor.fetchall()]
                filters["types"].extend(sorted(types))

                # Genres (zerlegt kommaseparierte Genres)
                cursor.execute("SELECT DISTINCT genre FROM anime_cache WHERE genre IS NOT NULL")
                genres = set()
                for row in cursor.fetchall():
                    if row[0]:
                        genres.update(g.strip() for g in row[0].split(","))
                filters["genres"].extend(sorted(genres))

                # Studios
                cursor.execute("SELECT DISTINCT studio FROM anime_cache WHERE studio IS NOT NULL")
                studios = [row[0] for row in cursor.fetchall()]
                filters["studios"].extend(sorted(studios))

                # Jahre
                cursor.execute("SELECT DISTINCT year FROM anime_cache WHERE year IS NOT NULL")
                years = [row[0] for row in cursor.fetchall()]
                filters["years"].extend(sorted(years, reverse=True))

                logger.debug(f"Filteroptionen abgerufen: {filters}")
                return filters
        except sqlite3.Error as e:
            logger.error(f"Fehler beim Abrufen der Filteroptionen: {e}")
            raise

    def get_cached_session_ids(self) -> List[str]:
        """Gibt alle gespeicherten Session-IDs zurück."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT session FROM anime_cache WHERE session IS NOT NULL")
                session_ids = [row[0] for row in cursor.fetchall()]
                logger.debug(f"{len(session_ids)} Session-IDs im Cache gefunden: {session_ids[:10]}")
                if not session_ids:
                    cursor.execute("SELECT session, title, identifier FROM anime_cache LIMIT 5")
                    sample_entries = cursor.fetchall()
                    cursor.execute("SELECT COUNT(*) FROM anime_cache WHERE session IS NULL")
                    null_count = cursor.fetchone()[0]
                    logger.warning(f"Keine Session-IDs gefunden. Beispielhafte Einträge: {sample_entries}, Anzahl NULL-Session-Einträge: {null_count}")
                return session_ids
        except sqlite3.Error as e:
            logger.error(f"Fehler beim Abrufen der Session-IDs: {e}")
            raise

    def clear_cache(self):
        """Löscht alle Daten aus der Datenbank."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM anime_cache")
                conn.commit()
                logger.info("Anime-Cache erfolgreich gelöscht.")
        except sqlite3.Error as e:
            logger.error(f"Fehler beim Löschen des Caches: {e}")
            raise

# Instanz der Datenbank erstellen
anime_cache_db = AnimeCacheDB()
