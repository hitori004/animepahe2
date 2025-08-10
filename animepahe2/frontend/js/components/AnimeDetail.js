import * as api from '../services/api.js';

const detailSection = document.getElementById('anime-detail-content');
const detailBackButton = document.getElementById('detail-back-button');
const detailTitle = document.getElementById('detail-anime-title');
const detailThumbnail = document.getElementById('detail-anime-thumbnail');
const detailSynopsis = document.getElementById('detail-anime-synopsis');
const detailInfoType = document.getElementById('detail-type');
const detailInfoGenre = document.getElementById('detail-genre');
const detailInfoStudio = document.getElementById('detail-studio');
const detailInfoYear = document.getElementById('detail-year');
const detailEpisodesList = document.getElementById('detail-anime-episodes');
const tabButtons = document.querySelectorAll('.tab-button');
const tabContents = document.querySelectorAll('.content-tab');

let currentAnimeSession = null;

function initializeTabNavigation() {
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

initializeTabNavigation();

export async function showAnimeDetail(session) {
    if (!detailSection) {
        console.error("Detailansicht-DOM-Elemente nicht gefunden.");
        return;
    }

    currentAnimeSession = session;
    document.getElementById('home-content')?.classList.remove('active');
    document.getElementById('favorites-content')?.classList.remove('active');
    document.getElementById('settings-content')?.classList.remove('active');
    
    detailSection.classList.add('active');
    initializeTabNavigation();
    resetTabsToDefault();
    
    detailTitle.textContent = "Lade...";
    detailThumbnail.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjY2NjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkxvYWRpbmcuLi48L3RleHQ+PC9zdmc+';
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
    detailTitle.textContent = details.title || "Unbekannt";
    detailThumbnail.src = api.normalizeThumbnailUrl(details.thumbnail) || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjY2NjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk5vIFRodW1ibmFpbDwvdGV4dD48L3N2Zz4=';
    
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
            if (player === 'mpv') {
                try {
                    const response = await api.getStreamUrls([{ session: currentAnimeSession, episode_session: ep.session }]);
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

if (detailBackButton) {
    detailBackButton.addEventListener('click', () => {
        detailSection.classList.remove('active');
        document.getElementById('home-content')?.classList.add('active');
    });
} else {
    console.warn("Detailansicht 'Zurück'-Button nicht gefunden.");
}