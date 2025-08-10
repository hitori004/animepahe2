# backend/utils.py
"""
Utilities for the backend, including image caching and title cleaning.
This module contains functions adapted from the original Qt application.
"""
import os
import hashlib
import logging
import re
from io import BytesIO
from .config import CONFIG
# Importiere den globalen Crawler, um seine Session zu nutzen
# ACHTUNG: Um zirkulaere Imports zu vermeiden, erfolgt der Import erst spaeter im Code
# from .crawler import crawler 

logger = logging.getLogger(__name__)

# --- Funktion aus dem alten Code: clean_title ---
def clean_title(title: str) -> str:
    """
    Entfernt Duplikate aus dem Titel.
    Wenn der Titel aus zwei identischen Haelften besteht, wird eine zurueckgegeben.
    Args:
        title (str): Der zu bereinigende Titel.
    Returns:
        str: Der bereinigte Titel.
    """
    if not isinstance(title, str):
        logger.warning(f"clean_title erhielt einen Nicht-String-Wert: {title}")
        return str(title) if title is not None else ""
        
    title = title.strip()
    if not title:
        return title
        
    n = len(title)
    # Pruefe, ob die Laenge gerade ist und der Titel lang genug
    if n % 2 == 0 and n > 0:
        half = n // 2
        # Pruefe, ob die erste und die zweite Haelfte identisch sind
        if title[:half] == title[half:]:
            logger.debug(f"Duplikat im Titel erkannt und entfernt: '{title}' -> '{title[:half]}'")
            return title[:half] # Gib die erste Haelfte zurueck
    return title # Gib den urspruenglichen Titel zurueck, wenn keine Duplikate gefunden wurden
# --- ENDE: Funktion aus dem alten Code: clean_title ---


# --- NEU: Funktion fuer das Cachen von Bildern ---
def get_image_cache_path(url: str) -> str:
    """
    Erstellt den lokalen Dateipfad fuer ein gecachtes Bild basierend auf seiner URL.
    Args:
        url (str): Die URL des Bildes.
    Returns:
        str: Der lokale Dateipfad.
    """
    if not url:
        logger.warning("Leere URL fuer Bild-Cache-Pfad uebergeben.")
        return ""
    filename = hashlib.md5(url.encode('utf-8')).hexdigest() + ".png"
    return os.path.join(CONFIG["IMAGE_CACHE_DIR"], filename)

def cache_image(url: str) -> str | None:
    """
    Laedt ein Bild von einer URL herunter, verkleinert es und speichert es lokal.
    Verwendet die Session des globalen Crawlers, um Cloudflare/Cookies zu umgehen.
    Args:
        url (str): Die URL des Bildes.
    Returns:
        str | None: Der lokale Dateiname (z.B. 'abcd1234.png'), falls erfolgreich, sonst None.
                    Gibt None zurueck, wenn die URL ungueltig ist oder das Bild bereits existiert.
    """
    # 1. Validierung der Eingabe
    if not url or not isinstance(url, str) or not url.strip().startswith(("http://", "https://")):
        logger.warning(f"Ungueltige oder leere URL zum Cachen uebergeben: '{url}'")
        return None

    cleaned_url = url.strip()
    cached_path = get_image_cache_path(cleaned_url)

    # 2. Pruefen, ob das Bild bereits im Cache ist
    if os.path.exists(cached_path):
        logger.debug(f"Bild bereits im Cache vorhanden: {os.path.basename(cached_path)}")
        return os.path.basename(cached_path) # Gib nur den Dateinamen zurueck

    # 3. Herunterladen des Bildes
    try:
        logger.debug(f"Starte Download des Bildes von: {cleaned_url}")
        # WICHTIG: Verwende die Session des globalen Crawlers
        # Dies ist entscheidend, um die gleichen Cookies/Header zu haben und 403 zu vermeiden
        from .crawler import crawler # Import hier, um Zirkulaeritaet zu vermeiden
        if not hasattr(crawler, 'session'):
             logger.error("Crawler-Session ist nicht initialisiert. Kann Bild nicht cachen.")
             return None
             
        response = crawler.session.get(cleaned_url, timeout=15) # Erhoehtes Timeout
        response.raise_for_status() # Wirft eine Exception fuer schlechte Statuscodes (z.B. 403, 404)
        logger.debug(f"Bild-Download erfolgreich fuer: {cleaned_url}")

        # 4. Oeffnen und Verarbeiten des Bildes
        from PIL import Image as PILImage
        img = PILImage.open(BytesIO(response.content))
        img = img.convert("RGB") # Stelle sicher, dass es ein RGB-Bild ist (kein RGBA, CMYK etc.)

        # 5. Verkleinern des Bildes (Thumbnail)
        img.thumbnail(CONFIG["DEFAULT_IMAGE_SIZE"], PILImage.LANCZOS)
        logger.debug(f"Bild verkleinert auf: {img.size}")

        # 6. Speichern des Bildes im Cache-Verzeichnis
        img.save(cached_path, "PNG")
        logger.info(f"Bild erfolgreich heruntergeladen, verkleinert und gecached: {os.path.basename(cached_path)}")
        return os.path.basename(cached_path) # Gib nur den Dateinamen zurueck

    except Exception as e:
        logger.error(f"Kritischer Fehler beim Cachen des Bildes von {cleaned_url}: {e}", exc_info=True)
        # 7. Aufraeumen: Loesche eine moeglicherweise teilweise heruntergeladene/defekte Datei
        if os.path.exists(cached_path):
            try:
                os.remove(cached_path)
                logger.debug(f"Defekte oder unvollstaendige Cache-Datei geloescht: {os.path.basename(cached_path)}")
            except OSError as os_err:
                logger.warning(f"Fehler beim Loeschen der defekten Datei {os.path.basename(cached_path)}: {os_err}")
        return None

# --- Initialisierung ---
# Stelle sicher, dass das Cache-Verzeichnis existiert
cache_dir = CONFIG["IMAGE_CACHE_DIR"]
if not os.path.exists(cache_dir):
    try:
        os.makedirs(cache_dir)
        logger.info(f"Cache-Verzeichnis erstellt: {cache_dir}")
    except OSError as e:
        logger.error(f"Fehler beim Erstellen des Cache-Verzeichnisses '{cache_dir}': {e}")
else:
    logger.debug(f"Cache-Verzeichnis existiert bereits: {cache_dir}")
