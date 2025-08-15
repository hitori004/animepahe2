const API_BASE_URL = '/api';

async function handleResponse(response) {
    // Versuche zuerst den Body als Text zu lesen (sicherer bei leeren/resourcelosen Antworten)
    const contentType = response.headers.get('content-type') || '';
    let text = '';
    try {
        text = await response.text();
    } catch (e) {
        // ignore
    }

    if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
            if (contentType.includes('application/json') && text) {
                const errorData = JSON.parse(text);
                errorMessage = errorData.message || errorData.detail || errorMessage;
            } else if (text) {
                // Falls Server nur Plain-Text liefert
                errorMessage = text;
            }
        } catch (e) {
            // fallback to status-based message
        }
        throw new Error(errorMessage);
    }

    // Kein Body (204/205/etc.) -> null zurückgeben
    if (!text) return null;

    // JSON wenn möglich, sonst roher Text
    if (contentType.includes('application/json')) {
        try {
            return JSON.parse(text);
        } catch (e) {
            console.warn('handleResponse: JSON parse failed, returning raw text.', e);
            return text;
        }
    }
    return text;
}

export function normalizeThumbnailUrl(value) {
    if (!value) return null;
    try {
        // Already data URI
        if (value.startsWith('data:')) return value;

        // Already cached path
        if (value.startsWith('/cached_images/')) {
            // strip query
            return value.split('?')[0];
        }

        // Absolute http(s)
        if (/^https?:\/\//i.test(value)) {
            return value.split('?')[0];
        }

        // Relative path: try to extract filename and map to cached_images
        const withoutQuery = value.split('?')[0];
        const parts = withoutQuery.split('/');
        const base = parts.pop() || parts.pop(); // handle trailing slash
        if (base && base.length > 0) {
            return `/cached_images/${base}`;
        }

        return null;
    } catch (err) {
        console.warn('normalizeThumbnailUrl error', err, value);
        return null;
    }
}

export async function getCachedImage(url) {
    // returns normalized path or placeholder; kept async for compatibility
    if (!url) {
        return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjY2NjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+Tm8gSW1hZ2U8L3RleHQ+PC9zdmc+';
    }
    const normalized = normalizeThumbnailUrl(url);
    return normalized || url;
}

export async function searchSuggestions(query) {
    if (!query || query.trim().length < 1) {
        return [];
    }
    const params = new URLSearchParams({ q: query.trim(), limit: 5 });
    const url = `${API_BASE_URL}/suggestions?${params.toString()}`;
    console.log(`[API] Sende Suggestions-Anfrage an: ${url}`);
    try {
        const response = await fetch(url);
        const data = await handleResponse(response);
        return Array.isArray(data) ? data : (data.results || data.items || data || []).slice(0, 5);
    } catch (error) {
        console.error('[API] Fehler bei searchSuggestions:', error);
        try {
            const response = await fetch(`${API_BASE_URL}/search?${params.toString()}`);
            const data = await handleResponse(response);
            return Array.isArray(data) ? data.slice(0, 5) : (data.results || data.items || data || []).slice(0, 5);
        } catch (fallbackError) {
            console.error('[API] Fallback-Suche fehlgeschlagen:', fallbackError);
            return [];
        }
    }
}

export async function searchAnime(query = "", filters = {}) {
    const params = new URLSearchParams();
    if (query) params.append('q', query);
    Object.keys(filters || {}).forEach(key => {
        const val = filters[key];
        if (val !== undefined && val !== null && val !== '' && val !== 'All') {
            params.append(key, val);
        }
    });
    const url = `${API_BASE_URL}/search?${params.toString()}`;
    console.log(`[API] Sende Suche an: ${url}`);
    const response = await fetch(url);
    return handleResponse(response);
}

export async function getAnimeDetails(session) {
    if (!session) {
        throw new Error("Session-ID ist erforderlich, um Details abzurufen.");
    }
    const url = `${API_BASE_URL}/anime/${encodeURIComponent(session)}`;
    console.log(`[API] Sende Details-Anfrage an: ${url}`);
    const response = await fetch(url);
    return handleResponse(response);
}

export async function getAnimeEpisodes(session) {
    if (!session) {
        throw new Error("Session-ID ist erforderlich, um Episoden abzurufen.");
    }
    const url = `${API_BASE_URL}/anime/${encodeURIComponent(session)}/episodes`;
    console.log(`[API] Sende Episoden-Anfrage an: ${url}`);
    const response = await fetch(url);
    return handleResponse(response);
}

export async function getStreamUrls(episodes) {
    if (!Array.isArray(episodes) || episodes.length === 0) {
        throw new Error("Eine Liste von Episoden ist erforderlich.");
    }

    const requestBody = {
        episodes: episodes.map(ep => {
            const animeSession = ep.anime_session || ep.anime || ep.session || ep.animeSession || null;
            const episodeSession = ep.episode_session || ep.episode || ep.ep_session || ep.session || null;
            return { anime_session: animeSession, episode_session: episodeSession };
        }).filter(ep => ep.anime_session && ep.episode_session)
    };

    if (requestBody.episodes.length === 0) {
        throw new Error("Keine gültigen Episoden zum Abrufen von Stream-URLs gefunden.");
    }

    const url = `${API_BASE_URL}/stream_urls`;
    console.log(`[API] Sende Stream-URL-Anfrage an: ${url}`, requestBody);
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });
    return handleResponse(response);
}

export async function getAllCachedAnime(page = 1, limit = 20) {
    // Sicherheitscheck: Begrenze limit auf maximal 100 (Backend-Limit)
    const safeLimit = Math.max(1, Math.min(100, limit));
    if (limit !== safeLimit) {
        console.warn(`[API] getAllCachedAnime: limit ${limit} wurde auf ${safeLimit} begrenzt`);
    }
    
    const params = new URLSearchParams({ page: page.toString(), limit: safeLimit.toString() });
    const url = `${API_BASE_URL}/anime/all?${params.toString()}`;
    console.log(`[API] Sende alle Animes-Anfrage an: ${url}`);
    const response = await fetch(url);
    const data = await handleResponse(response);
    console.log('[API getAllCachedAnime] Raw data from backend:', data);
    
    // Die API gibt bereits das richtige Format zurück: {results: [...], total: ...}
    if (data && typeof data === 'object' && 'results' in data && 'total' in data) {
        console.log('[API getAllCachedAnime] Data already has correct format');
        return {
            results: Array.isArray(data.results) ? data.results : [],
            total: typeof data.total === 'number' ? data.total : 0
        };
    }
    
    // Fallback für andere Formate
    console.log('[API getAllCachedAnime] Using fallback data handling');
    return {
        results: Array.isArray(data) ? data : [],
        total: Array.isArray(data) ? data.length : 0
    };
}

export async function getFilterOptions() {
    const url = `${API_BASE_URL}/filters`;
    console.log(`[API] Sende Filter-Optionen-Anfrage an: ${url}`);
    const response = await fetch(url);
    return handleResponse(response);
}

export default {
    normalizeThumbnailUrl,
    getCachedImage,
    searchSuggestions,
    searchAnime,
    getAnimeDetails,
    getAnimeEpisodes,
    getStreamUrls,
    getAllCachedAnime,
    getFilterOptions
};