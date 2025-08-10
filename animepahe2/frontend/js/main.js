import * as api from './services/api.js';
import { showAnimeDetail } from './components/AnimeDetail.js';

// DOM-Elemente
const appContainer = document.getElementById('app');
const splashScreen = document.getElementById('splash-screen');
const statusBar = document.getElementById('status-bar');
const statusMessage = document.getElementById('status-message');
const backgroundCacheStatus = document.getElementById('background-cache-status');
const searchInput = document.getElementById('search-input');
const searchButton = document.getElementById('search-button');
const filterToggleButton = document.getElementById('filter-toggle-button');
const filterPanel = document.getElementById('filter-panel');
const filterApplyButton = document.getElementById('filter-apply-button');
const filterResetButton = document.getElementById('filter-reset-button');
const filterType = document.getElementById('filter-type');
const filterGenre = document.getElementById('filter-genre');
const filterStudio = document.getElementById('filter-studio');
const filterYear = document.getElementById('filter-year');
const navLinks = {
    home: document.getElementById('nav-home'),
    favorites: document.getElementById('nav-favorites'),
    settings: document.getElementById('nav-settings')
};
const contentSections = {
    home: document.getElementById('home-content'),
    favorites: document.getElementById('favorites-content'),
    settings: document.getElementById('settings-content')
};
const contentArea = document.getElementById('content-area');
const animeGrid = document.getElementById('anime-grid');
const favoritesGrid = document.getElementById('favorites-grid');
const playlistBar = document.getElementById('playlist-bar');
const playlistItems = document.getElementById('playlist-items');
const playlistClearButton = document.getElementById('playlist-clear-button');
const playlistPlayExternalButton = document.getElementById('playlist-play-external-button');
const playlistPlayWebButton = document.getElementById('playlist-play-web-button');
const quitButton = document.getElementById('quit-button');
const playerChoice = document.getElementById('player-choice');
const cacheInterval = document.getElementById('cache-interval');
const clearCacheButton = document.getElementById('clear-cache-button');

// Zustand
let currentView = 'home';
let isFilterPanelOpen = false;
let currentSearchResults = [];
let favorites = JSON.parse(localStorage.getItem('favorites') || '[]');

// WebSocket für Cache-Status
let ws = null;
function connectWebSocket() {
    ws = new WebSocket(`ws://${window.location.host}/ws/cache_status`);
    ws.onopen = () => {
        console.log('[WebSocket] Connected to cache status');
        updateBackgroundCacheStatus('Connected');
    };
    ws.onmessage = (event) => {
        updateBackgroundCacheStatus(event.data);
    };
    ws.onclose = () => {
        updateBackgroundCacheStatus('Disconnected');
        setTimeout(connectWebSocket, 5000);
    };
    ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        updateBackgroundCacheStatus('Error');
    };
}

async function searchAnime(query) {
    updateStatus(`Suche läuft für '${query}'...`);
    const filters = {
        type: filterType.value,
        genre: filterGenre.value,
        studio: filterStudio.value,
        year: filterYear.value
    };
    try {
        const results = await api.searchAnime(query, filters);
        updateStatus(`Suche abgeschlossen. ${results.length} Ergebnisse gefunden.`);
        return results;
    } catch (error) {
        console.error("Fehler bei der Suche:", error);
        updateStatus(`Fehler bei der Suche: ${error.message}`);
        throw error;
    }
}

