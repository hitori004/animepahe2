// js/components/AnimeDetail.js
import * as api from '../services/api.js';

// DOM-Elemente (lazy)
let detailSection, detailBackButton, detailTitle, detailThumbnail, detailSynopsis;
let detailInfoType, detailInfoGenre, detailInfoStudio, detailInfoYear, detailEpisodesList;
let tabButtons, tabContents;

// Search elements
let searchInput, searchButton, searchSuggestionsContainer;

let currentAnimeSession = null;
let _cachedSwitchView = null;

async function _loadSwitchView() {
    if (_cachedSwitchView) return _cachedSwitchView;
    try {
        const mod = await import('../main.js');
        if (mod && typeof mod.switchView === 'function') {
            _cachedSwitchView = mod.switchView;
            return _cachedSwitchView;
        } else {
            console.error('Importierte main.js hat keinen switchView-Export oder switchView ist keine Funktion', mod);
            return null;
        }
    } catch (err) {
        console.error('Fehler beim dynamischen Import von main.js:', err);
        return null;
    }
}

function ensureDetailElements() {
    if (detailSection) return; // already initialized

    detailSection = document.getElementById('anime-detail-content');
    detailBackButton = document.getElementById('detail-back-button');
    detailTitle = document.getElementById('detail-anime-title');
    detailThumbnail = document.getElementById('detail-anime-thumbnail');
    detailSynopsis = document.getElementById('detail-anime-synopsis');
    detailInfoType = document.getElementById('detail-type');
    detailInfoGenre = document.getElementById('detail-genre');
    detailInfoStudio = document.getElementById('detail-studio');
    detailInfoYear = document.getElementById('detail-year');
    detailEpisodesList = document.getElementById('detail-anime-episodes');
    tabButtons = document.querySelectorAll('.tab-button');
    tabContents = document.querySelectorAll('.content-tab');

    // search elements (header)
    searchInput = document.getElementById('search-input');
    searchButton = document.getElementById('search-button');
    searchSuggestionsContainer = document.getElementById('search-suggestions');
}

function initializeTabNavigation() {
    if (!tabButtons || !tabContents) {
        tabButtons = document.querySelectorAll('.tab-button');
        tabContents = document.querySelectorAll('.content-tab');
    }
    if (tabButtons.length > 0 && tabContents.length > 0) {
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const tabName = button.dataset.tab;
                tabButtons.forEach(btn => {
                    btn.classList.remove('text-purple-400', 'border-purple-400');
                    btn.classList.add('text-gray-400', 'hover:text-white');
                });
                tabContents.forEach(content => {
                    content.classList.remove('active');
                    content.classList.add('hidden');
                });
                button.classList.remove('text-gray-400', 'hover:text-white');
                button.classList.add('text-purple-400', 'border-purple-400');
                const targetContentId = `detail-tab-${tabName}`;
                const targetContent = document.getElementById(targetContentId);
                if (targetContent) {
                    targetContent.classList.remove('hidden');
                    targetContent.classList.add('active');
                } else {
                    console.warn(`Tab-Inhalt mit ID '${targetContentId}' nicht gefunden.`);
                }
            });
        });
    }
}

