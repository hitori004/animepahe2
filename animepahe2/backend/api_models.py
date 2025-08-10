# backend/api_models.py
from pydantic import BaseModel
from typing import List, Optional

# Eingabemodelle
class SearchQuery(BaseModel):
    q: str = ""
    type: str = "All"
    genre: str = "All"
    studio: str = "All"
    year: str = "All"

class EpisodeRequest(BaseModel):
    session: str
    episode_session: str

class StreamUrlsRequest(BaseModel):
    episodes: List[EpisodeRequest]

# Ausgabemodelle
class AnimeListItem(BaseModel):
    source: str
    session: str # identifier
    title: str
    thumbnail: Optional[str] = None
    genre: Optional[str] = None
    type: Optional[str] = None
    studio: Optional[str] = None
    year: Optional[str] = None

class AnimeDetails(BaseModel):
    source: str
    identifier: str
    title: str
    synopsis: str
    info: str
    relations: str
    recommendations: str
    thumbnail: Optional[str] = None
    genre: Optional[str] = None
    type: Optional[str] = None
    studio: Optional[str] = None
    season: Optional[str] = None
    year: Optional[str] = None

class Episode(BaseModel):
    session: str
    episode: str # Episode-Nummer als String, da sie z.B. "12.5" sein kann
    title: Optional[str] = None
    snapshot: Optional[str] = None
    created_at: Optional[str] = None
    source: str

class StreamUrlResponse(BaseModel):
    title: str
    m3u8_url: str

class FilterOptions(BaseModel):
    types: List[str]
    genres: List[str]
    studios: List[str]
    years: List[str]
