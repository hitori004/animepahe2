# backend/crawler.py
"""
AnimePahe Crawler: Scraping-Logik fuer die neue Webanwendung.
Basierend auf dem alten AnimePaheStreamer-Code.
"""
import requests
import re
import jsbeautifier
import time
import logging
from urllib.parse import quote_plus, urlparse
from bs4 import BeautifulSoup
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import NoSuchElementException, TimeoutException
import undetected_chromedriver as uc
from tenacity import retry, stop_after_attempt, wait_exponential_jitter

# --- NEU: Import fuer das Cachen von Bildern ---
# Importiere die cache_image Funktion aus der neuen utils.py
from .utils import cache_image
# --- ENDE: Import fuer das Cachen von Bildern ---

from .config import CONFIG
# from .utils import clean_title, get_image_cache_path # Diese kommen jetzt aus utils.py
from .utils import clean_title # clean_title bleibt hier, da es spezifisch fuer den Crawler ist
# get_image_cache_path wird durch cache_image ersetzt

logger = logging.getLogger(__name__)

# Rate Limiter (vereinfacht)
class RateLimiter:
    def __init__(self, max_per_second: int):
        self.max_per_second = max_per_second
        self.last_call = 0

    def wait(self):
        elapsed = time.time() - self.last_call
        if elapsed < 1.0 / self.max_per_second:
            time.sleep(1.0 / self.max_per_second - elapsed)
        self.last_call = time.time()

jikan_rate_limiter = RateLimiter(max_per_second=1)
animepahe_rate_limiter = RateLimiter(max_per_second=3)