export async function showAnimeDetail(session) {
    ensureDetailElements();
    if (!detailSection) {
        console.error("Detailansicht-DOM-Elemente nicht gefunden.");
        return;
    }

    currentAnimeSession = session;

    const switchView = await _loadSwitchView();
    if (!switchView) {
        console.error('Navigation (switchView) ist nicht verfügbar. Abbruch showAnimeDetail.');
        return;
    }

    switchView('detail');
    resetTabsToDefault();

    detailTitle.textContent = "Lade...";
    detailThumbnail.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjY2NjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkxvYWRpbmcuLi48L3RleHQ+PC9zdmc+'; // placeholder
    detailSynopsis.innerHTML = "<p>Lade Beschreibung...</p>";
    detailInfoType.textContent = "...";
    detailInfoGenre.textContent = "...";
    detailInfoStudio.textContent = "...";
    detailInfoYear.textContent = "...";
    detailEpisodesList.innerHTML = "<li>Lade Episoden...</li>";

    try {
        const [details, episodes] = await Promise.all([
            api.getAnimeDetails(session),
            api.getAnimeEpisodes(session)
        ]);

        renderAnimeDetails(details);
        renderEpisodesList(episodes);

    } catch (error) {
        console.error("Fehler beim Laden der Anime-Details:", error);
        detailTitle.textContent = "Fehler";
        detailSynopsis.innerHTML = `<p class="text-red-500">Fehler beim Laden der Details: ${error.message}</p>`;
        detailInfoType.textContent = "N/A";
        detailInfoGenre.textContent = "N/A";
        detailInfoStudio.textContent = "N/A";
        detailInfoYear.textContent = "N/A";
        detailEpisodesList.innerHTML = `<li class="text-red-500">Fehler beim Laden der Episoden: ${error.message}</li>`;
    }
}

function resetTabsToDefault() {
    ensureDetailElements();
    tabButtons.forEach((btn, index) => {
        if (index === 0) {
            btn.classList.remove('text-gray-400', 'hover:text-white');
            btn.classList.add('text-purple-400', 'border-purple-400');
        } else {
            btn.classList.remove('text-purple-400', 'border-purple-400');
            btn.classList.add('text-gray-400', 'hover:text-white');
        }
    });

    tabContents.forEach((content, index) => {
        if (index === 0) {
            content.classList.remove('hidden');
            content.classList.add('active');
        } else {
            content.classList.remove('active');
            content.classList.add('hidden');
        }
    });
}

function renderAnimeDetails(details) {
    ensureDetailElements();
    detailTitle.textContent = details.title || "Unbekannt";
    try {
        detailThumbnail.src = api.normalizeThumbnailUrl(details.thumbnail) || detailThumbnail.src;
    } catch (e) {
        detailThumbnail.src = detailThumbnail.src;
    }

    let combinedInfo = "<h2 class='text-lg font-bold mb-2'>Synopsis</h2>";
    combinedInfo += details.synopsis || "<p>Keine Beschreibung verfügbar.</p>";
    combinedInfo += "<h2 class='text-lg font-bold mb-2 mt-4'>Information</h2>";
    combinedInfo += details.info || "<p>Keine weiteren Informationen verfügbar.</p>";
    detailSynopsis.innerHTML = combinedInfo;

    detailInfoType.textContent = details.type || "N/A";
    detailInfoGenre.textContent = details.genre || "N/A";
    detailInfoStudio.textContent = details.studio || "N/A";
    detailInfoYear.textContent = details.year || "N/A";
}

function renderEpisodesList(episodes) {
    ensureDetailElements();
    detailEpisodesList.innerHTML = '';

    if (!episodes || episodes.length === 0) {
        detailEpisodesList.innerHTML = '<li class="py-2 text-gray-500">Keine Episoden gefunden.</li>';
        return;
    }

    episodes.forEach(ep => {
        const li = document.createElement('li');
        li.className = 'py-2 border-b border-gray-700 hover:bg-gray-750 cursor-pointer flex justify-between items-center';
        li.dataset.episodeSession = ep.session;
        li.dataset.animeSession = currentAnimeSession;

        li.innerHTML = `
            <span>Episode ${ep.episode}</span>
            <span class="text-xs text-gray-500">${ep.created_at || 'N/A'}</span>
        `;

        li.addEventListener('click', async (e) => {
            if (e.target.tagName === 'BUTTON') return;
            const player = localStorage.getItem('playerChoice') || 'mpv';
            console.log(`Sende getStreamUrls für: session=${currentAnimeSession}, episode_session=${ep.session}`);
            if (player === 'mpv') {
                try {
                    const response = await api.getStreamUrls([{ session: currentAnimeSession, episode_session: ep.session }]);
                    console.log('getStreamUrls Antwort:', response);
                    if (response.length > 0) {
                        await fetch('/api/play_external', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ episodes: [{ session: currentAnimeSession, episode_session: ep.session }] })
                        });
                        console.log(`MPV gestartet für Episode ${ep.episode}`);
                    }
                } catch (error) {
                    console.error('Fehler beim Abspielen der Episode:', error);
                    alert(`Fehler beim Abspielen der Episode: ${error.message}`);
                }
            } else {
                alert(`Webplayer für Episode ${ep.episode} wird gestartet (Implementierung folgt)`);
            }
        });

        detailEpisodesList.appendChild(li);
    });
}