function createAnimeCard(animeData) {
    const card = document.createElement('div');
    card.className = 'anime-card bg-gray-800 rounded-lg overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 cursor-pointer relative';
    card.dataset.session = animeData.session || animeData.identifier;

    const imgWrapper = document.createElement('div');
    imgWrapper.className = 'relative pb-[150%]';
    
    const img = document.createElement('img');
    img.alt = animeData.title || "Unbekannter Anime";
    img.className = 'absolute inset-0 w-full h-full object-cover';
    img.loading = 'lazy';
    img.src = api.normalizeThumbnailUrl(animeData.thumbnail) || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjY2NjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk5vIFRodW1ibmFpbDwvdGV4dD48L3N2Zz4=';

    const favoriteButton = document.createElement('button');
    favoriteButton.className = 'absolute top-2 right-2 p-1 bg-gray-900 bg-opacity-50 rounded-full';
    favoriteButton.innerHTML = favorites.some(f => f.session === animeData.session) ?
        '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3.172 5.172a3 3 0 014.242 0L10 7.757l2.586-2.585a3 3 0 014.242 4.242l-2.586 2.586a1 1 0 01-1.414 0L10 9.414l-2.586 2.586a1 1 0 01-1.414 0l-2.586-2.586a3 3 0 010-4.242z" clip-rule="evenodd" /></svg>' :
        '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3.172 5.172a3 3 0 014.242 0L10 7.757l2.586-2.585a3 3 0 014.242 4.242l-2.586 2.586a1 1 0 01-1.414 0L10 9.414l-2.586 2.586a1 1 0 01-1.414 0l-2.586-2.586a3 3 0 010-4.242z" clip-rule="evenodd" /></svg>';
    favoriteButton.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(animeData);
        favoriteButton.innerHTML = favorites.some(f => f.session === animeData.session) ?
            '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3.172 5.172a3 3 0 014.242 0L10 7.757l2.586-2.585a3 3 0 014.242 4.242l-2.586 2.586a1 1 0 01-1.414 0L10 9.414l-2.586 2.586a1 1 0 01-1.414 0l-2.586-2.586a3 3 0 010-4.242z" clip-rule="evenodd" /></svg>' :
            '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3.172 5.172a3 3 0 014.242 0L10 7.757l2.586-2.585a3 3 0 014.242 4.242l-2.586 2.586a1 1 0 01-1.414 0L10 9.414l-2.586 2.586a1 1 0 01-1.414 0l-2.586-2.586a3 3 0 010-4.242z" clip-rule="evenodd" /></svg>';
    });

    const titleOverlay = document.createElement('div');
    titleOverlay.className = 'absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity duration-300 p-1';
    titleOverlay.innerHTML = `<span class="text-xs text-center font-medium">${animeData.title || "Unbekannt"}</span>`;

    imgWrapper.appendChild(img);
    imgWrapper.appendChild(titleOverlay);
    imgWrapper.appendChild(favoriteButton);
    
    const infoDiv = document.createElement('div');
    infoDiv.className = 'p-2';
    
    const titleDiv = document.createElement('div');
    titleDiv.className = 'title font-medium text-sm mb-1 truncate';
    titleDiv.textContent = animeData.title || "Unbekannter Titel";
    
    const metaDiv = document.createElement('div');
    metaDiv.className = 'text-xs text-gray-400';
    metaDiv.innerHTML = `
        <div class="truncate">Typ: ${animeData.type || 'N/A'}</div>
        <div class="truncate">Jahr: ${animeData.year || 'N/A'}</div>
        <div class="truncate">Studio: ${animeData.studio || 'N/A'}</div>
    `;

    infoDiv.appendChild(titleDiv);
    infoDiv.appendChild(metaDiv);

    card.appendChild(imgWrapper);
    card.appendChild(infoDiv);

    card.addEventListener('click', () => {
        const session = card.dataset.session;
        if (session) {
            showAnimeDetail(session);
        } else {
            updateStatus("Fehler: Keine Session-ID für diesen Anime gefunden.");
        }
    });

    return card;
}

function toggleFavorite(animeData) {
    const index = favorites.findIndex(f => f.session === animeData.session);
    if (index === -1) {
        favorites.push({
            session: animeData.session,
            title: animeData.title,
            thumbnail: animeData.thumbnail,
            type: animeData.type,
            year: animeData.year,
            studio: animeData.studio
        });
        updateStatus(`"${animeData.title}" zu Favoriten hinzugefügt.`);
    } else {
        favorites.splice(index, 1);
        updateStatus(`"${animeData.title}" aus Favoriten entfernt.`);
    }
    localStorage.setItem('favorites', JSON.stringify(favorites));
    if (currentView === 'favorites') {
        displayFavorites();
    }
}

function displayFavorites() {
    favoritesGrid.innerHTML = '';
    if (favorites.length > 0) {
        favorites.forEach(anime => {
            const cardElement = createAnimeCard(anime);
            favoritesGrid.appendChild(cardElement);
        });
        updateStatus(`${favorites.length} Favoriten gefunden.`);
    } else {
        favoritesGrid.innerHTML = '<p class="col-span-full text-center py-10 text-gray-500">Keine Favoriten hinzugefügt.</p>';
        updateStatus("Keine Favoriten vorhanden.");
    }
}

