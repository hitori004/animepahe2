const API_BASE_URL = '/api';

async function handleResponse(response) {
    if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorData.detail || errorMessage;
        } catch (e) {}
        throw new Error(errorMessage);
    }
    return response.json();
}

export function normalizeThumbnailUrl(value) {
    if (!value) return null;
    try {
        if (value.startsWith('data:')) {
            return value;
        }
        if (value.startsWith('/cached_images/')) {
            return value.split('?')[0];
        }
        if (/^https?:\/\//i.test(value)) {
            return value.split('?')[0];
        }
        const base = value.split('?')[0].split('/').pop();
        if (base) {
            return `/cached_images/${base}`;
        }
        return null;
    } catch (err) {
        console.warn('normalizeThumbnailUrl error', err, value);
        return null;
    }
}

export async function getCachedImage(url) {
    if (!url) {
        return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjY2NjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+Tm8gSW1hZ2U8L3RleHQ+PC9zdmc+';
    }
    const normalized = normalizeThumbnailUrl(url);
    return normalized || url;
}

export async function searchAnime(query = "", filters = {}) {
    const params = new URLSearchParams();
    if (query) params.append('q', query);
    Object.keys(filters).forEach(key => {
        if (filters[key] && filters[key] !== 'All') {
            params.append(key, filters[key]);
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
        episodes: episodes.map(ep => ({
            session: ep.anime_session || ep.session,
            episode_session: ep.session || ep.episode_session
        })).filter(ep => ep.session && ep.episode_session)
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
    const params = new URLSearchParams({ page: page.toString(), limit: limit.toString() });
    const url = `${API_BASE_URL}/anime/all?${params.toString()}`;
    console.log(`[API] Sende alle Animes-Anfrage an: ${url}`);
    const response = await fetch(url);
    return handleResponse(response);
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
    searchAnime,
    getAnimeDetails,
    getAnimeEpisodes,
    getStreamUrls,
    getAllCachedAnime,
    getFilterOptions
};