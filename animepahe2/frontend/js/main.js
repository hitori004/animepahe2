import * as api from './services/api.js';
import { showAnimeDetail } from './components/AnimeDetail.js';

// DOM-Elemente (deklariert, Zuweisung erfolgt später im DOMContentLoaded)
let appContainer, splashScreen, statusBar, statusMessage, backgroundCacheStatus;
let searchInput, searchButton, filterToggleButton, filterPanel, filterApplyButton, filterResetButton;
let filterType, filterGenre, filterStudio, filterYear;
let navLinks = {};
let contentSections = {};
let contentArea, animeGrid, favoritesGrid;
let playlistBar, playlistItems, playlistClearButton, playlistPlayExternalButton, playlistPlayWebButton;
let quitButton, playerChoice, cacheInterval, clearCacheButton;

// Zustand
let currentView = 'home';
let isFilterPanelOpen = false;
let currentSearchResults = [];
let favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
let currentPage = 1;
let itemsPerPage = 20;
let totalAnime = 0; // Hinzugefügt: Initialisierung der Variable

// Sicherheitscheck: Maximalwert begrenzen um 422 Fehler zu vermeiden
itemsPerPage = Math.max(1, Math.min(100, itemsPerPage)); // Zwischen 1 und 100

// WebSocket für Cache-Status
let ws = null;
function connectWebSocket() {
    try {
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
    } catch (err) {
        console.error('[WebSocket] Failed to create WebSocket:', err);
    }
}

async function searchAnime(query) {
    updateStatus(`Suche läuft für '${query}'...`);
    const filters = {
        type: filterType?.value,
        genre: filterGenre?.value,
        studio: filterStudio?.value,
        year: filterYear?.value
    };
    try {
        const results = await api.searchAnime(query, filters);
        console.log('[searchAnime] Ergebnisse:', results);
        updateStatus(`Suche abgeschlossen. ${Array.isArray(results) ? results.length : 0} Ergebnisse gefunden.`);
        return results || [];
    } catch (error) {
        console.error("Fehler bei der Suche:", error);
        updateStatus(`Fehler bei der Suche: ${error.message}`);
        throw error;
    }
}