/* =========================
   Live Search Autocomplete
   ========================= */

function debounce(fn, wait = 300) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), wait);
    };
}

function closeSuggestions() {
    if (!searchSuggestionsContainer) return;
    searchSuggestionsContainer.classList.add('hidden');
    searchSuggestionsContainer.innerHTML = '';
    if (searchInput) {
        searchInput.setAttribute('aria-expanded', 'false');
        searchInput.removeAttribute('aria-activedescendant');
    }
}

function openSuggestions() {
    if (!searchSuggestionsContainer) return;
    searchSuggestionsContainer.classList.remove('hidden');
    if (searchInput) searchInput.setAttribute('aria-expanded', 'true');
}

function renderSuggestions(items = []) {
    if (!searchSuggestionsContainer) return;
    searchSuggestionsContainer.innerHTML = '';

    if (!items || items.length === 0) {
        const li = document.createElement('div');
        li.className = 'px-4 py-2 text-sm text-gray-400';
        li.textContent = 'Keine Ergebnisse';
        searchSuggestionsContainer.appendChild(li);
        openSuggestions();
        return;
    }

    const list = document.createElement('ul');
    list.setAttribute('role', 'listbox');
    list.className = 'divide-y divide-gray-700';
    items.forEach((it, idx) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.id = `search-suggestion-${idx}`;
        li.tabIndex = -1;
        li.className = 'px-3 py-2 hover:bg-gray-800 cursor-pointer';
        li.dataset.session = it.session || it.id || it.anime_session || '';
        li.dataset.index = idx;

        li.textContent = it.title || it.name || 'Unbenannt';

        // click handler
        li.addEventListener('click', (e) => {
            const session = li.dataset.session;
            if (session) {
                // select and show detail
                closeSuggestions();
                showAnimeDetail(session);
            } else {
                // fallback: set input value
                searchInput.value = it.title || it.name || '';
                closeSuggestions();
            }
        });

        list.appendChild(li);
    });

    searchSuggestionsContainer.appendChild(list);
    openSuggestions();
}

/* keyboard navigation inside suggestion list */
function handleSuggestionKeyboard(e) {
    if (!searchSuggestionsContainer || searchSuggestionsContainer.classList.contains('hidden')) return;
    const options = Array.from(searchSuggestionsContainer.querySelectorAll('[role="option"]'));
    if (!options.length) return;

    const activeId = searchInput.getAttribute('aria-activedescendant');
    let currentIndex = options.findIndex(o => o.id === activeId);

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        currentIndex = Math.min(options.length - 1, currentIndex + 1);
        const el = options[currentIndex] || options[0];
        if (el) {
            searchInput.setAttribute('aria-activedescendant', el.id);
            el.focus();
        }
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        currentIndex = Math.max(0, (currentIndex === -1 ? options.length : currentIndex) - 1);
        const el = options[currentIndex];
        if (el) {
            searchInput.setAttribute('aria-activedescendant', el.id);
            el.focus();
        }
    } else if (e.key === 'Enter') {
        e.preventDefault();
        const el = options[currentIndex] || options[0];
        if (el) {
            el.click();
        } else {
            // fallback: try to run a full search
            triggerFullSearch(searchInput.value.trim());
            closeSuggestions();
        }
    } else if (e.key === 'Escape') {
        closeSuggestions();
    }
}