function filterAndDisplayResults(results) {
    const typeFilter = filterType.value;
    const genreFilter = filterGenre.value;
    const studioFilter = filterStudio.value;
    const yearFilter = filterYear.value;

    let filteredResults = results;

    if (typeFilter !== 'All') {
        filteredResults = filteredResults.filter(anime => anime.type === typeFilter);
    }
    if (genreFilter !== 'All') {
        filteredResults = filteredResults.filter(anime => 
            anime.genre && anime.genre.split(',').map(g => g.trim()).includes(genreFilter)
        );
    }
    if (studioFilter !== 'All') {
        filteredResults = filteredResults.filter(anime => anime.studio === studioFilter);
    }
    if (yearFilter !== 'All') {
        filteredResults = filteredResults.filter(anime => anime.year === yearFilter);
    }

    displaySearchResults(filteredResults);
}

function displaySearchResults(results) {
    animeGrid.innerHTML = '';
    if (results && results.length > 0) {
        results.forEach(anime => {
            const cardElement = createAnimeCard(anime);
            animeGrid.appendChild(cardElement);
        });
        updateStatus(`${results.length} Anime(s) gefunden.`);
    } else {
        animeGrid.innerHTML = '<p class="col-span-full text-center py-10 text-gray-500">Keine Animes gefunden.</p>';
        updateStatus("Keine Animes gefunden.");
    }
}

function initializeApp() {
    splashScreen.classList.remove('hidden');
    updateStatus("Anwendung wird initialisiert...");
    connectWebSocket();

    setTimeout(async () => {
        splashScreen.classList.add('hidden');
        appContainer.classList.remove('hidden');
        updateStatus("Anwendung bereit");

        try {
            const filterOptions = await api.getFilterOptions();
            populateFilters(filterOptions);
            animeGrid.innerHTML = '<p class="col-span-full text-center py-10 text-gray-500">Willkommen! Bitte geben Sie einen Suchbegriff ein oder wählen Sie Filter.</p>';
        } catch (error) {
            console.error("Fehler beim Initialisieren der App:", error);
            updateStatus(`Fehler bei der Initialisierung: ${error.message}`);
            animeGrid.innerHTML = '<p class="col-span-full text-center py-10 text-red-500">Fehler beim Laden der initialen Daten.</p>';
        }
    }, 2000);
}

function populateFilters(filterOptions) {
    const types = filterOptions.types || ["All"];
    filterType.innerHTML = '';
    types.forEach(type => {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = type;
        filterType.appendChild(option);
    });

    const genres = filterOptions.genres || ["All"];
    filterGenre.innerHTML = '';
    genres.forEach(genre => {
        const option = document.createElement('option');
        option.value = genre;
        option.textContent = genre;
        filterGenre.appendChild(option);
    });

    const studios = filterOptions.studios || ["All"];
    filterStudio.innerHTML = '';
    studios.forEach(studio => {
        const option = document.createElement('option');
        option.value = studio;
        option.textContent = studio;
        filterStudio.appendChild(option);
    });

    const years = filterOptions.years || ["All"];
    filterYear.innerHTML = '';
    years.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        filterYear.appendChild(option);
    });
}

function updateStatus(message) {
    statusMessage.textContent = message;
    console.log(`[Status] ${message}`);
}

function updateBackgroundCacheStatus(message) {
    backgroundCacheStatus.textContent = `Hintergrund-Cache: ${message}`;
    console.log(`[Cache Status] ${message}`);
}

function switchView(viewName) {
    Object.values(contentSections).forEach(section => {
        section.classList.remove('active');
    });
    Object.values(navLinks).forEach(link => {
        link.classList.remove('active');
    });

    if (contentSections[viewName]) {
        contentSections[viewName].classList.add('active');
        currentView = viewName;
        updateStatus(`Ansicht gewechselt zu: ${viewName}`);
        if (viewName === 'favorites') {
            displayFavorites();
        }
    } else {
        console.error(`Ansicht '${viewName}' nicht gefunden.`);
        updateStatus(`Fehler: Ansicht '${viewName}' nicht gefunden.`);
    }

    if (navLinks[viewName]) {
        navLinks[viewName].classList.add('active');
    }
}

function toggleFilterPanel() {
    isFilterPanelOpen = !isFilterPanelOpen;
    if (isFilterPanelOpen) {
        filterPanel.classList.add('show');
        filterToggleButton.classList.add('bg-purple-700');
        updateStatus("Filter-Panel geöffnet");
    } else {
        filterPanel.classList.remove('show');
        filterToggleButton.classList.remove('bg-purple-700');
        updateStatus("Filter-Panel geschlossen");
    }
}