class AnimePaheCrawler:
    """Hauptklasse fuer das Scraping und Abrufen von Anime-Daten von AnimePahe."""
    def __init__(self):
        self.base_url = CONFIG["ANIMEPAHE_BASE_URL"]
        self.api_url = f"{self.base_url}/api"
        self.cookies = None
        self.driver = None
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': CONFIG["DEFAULT_USER_AGENT"],
            'Referer': self.base_url
        })

    def get_site_cookies(self):
        """Holt die notwendigen Cookies, um Cloudflare zu umgehen."""
        logger.info("Hole Cookies von AnimePahe...")
        options = uc.ChromeOptions()
        options.headless = True
        options.add_argument("--disable-blink-features=AutomationControlled")
        # Aendern Sie dies, falls noetig
        chrome_version_main = 138
        
        try:
            self.driver = uc.Chrome(version_main=chrome_version_main, options=options)
            self.driver.get(self.base_url)
            retries = 3
            while retries > 0:
                try:
                    WebDriverWait(self.driver, 20).until(
                        EC.presence_of_element_located((By.XPATH, '//img[@alt="AnimePahe"]'))
                    )
                    break
                except (NoSuchElementException, TimeoutException):
                    logger.warning(f"Warte auf das Laden der Seite... ({4 - retries} Versuche verbleiben)")
                    time.sleep(5)
                    retries -= 1
            if retries == 0:
                raise Exception("Fehler beim Umgehen des Cloudflare-Schutzes oder Laden der Startseite")
                
            self.cookies = {c['name']: c['value'] for c in self.driver.get_cookies()}
            self.session.cookies.update(self.cookies)
            logger.info("Cookies erfolgreich geholt.")
        finally:
            if self.driver:
                self.driver.quit()
                self.driver = None

    # --- AnimePahe Suche und Details ---
    @retry(stop=stop_after_attempt(3), wait=wait_exponential_jitter(initial=1, max=10))
    def search_anime_pahe(self, query: str) -> list[dict]:
        """Sucht auf AnimePahe nach einem Anime."""
        params = {'m': 'search', 'q': quote_plus(query)}
        animepahe_rate_limiter.wait()
        response = self.session.get(self.api_url, params=params)
        response.raise_for_status()
        results = response.json().get('data', [])
        return [{'title': clean_title(anime['title']), 'session': anime['session'], 'source': 'pahe'} for anime in results]

    def search_anime(self, query: str) -> list[dict]:
        """Sucht auf AnimePahe nach einem Anime."""
        return self.search_anime_pahe(query)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential_jitter(initial=1, max=10))
    def get_all_anime(self) -> list[dict]:
        """Holt die Liste aller Animes von AnimePahe."""
        url = f"{self.base_url}/anime"
        animepahe_rate_limiter.wait()
        response = self.session.get(url)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        anime_list = []
        nav_container = soup.find("div", class_="scrollable-ul")
        if nav_container:
            nav_links = nav_container.find_all("a")
            for link in nav_links:
                tab_id = link.get("href").lstrip("#")
                tab_pane = soup.find("div", id=tab_id)
                if tab_pane:
                    anime_links = tab_pane.find_all("a", href=True)
                    for a in anime_links:
                        href = a.get("href")
                        title = a.get("title") or a.get_text(strip=True)
                        if href and href.startswith("/anime/") and title:
                            session = href.split("/anime/")[-1]
                            anime_list.append({"title": clean_title(title), 'session': session, 'source': 'pahe'})
        return anime_list

    # --- NEU: Methode fuer CacheBuilder ---
    def get_all_session_ids(self) -> list[str]:
        """
        Liefert eine Liste aller Session-IDs von AnimePahe,
        damit der CacheBuilder weiss, welche Animes gecached werden sollen.
        """
        try:
            anime_list = self.get_all_anime()
            session_ids = [anime['session'] for anime in anime_list]
            logger.info(f"{len(session_ids)} Session-IDs vom Crawler geladen.")
            return session_ids
        except Exception as e:
            logger.error(f"Fehler beim Abrufen der Session-IDs vom Crawler: {e}")
            return []

    # --- Episoden ---
    @retry(stop=stop_after_attempt(3), wait=wait_exponential_jitter(initial=1, max=10))
    def _fetch_all_episodes(self, anime_id: str) -> list[dict]:
        """Holt alle Episoden fuer einen Anime von AnimePahe."""
        episodes = []
        page = 1
        last_page = 1
        while page <= last_page:
            params = {'m': 'release', 'id': anime_id, 'sort': 'episode_asc', 'page': page}
            animepahe_rate_limiter.wait()
            response = self.session.get(self.api_url, params=params)
            response.raise_for_status()
            data = response.json()
            last_page = data.get('last_page', 1)
            episodes.extend(data.get('data', []))
            page += 1
        return sorted(episodes, key=lambda x: float(x['episode']))

    def fetch_episodes(self, anime: dict) -> list[dict]:
        """Holt Episoden fuer einen Anime von AnimePahe."""
        if anime['source'] == 'pahe':
            episodes = self._fetch_all_episodes(anime['session'])
            for ep in episodes:
                ep['source'] = 'pahe'
            return episodes
        else:
            raise ValueError("Unbekannte Quelle")

    # --- Stream URLs ---
    @retry(stop=stop_after_attempt(3), wait=wait_exponential_jitter(initial=1, max=10))
    def get_stream_url(self, episode_url: str) -> str:
        """Extrahiert die m3u8-Stream-URL von einer AnimePahe-Episoden-URL."""
        episode_data = self._parse_episode_url(episode_url)
        kwik_links = self._get_kwik_links(episode_data)
        if not kwik_links:
            raise ValueError("Keine abspielbaren Links gefunden")
        best_res = max(kwik_links.keys(), key=lambda x: int(x))
        return self._extract_m3u8(kwik_links[best_res]['kwik'])

    def _get_kwik_links(self, episode_data: dict) -> dict:
        """Holt die Kwik-Links fuer verschiedene Aufloesungen."""
        url = f"{self.base_url}/play/{episode_data['anime_id']}/{episode_data['session_id']}"
        animepahe_rate_limiter.wait()
        response = self.session.get(url)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        links = {}
        for btn in soup.select('div#resolutionMenu button'):
            if btn.get('data-audio') != 'eng': # Nur nicht-englische Audio
                links[btn['data-resolution']] = {'kwik': btn['data-src'], 'audio': btn['data-audio']}
        return links

    def _extract_m3u8(self, kwik_url: str) -> str:
        """Extrahiert die m3u8-URL aus der Kwik-Seite."""
        response = self.session.get(kwik_url, headers={'Referer': self.base_url})
        response.raise_for_status()
        match = re.search(r';eval\(.*\)', response.text)
        if not match:
            raise ValueError("Fehler beim Finden des Videoplayer-Codes")
        beautified = jsbeautifier.beautify(match.group(0).replace('\\', ''))
        m3u8_match = re.search(r'https?://[^\s\'"]+\.m3u8', beautified) # Robusterer Regex
        if not m3u8_match:
            raise ValueError("Fehler beim Extrahieren der Video-Stream-URL")
        return m3u8_match.group(0)

    def _parse_episode_url(self, url: str) -> dict:
        """Parst eine AnimePahe-Episoden-URL."""
        parsed = urlparse(url)
        if not parsed.path.startswith('/play/'):
            raise ValueError("Ungueltige AnimePahe-Episoden-URL")
        path_parts = parsed.path.split('/')
        return {'anime_id': path_parts[-2], 'session_id': path_parts[-1]}

    # --- Details abrufen und anreichern ---
    def get_details(self, anime: dict) -> dict:
        """
        Holt und verarbeitet die Details fuer einen Anime von AnimePahe.
        """
        source = anime['source']
        if source == 'pahe':
            identifier = anime['session']
            details = self._get_pahe_details(anime['session'])
        else:
            raise ValueError("Unbekannte Quelle")
            
        # Fuege source und identifier hinzu
        details["source"] = source
        details["identifier"] = identifier
        # Bereinige den Titel
        details["title"] = clean_title(details["title"])
        return details

    # --- Pahe Details Parsing (modularisiert) ---
    def _parse_pahe_title(self, soup: BeautifulSoup) -> str:
        """Extrahiert und bereinigt den Titel."""
        title_tag = soup.find("h1")
        return clean_title(title_tag.get_text(strip=True)) if title_tag else "Unknown"

    def _parse_pahe_synopsis(self, soup: BeautifulSoup) -> str:
        """Extrahiert die Synopsis/Info."""
        summary_div = soup.find("div", class_="tab-content anime-detail") or soup.find("div", class_="anime-info")
        return summary_div.decode_contents() if summary_div else "No summary available."

    def _parse_pahe_relations(self, soup: BeautifulSoup) -> str:
        """Extrahiert Beziehungen."""
        relations_div = soup.find(lambda tag: tag.name == "div" and tag.get("class") and "anime-relation" in " ".join(tag.get("class")))
        return relations_div.decode_contents() if relations_div else "No relations found."

    def _parse_pahe_recommendations(self, soup: BeautifulSoup) -> str:
        """Extrahiert Empfehlungen."""
        recommendations_div = soup.find(lambda tag: tag.name == "div" and tag.get("class") and "anime-recommendation" in " ".join(tag.get("class")))
        return recommendations_div.decode_contents() if recommendations_div else "No recommendations found."

    def _parse_pahe_genre(self, soup: BeautifulSoup) -> str:
        """Extrahiert das Genre."""
        genre_div = soup.find("div", class_="anime-genre")
        return ", ".join([li.get_text(strip=True) for li in genre_div.find_all("li")]) if genre_div else "N/A"

    def _parse_pahe_thumbnail(self, soup: BeautifulSoup) -> str | None:
        """Extrahiert die Thumbnail-URL."""
        poster_div = soup.find("div", class_="anime-poster")
        if poster_div and poster_div.find("img"):
            return poster_div.find("img").get("src") or poster_div.find("img").get("data-src")
        return None

    def _parse_pahe_info(self, soup: BeautifulSoup) -> tuple[str, str, str, str]:
        """Extrahiert Typ, Studio, Staffel und Jahr."""
        anime_type = "Unknown"
        studio = "N/A"
        season = "N/A"
        year = "N/A"
        info_div = soup.find("div", class_="anime-info")
        if info_div:
            for p in info_div.find_all("p"):
                text = p.get_text(strip=True)
                if "Type:" in text and p.find("a"):
                    anime_type = p.find("a").get_text(strip=True)
                if "Studio:" in text and p.find("a"):
                    studio = p.find("a").get_text(strip=True)
                if "Aired:" in text:
                    m = re.search(r'\b(\d{4})\b', text)
                    if m:
                        year = m.group(1)
                    m_month = re.search(r'(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)', text, re.IGNORECASE)
                    if m_month:
                        month = m_month.group(1).lower()
                        season = {"dec": "Winter", "jan": "Winter", "feb": "Winter",
                                  "mar": "Spring", "apr": "Spring", "may": "Spring",
                                  "jun": "Summer", "jul": "Summer", "aug": "Summer",
                                  "sep": "Fall", "oct": "Fall", "nov": "Fall"}.get(month, "N/A")
        return anime_type, studio, season, year

    @retry(stop=stop_after_attempt(3), wait=wait_exponential_jitter(initial=1, max=10))
    def _get_pahe_details(self, session: str) -> dict:
        """
        Holt die Details von einer AnimePahe-Seite.
        """
        url = f"{self.base_url}/anime/{session}"
        animepahe_rate_limiter.wait()
        response = self.session.get(url, timeout=10)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        title = self._parse_pahe_title(soup)
        synopsis = self._parse_pahe_synopsis(soup)
        relations = self._parse_pahe_relations(soup)
        recommendations = self._parse_pahe_recommendations(soup)
        genre = self._parse_pahe_genre(soup)
        
        # --- NEU: Thumbnail URL parsen und cachen ---
        thumbnail_url = self._parse_pahe_thumbnail(soup)
        logger.debug(f"Gefundene Thumbnail-URL fuer '{title}' (Session: {session}): {thumbnail_url}")

        # --- NEU: Bild cachen ---
        cached_filename = None
        if thumbnail_url:
            logger.debug(f"Starte Caching fuer Thumbnail von '{title}' (Session: {session})...")
            # Verwende die importierte cache_image Funktion
            cached_filename = cache_image(thumbnail_url)
            if cached_filename:
                logger.info(f"Thumbnail fuer '{title}' (Session: {session}) erfolgreich gecached: {cached_filename}")
                # WICHTIG: Pfad fuer das Frontend anpassen!
                thumbnail_to_store = f"/cached_images/{cached_filename}"
            else:
                logger.warning(f"Fehler beim Cachen des Thumbnails fuer '{title}' (Session: {session}) von {thumbnail_url}. Speichere Original-URL.")
                thumbnail_to_store = thumbnail_url
        else:
            logger.info(f"Keine Thumbnail-URL fuer '{title}' (Session: {session}) gefunden.")
            thumbnail_to_store = None
        # --- ENDE: Bild cachen ---

        anime_type, studio, season, year = self._parse_pahe_info(soup)
        
        return {
            "title": title, "synopsis": synopsis, "info": synopsis, "relations": relations,
            "recommendations": recommendations,
            "thumbnail": thumbnail_to_store,
            "genre": genre, "type": anime_type, "studio": studio, "season": season, "year": year
        }

# Globale Instanz
crawler = AnimePaheCrawler()