async function performSuggestionQuery(q) {
    if (!q || q.length < 1) {
        closeSuggestions();
        return;
    }

    // try to use api.searchSuggestions if available, else try common fallbacks
    try {
        let results = [];
        if (api && typeof api.searchSuggestions === 'function') {
            results = await api.searchSuggestions(q);
        } else if (api && typeof api.search === 'function') {
            results = await api.search(q);
        } else {
            // generic fetch fallback to /api/search?q=
            const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
            if (res.ok) results = await res.json();
        }

        // Normalize results if needed (expect array of objects with title and session)
        if (!Array.isArray(results)) {
            if (results && results.results) results = results.results;
            else results = [];
        }

        renderSuggestions(results.slice(0, 5));
    } catch (err) {
        console.error('Fehler bei Suche:', err);
        renderSuggestions([]);
    }
}

const debouncedQuery = debounce((q) => performSuggestionQuery(q), 250);

function initSearchAutocomplete() {
    ensureDetailElements();
    if (!searchInput || !searchSuggestionsContainer) {
        console.warn('Such-Elemente nicht gefunden. Autocomplete deaktiviert.');
        return;
    }

    // accessibility attributes
    searchInput.setAttribute('role', 'combobox');
    searchInput.setAttribute('aria-autocomplete', 'list');
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.setAttribute('aria-controls', 'search-suggestions');

    // input events
    searchInput.addEventListener('input', (e) => {
        const q = e.target.value.trim();
        if (!q) {
            closeSuggestions();
            return;
        }
        debouncedQuery(q);
    });

    // keyboard navigation
    searchInput.addEventListener('keydown', (e) => {
        if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) {
            handleSuggestionKeyboard(e);
        }
    });

    // search button: if suggestions visible -> choose first, else full search
    if (searchButton) {
        searchButton.addEventListener('click', (e) => {
            e.preventDefault();
            const first = searchSuggestionsContainer ? searchSuggestionsContainer.querySelector('[role="option"]') : null;
            if (first) {
                first.click();
            } else {
                triggerFullSearch(searchInput.value.trim());
            }
        });
    }

    // click outside to close
    document.addEventListener('click', (e) => {
        if (!searchSuggestionsContainer || searchSuggestionsContainer.classList.contains('hidden')) return;
        const path = e.composedPath ? e.composedPath() : (e.path || []);
        if (!path.includes(searchSuggestionsContainer) && !path.includes(searchInput)) {
            closeSuggestions();
        }
    });

    // prevent blur closing race: keep suggestions open when focusing options
    searchSuggestionsContainer.addEventListener('mousedown', (e) => {
        // keep container open while clicking inside
        e.preventDefault();
    });
}

function triggerFullSearch(query) {
    // Minimal behavior: if user clicks search and no suggestion selected,
    // we go to 'home' view and log the query; concrete implementation depends on main.js
    if (!query) return;
    console.log('Full search requested:', query);
    // Attempt to call switchView('home') + send event or set global state if desired.
    // For now show a status and close suggestions.
    const status = document.getElementById('status-message');
    if (status) status.textContent = `Suche: "${query}" (Ergebnisse werden geladen...)`;
    closeSuggestions();
    // Optionally you could dispatch a custom event with the query:
    document.dispatchEvent(new CustomEvent('app:search', { detail: { query } }));
}

/* =========================
   Setup that needs DOM elements
   ========================= */
document.addEventListener('DOMContentLoaded', () => {
    ensureDetailElements();
    initializeTabNavigation();
    initSearchAutocomplete();

    if (detailBackButton) {
        detailBackButton.addEventListener('click', async () => {
            const switchView = await _loadSwitchView();
            if (switchView) {
                switchView('home');
            } else {
                console.error('switchView nicht verfügbar (Back Button).');
            }
        });
    } else {
        console.warn("Detailansicht 'Zurück'-Button nicht gefunden.");
    }
});