function resetFilters() {
    filterType.value = 'All';
    filterGenre.value = 'All';
    filterStudio.value = 'All';
    filterYear.value = 'All';
    updateStatus("Filter zurückgesetzt");
    if (currentSearchResults.length > 0 || searchInput.value.trim() !== '') {
        applyFilters();
    }
}

function applyFilters() {
    const type = filterType.value;
    const genre = filterGenre.value;
    const studio = filterStudio.value;
    const year = filterYear.value;
    updateStatus(`Filter angewendet: Typ=${type}, Genre=${genre}, Studio=${studio}, Jahr=${year}`);
    filterAndDisplayResults(currentSearchResults);
}

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();

    navLinks.home?.addEventListener('click', (e) => {
        e.preventDefault();
        switchView('home');
    });
    navLinks.favorites?.addEventListener('click', (e) => {
        e.preventDefault();
        switchView('favorites');
    });
    navLinks.settings?.addEventListener('click', (e) => {
        e.preventDefault();
        switchView('settings');
    });

    filterToggleButton?.addEventListener('click', toggleFilterPanel);
    filterApplyButton?.addEventListener('click', applyFilters);
    filterResetButton?.addEventListener('click', resetFilters);

    searchButton?.addEventListener('click', async () => {
        const query = searchInput.value.trim();
        if (query || (filterType.value !== 'All' || filterGenre.value !== 'All' || filterStudio.value !== 'All' || filterYear.value !== 'All')) {
            try {
                const results = await searchAnime(query);
                currentSearchResults = results;
                filterAndDisplayResults(results);
            } catch (error) {
                console.error("Fehler bei der Suche:", error);
                updateStatus(`Fehler bei der Suche: ${error.message}`);
                animeGrid.innerHTML = '<p class="col-span-full text-center py-10 text-red-500">Fehler beim Laden der Ergebnisse.</p>';
            }
        } else {
            updateStatus("Bitte geben Sie einen Suchbegriff ein oder wählen Sie Filter.");
            animeGrid.innerHTML = '<p class="col-span-full text-center py-10 text-gray-500">Bitte geben Sie einen Suchbegriff ein oder wählen Sie Filter.</p>';
        }
    });

    searchInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchButton?.click();
        }
    });

    playlistClearButton?.addEventListener('click', () => {
        playlistItems.innerHTML = '<div class="flex-shrink-0 w-32 h-20 bg-gray-700 rounded flex items-center justify-center text-xs text-gray-500">Keine Einträge</div>';
        playlistBar.classList.add('hidden');
        updateStatus("Playlist geleert");
    });

    playlistPlayExternalButton?.addEventListener('click', () => {
        updateStatus("Abspielen in externem Player...");
    });

    playlistPlayWebButton?.addEventListener('click', () => {
        updateStatus("Abspielen im Webplayer...");
    });

    quitButton?.addEventListener('click', () => {
        if (confirm("Möchten Sie die Anwendung wirklich beenden?")) {
            updateStatus("Anwendung wird beendet...");
            setTimeout(() => {
                appContainer.innerHTML = '<div class="flex items-center justify-center h-full text-2xl">Anwendung beendet. Bitte schließen Sie dieses Fenster.</div>';
            }, 1000);
        }
    });

    playerChoice?.addEventListener('change', () => {
        localStorage.setItem('playerChoice', playerChoice.value);
        updateStatus(`Standard-Player geändert zu: ${playerChoice.value}`);
    });

    cacheInterval?.addEventListener('change', () => {
        const interval = parseInt(cacheInterval.value) * 60;
        fetch('/api/settings/cache_interval', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ interval })
        }).then(() => {
            updateStatus(`Cache-Intervall geändert zu: ${cacheInterval.value} Minuten`);
        }).catch(error => {
            updateStatus(`Fehler beim Ändern des Cache-Intervalls: ${error.message}`);
        });
    });

    clearCacheButton?.addEventListener('click', () => {
        if (confirm('Möchten Sie den Cache wirklich löschen?')) {
            fetch('/api/settings/clear_cache', { method: 'POST' })
                .then(() => {
                    updateStatus('Cache gelöscht.');
                })
                .catch(error => {
                    updateStatus(`Fehler beim Löschen des Caches: ${error.message}`);
                });
        }
    });
});