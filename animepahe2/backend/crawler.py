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
import random
from urllib.parse import quote_plus, urlparse
from bs4 import BeautifulSoup
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import NoSuchElementException, TimeoutException
import undetected_chromedriver as uc
from tenacity import retry, stop_after_attempt, wait_exponential_jitter

from .utils import cache_image, clean_title
from .config import CONFIG

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
    def __init__(self):
        self.base_url = CONFIG.get("ANIMEPAHE_BASE_URL", "https://animepahe.ru")
        self.api_url = f"{self.base_url}/api"
        self.cookies = None
        self.driver = None
        self.session = requests.Session()
        # Setze sinnvolle Defaults; erlaubt Override via CONFIG
        self.session.headers.update({
            'User-Agent': CONFIG.get("DEFAULT_USER_AGENT", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"),
            'Referer': self.base_url,
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'Accept-Language': 'en-US,en;q=0.9'
        })

    def get_site_cookies(self):
        """
        Versucht, die Seite mit undetected_chromedriver zu laden und Cookies zu extrahieren.
        Diese Cookies werden dann in self.session gesetzt, damit subsequent requests
        seltener auf Blocker (Cloudflare) treffen.
        """
        logger.info("Hole Cookies von AnimePahe...")
        options = uc.ChromeOptions()
        options.headless = True
        options.add_argument("--disable-blink-features=AutomationControlled")
        # Mögliches Flag für Chromedriver - passe ggf. an
        chrome_version_main = CONFIG.get("CHROME_VERSION_MAIN", 138)
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
            # Merge Cookies into requests.Session
            self.session.cookies.update(self.cookies)
            logger.info(f"Cookies erfolgreich geholt: {list(self.cookies.keys())}")
        finally:
            if self.driver:
                self.driver.quit()
                self.driver = None

    # tenacity retry bleibt, aber wir behandeln 403 explizit, damit keine endlosen Retries entstehen
    @retry(stop=stop_after_attempt(3), wait=wait_exponential_jitter(initial=1, max=10))
    def search_anime_pahe(self, query: str) -> list[dict]:
        """
        Ruft die AnimePahe-API (/api?m=search&q=...) ab und gibt eine Liste von dicts zurück.
        Besonderheiten:
         - Bei HTTP 403: gibt [] zurück (Remote blockiert) — damit der Backend-Fallback auf DB greifen kann.
         - Robustheit beim JSON-Parsing.
        """
        params = {'m': 'search', 'q': query}
        animepahe_rate_limiter.wait()
        logger.debug("Calling animepahe API: %s params=%s", self.api_url, params)
        try:
            response = self.session.get(self.api_url, params=params, timeout=10)
        except requests.RequestException as e:
            logger.error("Netzwerkfehler beim Abruf der AnimePahe-API: %s", e)
            # Tenacity wird hier evtl. retryen; wir lassen die Exception weiter werfen
            raise

        # Spezielles Handling für 403: oft Cloudflare/IP-Block; gib leeres Result zurück
        if response.status_code == 403:
            logger.warning("AnimePahe API returned 403 Forbidden for query=%s — returning empty result (will fallback to DB)", query)
            return []

        try:
            response.raise_for_status()
        except requests.HTTPError as e:
            logger.error("AnimePahe API returned HTTP error: %s", e)
            raise

        # Robustes JSON-Parsing
        try:
            payload = response.json()
        except ValueError:
            logger.error("Konnte Antwort der AnimePahe API nicht als JSON parsen (response.text first 500 chars): %s", response.text[:500])
            return []

        results = payload.get('data') or payload.get('results') or []
        out = []
        for anime in results:
            session_val = anime.get('session') or anime.get('identifier') or anime.get('id') or anime.get('slug')
            # studio might be a list or string; normalize
            studio_val = None
            if anime.get('studio'):
                if isinstance(anime.get('studio'), list):
                    studio_val = ", ".join(anime.get('studio'))
                else:
                    studio_val = anime.get('studio')

            out.append({
                'title': clean_title(anime.get('title', 'Unknown')),
                'session': session_val,
                'thumbnail': anime.get('image') or anime.get('thumbnail'),
                'type': anime.get('type'),
                'genre': anime.get('genre'),
                'studio': studio_val,
                'year': anime.get('year'),
                'source': 'pahe'
            })
        return out

    def search_anime(self, query: str) -> list[dict]:
        """Öffentliche Suche (Wrapper) — ruft search_anime_pahe auf."""
        return self.search_anime_pahe(query)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential_jitter(initial=1, max=10))
    def get_all_anime(self) -> list[dict]:
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
                tab_id = link.get("href")
                if not tab_id:
                    continue
                tab_id = tab_id.lstrip("#")
                tab_pane = soup.find("div", id=tab_id)
                if tab_pane:
                    anime_links = tab_pane.find_all("a", href=True)
                    for a in anime_links:
                        href = a.get("href")
                        title = a.get("title") or a.get_text(strip=True)
                        if not href or not title:
                            continue
                        parsed = urlparse(href)
                        path = parsed.path or href
                        if path.startswith("/anime/"):
                            session = path.rstrip("/").split("/")[-1]
                            if not session:
                                logger.warning(f"Leerer Session-Slug von href={href}, title={title}")
                                continue
                            anime_list.append({"title": clean_title(title), 'session': session, 'source': 'pahe'})
        else:
            logger.debug("Kein nav_container mit class 'scrollable-ul' gefunden beim Parsen von /anime")
        return anime_list

    def get_all_session_ids(self) -> list[str]:
        try:
            anime_list = self.get_all_anime()
            session_ids = [anime['session'] for anime in anime_list if anime.get('session')]
            random.shuffle(session_ids)
            logger.info(f"{len(session_ids)} Session-IDs vom Crawler geladen: {session_ids[:10]}")
            return session_ids
        except Exception as e:
            logger.error(f"Fehler beim Abrufen der Session-IDs vom Crawler: {e}")
            return []

    @retry(stop=stop_after_attempt(3), wait=wait_exponential_jitter(initial=1, max=10))
    def _fetch_all_episodes(self, anime_id: str) -> list[dict]:
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
        # Sortiere numerisch (Episode kann float/str sein)
        try:
            return sorted(episodes, key=lambda x: float(x.get('episode', 0)))
        except Exception:
            return episodes

    def fetch_episodes(self, anime: dict) -> list[dict]:
        if anime.get('source') == 'pahe':
            episodes = self._fetch_all_episodes(anime['session'])
            for ep in episodes:
                ep['source'] = 'pahe'
            return episodes
        else:
            raise ValueError("Unbekannte Quelle")

    @retry(stop=stop_after_attempt(3), wait=wait_exponential_jitter(initial=1, max=10))
    def get_stream_url(self, anime_session: str, episode_session: str) -> str:
        episode_url = f"/play/{anime_session}/{episode_session}"
        logger.info(f"Verarbeite Episoden-URL: {episode_url}")
        episode_data = self._parse_episode_url(episode_url)
        kwik_links = self._get_kwik_links(episode_data)
        logger.info(f"Gefundene Kwik-Links: {kwik_links}")
        if not kwik_links:
            raise ValueError("Keine abspielbaren Links gefunden")
        # best resolution heuristic
        try:
            best_res = max(kwik_links.keys(), key=lambda x: int(re.sub(r'\D', '', x) or 0))
        except Exception:
            best_res = list(kwik_links.keys())[0]
        return self._extract_m3u8(kwik_links[best_res]['kwik'])

    def _get_kwik_links(self, episode_data: dict) -> dict:
        url = f"{self.base_url}/play/{episode_data['anime_id']}/{episode_data['session_id']}"
        logger.info(f"Rufe Episoden-Seite auf: {url}")
        animepahe_rate_limiter.wait()
        options = uc.ChromeOptions()
        options.headless = True
        options.add_argument("--disable-blink-features=AutomationControlled")
        chrome_version_main = CONFIG.get("CHROME_VERSION_MAIN", 138)
        links = {}
        driver = None
        try:
            driver = uc.Chrome(version_main=chrome_version_main, options=options)
            driver.get(url)
            WebDriverWait(driver, 30).until(
                EC.presence_of_element_located((By.CLASS_NAME, "theatre-info"))
            )
            time.sleep(4)  # zusätzliche Zeit für dynamisches Laden
            # Versuche mehrere Selektoren
            page_source = driver.page_source
            # Debug speichern
            try:
                with open('debug_rendered_page.html', 'w', encoding='utf-8') as f:
                    f.write(page_source)
                logger.debug("Gerendertes HTML in debug_rendered_page.html gespeichert")
            except Exception:
                logger.debug("Konnte debug_rendered_page.html nicht schreiben")

            soup = BeautifulSoup(page_source, 'html.parser')
            selectors = [
                'div.episode-menu a[href*="kwik"]',
                'div#resolutionMenu a[href*="kwik"]',
                'div#resolutionMenu button[data-src*="kwik"]',
                'a[href*="kwik"]',
                'button[data-src*="kwik"]'
            ]
            for selector in selectors:
                elements = soup.select(selector)
                logger.info(f"Gefundene Elemente für Selektor '{selector}': {len(elements)}")
                for elem in elements:
                    kwik_url = elem.get('href') or elem.get('data-src')
                    resolution = elem.get('data-resolution') or (elem.get_text(strip=True) if elem.get_text() else 'unknown')
                    audio = elem.get('data-audio', 'unknown')
                    if kwik_url:
                        links[resolution] = {'kwik': kwik_url, 'audio': audio}
                        logger.info(f"Link hinzugefügt: Resolution={resolution}, Kwik={kwik_url}, Audio={audio}")
            if not links:
                logger.warning("Keine Kwik-Links in HTML gefunden, versuche JavaScript-Fallback")
                script_tags = soup.find_all('script')
                for script in script_tags:
                    text = script.string or ""
                    if 'kwik' in text.lower():
                        matches = re.findall(r'https?://kwik\.[a-z]+/[^\s\'"]+', text)
                        for kwik_url in matches:
                            links[f"unknown_{len(links)+1}"] = {'kwik': kwik_url, 'audio': 'unknown'}
                            logger.info(f"JavaScript-Link hinzugefügt: Kwik={kwik_url}")
            if not links:
                logger.error(f"Keine Kwik-Links gefunden für URL: {url}")
        except Exception as e:
            logger.error(f"Fehler beim Rendern der Seite mit undetected_chromedriver: {str(e)}", exc_info=True)
        finally:
            if driver:
                driver.quit()
        return links

    def _extract_m3u8(self, kwik_url: str) -> str:
        logger.info(f"Extrahiere m3u8 von Kwik-URL: {kwik_url}")
        # Achte auf korrekte Header; Referer kann nötig sein
        try:
            response = self.session.get(kwik_url, headers={'Referer': self.base_url}, timeout=15)
        except requests.RequestException as e:
            logger.error(f"Fehler beim Abruf der Kwik-URL: {e}")
            raise
        response.raise_for_status()
        # Suche nach eval(...) JS-Block und beautify um m3u8 zu finden
        match = re.search(r';eval\(.*\)', response.text, flags=re.DOTALL)
        if not match:
            logger.error("Kein Videoplayer-Code (eval) gefunden")
            raise ValueError("Fehler beim Finden des Videoplayer-Codes")
        beautified = jsbeautifier.beautify(match.group(0).replace('\\', ''))
        m3u8_match = re.search(r'https?://[^\s\'"]+\.m3u8', beautified)
        if not m3u8_match:
            logger.error("Keine m3u8-URL im beautified Code gefunden")
            raise ValueError("Fehler beim Extrahieren der Video-Stream-URL")
        m3u8_url = m3u8_match.group(0)
        logger.info(f"Extrahierte m3u8-URL: {m3u8_url}")
        return m3u8_url

    def _parse_episode_url(self, url: str) -> dict:
        logger.info(f"Parse Episoden-URL: {url}")
        parsed = urlparse(url)
        if not parsed.path.startswith('/play/'):
            raise ValueError("Ungültige AnimePahe-Episoden-URL")
        path_parts = parsed.path.split('/')
        return {'anime_id': path_parts[-2], 'session_id': path_parts[-1]}

    def get_details(self, anime: dict) -> dict:
        source = anime.get('source')
        session_id = anime.get('session')
        if source == 'pahe':
            details = self._get_pahe_details(session_id)
        else:
            raise ValueError("Unbekannte Quelle")
        details["source"] = source
        details["identifier"] = session_id
        details["session"] = session_id  # sicherstellen
        details["title"] = clean_title(details.get("title", "Unknown"))
        logger.debug(f"Details für Anime (Session: {session_id}): {details}")
        return details

    def _parse_pahe_title(self, soup: BeautifulSoup) -> str:
        title_tag = soup.find("h1")
        return clean_title(title_tag.get_text(strip=True)) if title_tag else "Unknown"

    def _parse_pahe_synopsis(self, soup: BeautifulSoup) -> str:
        summary_div = soup.find("div", class_="tab-content anime-detail") or soup.find("div", class_="anime-info")
        return summary_div.decode_contents() if summary_div else "No summary available."

    def _parse_pahe_relations(self, soup: BeautifulSoup) -> str:
        relations_div = soup.find(lambda tag: tag.name == "div" and tag.get("class") and "anime-relation" in " ".join(tag.get("class")))
        return relations_div.decode_contents() if relations_div else "No relations found."

    def _parse_pahe_recommendations(self, soup: BeautifulSoup) -> str:
        recommendations_div = soup.find(lambda tag: tag.name == "div" and tag.get("class") and "anime-recommendation" in " ".join(tag.get("class")))
        return recommendations_div.decode_contents() if recommendations_div else "No recommendations found."

    def _parse_pahe_genre(self, soup: BeautifulSoup) -> str:
        genre_div = soup.find("div", class_="anime-genre")
        if not genre_div:
            return "N/A"
        parts = [li.get_text(strip=True) for li in genre_div.find_all("li")]
        return ", ".join(parts) if parts else "N/A"

    def _parse_pahe_thumbnail(self, soup: BeautifulSoup) -> str | None:
        poster_div = soup.find("div", class_="anime-poster")
        if poster_div and poster_div.find("img"):
            return poster_div.find("img").get("src") or poster_div.find("img").get("data-src")
        return None

    # ---------- REPLACED: Robuste Info-Parser (Studio, Type, Season, Year) ----------
    def _parse_pahe_info(self, soup: BeautifulSoup) -> tuple[str | None, str | None, str | None, str | None]:
        """
        Robusteres Parsen der Info-Box auf AnimePahe-Detailseiten.
        Liefert: (type, studio, season, year) - oder None wenn nicht gefunden.
        """
        anime_type = None
        studio = None
        season = None
        year = None

        info_div = soup.find("div", class_="anime-info")
        if not info_div:
            # Fallback: suche allgemein nach Abschnitten die 'Studio' enthalten
            possible = soup.find_all(text=lambda t: t and "studio" in t.lower())
            for t in possible:
                parent = t.parent
                if parent and parent.get_text(strip=True):
                    txt = parent.get_text(" ", strip=True)
                    m = re.search(r'Studios?:\s*(.+)', txt, re.IGNORECASE)
                    if m:
                        studio_candidate = m.group(1).split("|")[0].split(",")[0].strip()
                        if studio_candidate and studio_candidate.lower() not in ("n/a","unknown"):
                            studio = studio_candidate
                            break
            return anime_type, studio, season, year

        # Durchlaufe <p>-Elemente in der Info-Box
        for p in info_div.find_all(["p", "div"]):
            text = p.get_text(" ", strip=True)
            lowered = text.lower()

            # TYPE
            if "type:" in lowered and not anime_type:
                a = p.find("a")
                if a and a.get_text(strip=True):
                    anime_type = a.get_text(strip=True)
                else:
                    m = re.search(r'Type:\s*(.+)', text, re.IGNORECASE)
                    if m:
                        anime_type = m.group(1).split("|")[0].strip()

            # STUDIO / STUDIOS / Studio(s)
            if "studio" in lowered and not studio:
                # 1) Wenn <a> Tags vorhanden, nimm deren Texte (häufig)
                anchors = [a.get_text(strip=True) for a in p.find_all("a") if a.get_text(strip=True)]
                if anchors:
                    studio = ", ".join(anchors)
                else:
                    # 2) Fallback: versuche Text nach Label zu extrahieren
                    m = re.search(r'Studios?:\s*(.+)', text, re.IGNORECASE)
                    if m:
                        val = m.group(1).strip()
                        # Entferne nachfolgende Labels oder Separatoren
                        val = re.split(r'\s*\||\n', val)[0].strip()
                        # Falls mehrere durch Komma getrennt, nimm alle
                        parts = [x.strip() for x in val.split(",") if x.strip()]
                        if parts:
                            studio = ", ".join(parts)

            # AIRED -> Jahr & Saison
            if "aired:" in lowered and (not year or not season):
                m = re.search(r'\b(\d{4})\b', text)
                if m:
                    year = m.group(1)
                m_month = re.search(r'(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)', text, re.IGNORECASE)
                if m_month:
                    month = m_month.group(1).lower()
                    season = {"dec": "Winter", "jan": "Winter", "feb": "Winter",
                              "mar": "Spring", "apr": "Spring", "may": "Spring",
                              "jun": "Summer", "jul": "Summer", "aug": "Summer",
                              "sep": "Fall", "oct": "Fall", "nov": "Fall"}.get(month[:3], None)

        # Normalize: keep None if empty/placeholder
        if isinstance(studio, str) and studio.strip().lower() in ("n/a","unknown",""):
            studio = None

        return anime_type or None, studio or None, season or None, year or None
    # ---------- END REPLACED FUNCTION ----------

    @retry(stop=stop_after_attempt(3), wait=wait_exponential_jitter(initial=1, max=10))
    def _get_pahe_details(self, session: str) -> dict:
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
        thumbnail_url = self._parse_pahe_thumbnail(soup)
        logger.debug(f"Gefundene Thumbnail-URL für '{title}' (Session: {session}): {thumbnail_url}")
        cached_filename = None
        thumbnail_to_store = None
        if thumbnail_url:
            logger.debug(f"Starte Caching für Thumbnail von '{title}' (Session: {session})...")
            try:
                cached_filename = cache_image(thumbnail_url)
                if cached_filename:
                    logger.info(f"Thumbnail für '{title}' (Session: {session}) erfolgreich gecached: {cached_filename}")
                    thumbnail_to_store = f"/cached_images/{cached_filename}"
                else:
                    logger.warning(f"Fehler beim Cachen des Thumbnails für '{title}' (Session: {session}) von {thumbnail_url}. Speichere Original-URL.")
                    thumbnail_to_store = thumbnail_url
            except Exception as e:
                logger.error(f"Fehler beim Cachen des Thumbnails: {e}", exc_info=True)
                thumbnail_to_store = thumbnail_url
        else:
            logger.info(f"Keine Thumbnail-URL für '{title}' (Session: {session}) gefunden.")
        anime_type, studio, season, year = self._parse_pahe_info(soup)
        return {
            "title": title,
            "synopsis": synopsis,
            "info": synopsis,
            "relations": relations,
            "recommendations": recommendations,
            "thumbnail": thumbnail_to_store,
            "genre": genre,
            "type": anime_type,
            "studio": studio,
            "season": season,
            "year": year
        }

# Globale Instanz
crawler = AnimePaheCrawler()