function createAnimeCard(animeData) {
    console.log('[createAnimeCard] Anime-Daten:', animeData);
    const card = document.createElement('div');
    card.className = 'anime-card bg-gray-800 rounded-lg overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 cursor-pointer relative';
    card.dataset.session = animeData.session || animeData.identifier || animeData.id || animeData._id || animeData.slug || animeData.uuid || '';

    if (!card.dataset.session) {
        console.warn(`[createAnimeCard] Keine Session-ID für Anime: ${animeData.title}`, animeData);
    }

    const imgWrapper = document.createElement('div');
    imgWrapper.className = 'relative pb-[150%]';
    
    const img = document.createElement('img');
    img.alt = animeData.title || "Unbekannter Anime";
    img.className = 'absolute inset-0 w-full h-full object-cover pointer-events-none';
    img.loading = 'lazy';
    img.src = api.normalizeThumbnailUrl(animeData.thumbnail) || 'image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjY2NjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk5vIFRodW1ibmFpbDwvdGV4dD48L3N2Zz4=';

    const favoriteButton = document.createElement('button');
    favoriteButton.className = 'absolute top-2 right-2 p-1 bg-gray-900 bg-opacity-50 rounded-full';
    favoriteButton.innerHTML = favorites.some(f => f.session === card.dataset.session) ?
        '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3.172 5.172a3 3 0 014.242 0L10 7.757l2.586-2.585a3 3 0 014.242 4.242l-2.586 2.586a1 1 0 01-1.414 0L10 9.414l-2.586 2.586a1 1 0 01-1.414 0l-2.586-2.586a3 3 0 010-4.242z" clip-rule="evenodd" /></svg>' :
        '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3.172 5.172a3 3 0 014.242 0L10 7.757l2.586-2.585a3 3 0 014.242 4.242l-2.586 2.586a1 1 0 01-1.414 0L10 9.414l-2.586 2.586a1 1 0 01-1.414 0l-2.586-2.586a3 3 0 010-4.242z" clip-rule="evenodd" /></svg>';
    favoriteButton.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite({ session: card.dataset.session, title: animeData.title, thumbnail: animeData.thumbnail, type: animeData.type, year: animeData.year, studio: animeData.studio });
        favoriteButton.innerHTML = favorites.some(f => f.session === card.dataset.session) ?
            '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3.172 5.172a3 3 0 014.242 0L10 7.757l2.586-2.585a3 3 0 014.242 4.242l-2.586 2.586a1 1 0 01-1.414 0L10 9.414l-2.586 2.586a1 1 0 01-1.414 0l-2.586-2.586a3 3 0 010-4.242z" clip-rule="evenodd" /></svg>' :
            '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3.172 5.172a3 3 0 014.242 0L10 7.757l2.586-2.585a3 3 0 014.242 4.242l-2.586 2.586a1 1 0 01-1.414 0L10 9.414l-2.586 2.586a1 1 0 01-1.414 0l-2.586-2.586a3 3 0 010-4.242z" clip-rule="evenodd" /></svg>';
    });

    const titleOverlay = document.createElement('div');
    titleOverlay.className = 'absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity duration-300 pointer-events-none';
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

    card.addEventListener('click', (e) => {
        console.log('[AnimeCard Click] Ziel-Element:', e.target.tagName, e.target.className);
        console.log('[AnimeCard Click] Klick auf Karte:', { session: card.dataset.session, title: animeData.title });
        if (e.target === favoriteButton || favoriteButton.contains(e.target)) {
            console.log('[AnimeCard Click] Klick auf Favoriten-Button, ignoriere Kartenevent');
            return;
        }
        const session = card.dataset.session;
        if (session) {
            console.log(`[AnimeCard Click] Rufe showAnimeDetail auf für session: ${session}`);
            showAnimeDetail(session);
        } else {
            console.warn(`[AnimeCard Click] Keine Session-ID für Anime: ${animeData.title}`);
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

function _buildFilterPanelFallback() {
    // Falls die selects/markup fehlen, bauen wir das Panel hier dynamisch (sicherer Fallback).
    return `
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div>
                <label for="filter-type" class="block text-sm font-medium">Typ</label>
                <select id="filter-type" class="w-full px-4 py-2 bg-gray-700 rounded-lg text-white">
                    <option value="All">Alle</option>
                </select>
            </div>
            <div>
                <label for="filter-genre" class="block text-sm font-medium">Genre</label>
                <select id="filter-genre" class="w-full px-4 py-2 bg-gray-700 rounded-lg text-white">
                    <option value="All">Alle</option>
                </select>
            </div>
            <div>
                <label for="filter-studio" class="block text-sm font-medium">Studio</label>
                <select id="filter-studio" class="w-full px-4 py-2 bg-gray-700 rounded-lg text-white">
                    <option value="All">Alle</option>
                </select>
            </div>
            <div>
                <label for="filter-year" class="block text-sm font-medium">Jahr</label>
                <select id="filter-year" class="w-full px-4 py-2 bg-gray-700 rounded-lg text-white">
                    <option value="All">Alle</option>
                </select>
            </div>
        </div>
        <div class="mt-4 flex space-x-2">
            <button id="filter-apply-button" class="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg">Anwenden</button>
            <button id="filter-reset-button" class="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg">Zurücksetzen</button>
        </div>
    `;
}

function populateFilters(filterOptions) {
    console.log('[DEBUG filter] populateFilters called with:', filterOptions);
    if (!filterPanel) {
        console.warn('[DEBUG filter] populateFilters: filterPanel not found');
        return;
    }

    // If the selects are missing for some reason, create fallback markup
    if (!filterType || !filterGenre || !filterStudio || !filterYear) {
        console.warn('[DEBUG filter] Some filter selects missing, injecting fallback markup into filterPanel.');
        filterPanel.innerHTML = _buildFilterPanelFallback();
        // Re-assign DOM references to the newly created elements
        filterType = document.getElementById('filter-type');
        filterGenre = document.getElementById('filter-genre');
        filterStudio = document.getElementById('filter-studio');
        filterYear = document.getElementById('filter-year');
        filterApplyButton = document.getElementById('filter-apply-button');
        filterResetButton = document.getElementById('filter-reset-button');

        // Re-bind handlers (safe even if they were bound before)
        filterApplyButton?.addEventListener('click', applyFilters);
        filterResetButton?.addEventListener('click', resetFilters);
    }

    // Guard for the case where API returns unexpected shape
    const types = Array.isArray(filterOptions?.types) ? filterOptions.types : (filterOptions?.type_list || filterOptions?.types_list || ["All"]);
    const genres = Array.isArray(filterOptions?.genres) ? filterOptions.genres : (filterOptions?.genre_list || filterOptions?.genres_list || ["All"]);
    const studios = Array.isArray(filterOptions?.studios) ? filterOptions.studios : (filterOptions?.studio_list || filterOptions?.studios_list || ["All"]);
    const years = Array.isArray(filterOptions?.years) ? filterOptions.years : (filterOptions?.year_list || filterOptions?.years_list || ["All"]);

    // Helper to fill a select element
    function fillSelect(selectEl, items, label) {
        if (!selectEl) {
            console.warn(`[DEBUG filter] fillSelect: select element for ${label} missing`);
            return;
        }
        selectEl.innerHTML = '';
        const allOption = document.createElement('option');
        allOption.value = 'All';
        allOption.textContent = 'Alle';
        selectEl.appendChild(allOption);

        (items || []).forEach(item => {
            const option = document.createElement('option');
            option.value = item;
            option.textContent = String(item);
            selectEl.appendChild(option);
        });
        console.log(`[DEBUG filter] Filled select ${label} with ${selectEl.options.length} options`);
    }

    fillSelect(filterType, types, 'type');
    fillSelect(filterGenre, genres, 'genre');
    fillSelect(filterStudio, studios, 'studio');
    fillSelect(filterYear, years, 'year');

    // Extra debug: log the DOM state of filterPanel
    console.log('[DEBUG filter] filterPanel classes:', filterPanel.className, 'computedStyle.display:', window.getComputedStyle(filterPanel).display);
}

function filterAndDisplayResults(results) {
    const typeFilter = filterType?.value || 'All';
    const genreFilter = filterGenre?.value || 'All';
    const studioFilter = filterStudio?.value || 'All';
    const yearFilter = filterYear?.value || 'All';

    let filteredResults = (Array.isArray(results) ? results : []).slice();

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

    displaySearchResults(filteredResults, currentPage, totalAnime);
}

function displaySearchResults(results, page = 1, total = 0) {
    console.log('[DEBUG displaySearchResults] results:', results);
    console.log('[DEBUG displaySearchResults] page:', page, 'total:', total);
    console.log('[DEBUG displaySearchResults] results type:', typeof results);
    console.log('[DEBUG displaySearchResults] results length:', results ? results.length : 'undefined');
    
    if (!animeGrid) {
        console.warn('[displaySearchResults] animeGrid not found');
        return;
    }
    animeGrid.innerHTML = '';
    
    // Sicherstellen, dass results ein Array ist
    const safeResults = Array.isArray(results) ? results : [];
    
    if (safeResults.length > 0) {
        console.log('[displaySearchResults] Rendern von Ergebnissen:', safeResults);
        safeResults.forEach(anime => {
            const cardElement = createAnimeCard(anime);
            animeGrid.appendChild(cardElement);
        });
        updateStatus(`${safeResults.length} Anime(s) auf Seite ${page} von ${Math.ceil(total / itemsPerPage)} gefunden.`);
    } else {
        animeGrid.innerHTML = '<p class="col-span-full text-center py-10 text-gray-500">Keine Animes gefunden.</p>';
        updateStatus("Keine Animes gefunden.");
    }
    updatePaginationControls(page, total);
}

function updatePaginationControls(page, total) {
    const pageInfo = document.getElementById('page-info');
    const prevButton = document.getElementById('prev-page');
    const nextButton = document.getElementById('next-page');
    const totalPages = Math.ceil(total / itemsPerPage);

    if (pageInfo) {
        pageInfo.textContent = `Seite ${page} von ${totalPages}`;
    }
    if (prevButton) {
        prevButton.disabled = page <= 1;
    }
    if (nextButton) {
        nextButton.disabled = page >= totalPages;
    }
}

async function loadAnimePage(page) {
    try {
        // SICHERHEIT: Verwende immer einen sicheren Wert
        const safeLimit = Math.max(1, Math.min(100, itemsPerPage));
        console.log(`[loadAnimePage] Lade Seite ${page}, Limit: ${safeLimit} (original itemsPerPage: ${itemsPerPage})`);
        
        updateStatus(`Lade Anime für Seite ${page}...`);
        const response = await api.getAllCachedAnime(page, safeLimit);
        console.log('[loadAnimePage] API Response:', response);
        
        // Korrekte Datenverarbeitung
        currentSearchResults = response.results || [];
        totalAnime = response.total || 0;
        
        console.log('[loadAnimePage] currentSearchResults:', currentSearchResults);
        console.log('[loadAnimePage] totalAnime:', totalAnime);
        console.log('[loadAnimePage] currentSearchResults length:', currentSearchResults.length);
        
        displaySearchResults(currentSearchResults, page, totalAnime);
    } catch (err) {
        console.error("Fehler beim Laden der Anime-Seite:", err);
        updateStatus(`Fehler beim Laden der Anime-Seite: ${err.message}`);
        if (animeGrid) animeGrid.innerHTML = '<p class="col-span-full text-center py-10 text-red-500">Fehler beim Laden der Anime.</p>';
    }
}

function initializeApp() {
    if (splashScreen) splashScreen.classList.remove('hidden');
    updateStatus("Anwendung wird initialisiert...");
    connectWebSocket();

    setTimeout(async () => {
        if (splashScreen) splashScreen.classList.add('hidden');
        if (appContainer) appContainer.classList.remove('hidden');
        updateStatus("Anwendung bereit");

        try {
            const filterOptions = await api.getFilterOptions();
            console.log('[initializeApp] Filteroptionen (raw):', filterOptions);
            populateFilters(filterOptions || {});
            if (animeGrid) animeGrid.innerHTML = '<p class="col-span-full text-center py-10 text-gray-500">Willkommen! Bitte geben Sie einen Suchbegriff ein oder wählen Sie Filter.</p>';
            // Initiale Seite laden
            loadAnimePage(currentPage);
        } catch (error) {
            console.error("Fehler beim Initialisieren der App:", error);
            updateStatus(`Fehler bei der Initialisierung: ${error.message}`);
            if (animeGrid) animeGrid.innerHTML = '<p class="col-span-full text-center py-10 text-red-500">Fehler beim Laden der initialen Daten.</p>';
        }
    }, 400); // kürzerer Splash für Entwicklung
}

function updateStatus(message) {
    if (statusMessage) statusMessage.textContent = message;
    console.log(`[Status] ${message}`);
}

function updateBackgroundCacheStatus(message) {
    if (backgroundCacheStatus) backgroundCacheStatus.textContent = `Hintergrund-Cache: ${message}`;
    console.log(`[Cache Status] ${message}`);
}

function switchView(viewName) {
    Object.values(contentSections).forEach(section => {
        section.classList.remove('active');
        section.classList.add('hidden');
    });
    Object.values(navLinks).forEach(link => {
        link.classList.remove('active', 'bg-gray-700');
    });

    if (contentSections[viewName]) {
        contentSections[viewName].classList.remove('hidden');
        contentSections[viewName].classList.add('active');
        currentView = viewName;
        updateStatus(`Ansicht gewechselt zu: ${viewName}`);

        if (viewName === 'favorites') {
            displayFavorites();
        } else if (viewName === 'home') {
            const queryIsEmpty = !(searchInput && searchInput.value && searchInput.value.trim() !== '');
            const filtersAreAll = (filterType?.value === 'All' && filterGenre?.value === 'All' && filterStudio?.value === 'All' && filterYear?.value === 'All');

            if (currentSearchResults && currentSearchResults.length > 0 && (!queryIsEmpty || !filtersAreAll)) {
                displaySearchResults(currentSearchResults, currentPage, totalAnime);
            } else {
                loadAnimePage(currentPage);
            }
        }
    } else {
        console.error(`Ansicht '${viewName}' nicht gefunden.`);
        updateStatus(`Fehler: Ansicht '${viewName}' nicht gefunden.`);
    }

    if (navLinks[viewName]) {
        navLinks[viewName].classList.add('active', 'bg-gray-700');
    }
}

function toggleFilterPanel() {
    if (!filterPanel) {
        console.warn('toggleFilterPanel: filterPanel DOM-Element nicht gefunden.');
        return;
    }

    isFilterPanelOpen = !isFilterPanelOpen;

    filterPanel.classList.toggle('hidden', !isFilterPanelOpen);
    filterPanel.classList.toggle('show', isFilterPanelOpen);
    filterPanel.style.display = isFilterPanelOpen ? 'block' : 'none';
    filterPanel.style.zIndex = isFilterPanelOpen ? '9999' : '';

    if (filterToggleButton) {
        filterToggleButton.classList.toggle('bg-purple-700', isFilterPanelOpen);
    }
    updateStatus(isFilterPanelOpen ? "Filter-Panel geöffnet" : "Filter-Panel geschlossen");

    console.log('[DEBUG filter] toggleFilterPanel -> isOpen:', isFilterPanelOpen);
    console.log('[DEBUG filter] filterPanel.className:', filterPanel.className);
    console.log('[DEBUG filter] filterPanel.style.display:', filterPanel.style.display, 'computed:', window.getComputedStyle(filterPanel).display);
}

function resetFilters() {
    if (filterType) filterType.value = 'All';
    if (filterGenre) filterGenre.value = 'All';
    if (filterStudio) filterStudio.value = 'All';
    if (filterYear) filterYear.value = 'All';
    updateStatus("Filter zurückgesetzt");
    if (currentSearchResults.length > 0 || (searchInput && searchInput.value.trim() !== '')) {
        applyFilters();
    }
}

function applyFilters() {
    const type = filterType?.value || 'All';
    const genre = filterGenre?.value || 'All';
    const studio = filterStudio?.value || 'All';
    const year = filterYear?.value || 'All';
    updateStatus(`Filter angewendet: Typ=${type}, Genre=${genre}, Studio=${studio}, Jahr=${year}`);
    filterAndDisplayResults(currentSearchResults);
}

// Events & Init
document.addEventListener('DOMContentLoaded', () => {
    appContainer = document.getElementById('app');
    splashScreen = document.getElementById('splash-screen');
    statusBar = document.getElementById('status-bar');
    statusMessage = document.getElementById('status-message');
    backgroundCacheStatus = document.getElementById('background-cache-status');

    searchInput = document.getElementById('search-input');
    searchButton = document.getElementById('search-button');
    filterToggleButton = document.getElementById('filter-toggle-button');
    filterPanel = document.getElementById('filter-panel');
    filterApplyButton = document.getElementById('filter-apply-button');
    filterResetButton = document.getElementById('filter-reset-button');
    filterType = document.getElementById('filter-type');
    filterGenre = document.getElementById('filter-genre');
    filterStudio = document.getElementById('filter-studio');
    filterYear = document.getElementById('filter-year');

    navLinks = {
        home: document.getElementById('nav-home'),
        favorites: document.getElementById('nav-favorites'),
        settings: document.getElementById('nav-settings')
    };

    contentSections = {
        home: document.getElementById('home-content'),
        favorites: document.getElementById('favorites-content'),
        settings: document.getElementById('settings-content'),
        detail: document.getElementById('anime-detail-content')
    };

    contentArea = document.getElementById('content-area');
    animeGrid = document.getElementById('anime-grid');
    favoritesGrid = document.getElementById('favorites-grid');

    playlistBar = document.getElementById('playlist-bar');
    playlistItems = document.getElementById('playlist-items');
    playlistClearButton = document.getElementById('playlist-clear-button');
    playlistPlayExternalButton = document.getElementById('playlist-play-external-button');
    playlistPlayWebButton = document.getElementById('playlist-play-web-button');

    quitButton = document.getElementById('quit-button');
    playerChoice = document.getElementById('player-choice');
    cacheInterval = document.getElementById('cache-interval');
    clearCacheButton = document.getElementById('clear-cache-button');

    const prevPageButton = document.getElementById('prev-page');
    const nextPageButton = document.getElementById('next-page');

    prevPageButton?.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            loadAnimePage(currentPage);
        }
    });

    nextPageButton?.addEventListener('click', () => {
        currentPage++;
        loadAnimePage(currentPage);
    });

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
        const filtersAreAll = (filterType?.value === 'All' && filterGenre?.value === 'All' && filterStudio?.value === 'All' && filterYear?.value === 'All');

        if (!query && filtersAreAll) {
            try {
                updateStatus("Lade alle gecachten Animes...");
                currentPage = 1; // Zurück auf Seite 1 bei neuer Suche
                await loadAnimePage(currentPage);
            } catch (error) {
                console.error("Fehler beim Laden der gecachten Animes:", error);
                updateStatus(`Fehler beim Laden gecachter Animes: ${error.message}`);
                if (animeGrid) animeGrid.innerHTML = '<p class="col-span-full text-center py-10 text-red-500">Fehler beim Laden der gecachten Animes.</p>';
            }
            return;
        }

        if (query || (filterType?.value !== 'All' || filterGenre?.value !== 'All' || filterStudio?.value !== 'All' || filterYear?.value !== 'All')) {
            try {
                const results = await searchAnime(query);
                currentSearchResults = results;
                totalAnime = results.length; // Für Suchen ohne Paginierung
                currentPage = 1;
                filterAndDisplayResults(results);
            } catch (error) {
                console.error("Fehler bei der Suche:", error);
                updateStatus(`Fehler bei der Suche: ${error.message}`);
                if (animeGrid) animeGrid.innerHTML = '<p class="col-span-full text-center py-10 text-red-500">Fehler beim Laden der Ergebnisse.</p>';
            }
        } else {
            updateStatus("Bitte geben Sie einen Suchbegriff ein oder wählen Sie Filter.");
            if (animeGrid) animeGrid.innerHTML = '<p class="col-span-full text-center py-10 text-gray-500">Bitte geben Sie einen Suchbegriff ein oder wählen Sie Filter.</p>';
        }
    });

    searchInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchButton?.click();
        }
    });

    playlistClearButton?.addEventListener('click', () => {
        if (playlistItems) playlistItems.innerHTML = '<div class="flex-shrink-0 w-32 h-20 bg-gray-700 rounded flex items-center justify-center text-xs text-gray-500">Keine Einträge</div>';
        if (playlistBar) playlistBar.classList.add('hidden');
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
                if (appContainer) appContainer.innerHTML = '<div class="flex items-center justify-center h-full text-2xl">Anwendung beendet. Bitte schließen Sie dieses Fenster.</div>';
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

    initializeApp();
    
    // DEBUG: Zeige den finalen Wert von itemsPerPage
    console.log('[DEBUG] Finaler itemsPerPage Wert:', itemsPerPage);
});

// Exports
export { switchView };