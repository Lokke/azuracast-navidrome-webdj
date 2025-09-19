import "./style.css";
import { NavidromeClient, type NavidromeSong, type NavidromeAlbum, type NavidromeArtist } from "./navidrome";
import WaveSurfer from 'wavesurfer.js';

console.log("DJ Radio Webapp loaded!");

// Player Deck Fragment Template
function createPlayerDeckHTML(side: 'left' | 'right'): string {
  const playerLetter = side === 'left' ? 'A' : 'B';
  
  return `
    <div class="player-header">
      <h3>Player ${playerLetter}</h3>
      <audio id="audio-${side}" preload="metadata"></audio>
    </div>
    
    <div class="player-main">
      <!-- Album Cover -->
      <div class="album-cover" id="album-cover-${side}">
        <div class="no-cover">
          <span class="material-icons">music_note</span>
        </div>
      </div>
      
      <!-- Track Info & Controls -->
      <div class="player-content">
        <div class="track-info">
          <div class="track-title" id="track-title-${side}">No Track Loaded</div>
          <div class="track-artist" id="track-artist-${side}">-</div>
        </div>
        
        <!-- Transport Controls -->
        <div class="transport-controls">
          <button class="play-pause-btn" id="play-pause-${side}" title="Play/Pause">
            <span class="material-icons">play_arrow</span>
          </button>
          <button class="restart-btn" id="restart-${side}" title="Restart">
            <span class="material-icons">skip_previous</span>
          </button>
          <button class="eject-btn" id="eject-${side}" title="Eject">
            <span class="material-icons">eject</span>
          </button>
        </div>
        
        <!-- Rating Display -->
        <div class="player-rating" id="player-rating-${side}"></div>
        
        <!-- Progress & Time Display -->
        <div class="progress-section">
          <div class="time-display" id="time-display-${side}">0:00 / 0:00</div>
          <div class="progress-bar" id="progress-bar-${side}">
            <div class="waveform" id="waveform-${side}"></div>
          </div>
        </div>
      </div>
      
      <!-- Volume Control (Portrait: Right Side) -->
      <div class="volume-section">
        <div class="volume-control">
          <input type="range" min="0" max="100" value="80" id="volume-${side}" orient="vertical">
          <div class="volume-label">VOL</div>
        </div>
      </div>
    </div>
  `;
}

// Initialize Player Decks
function initializePlayerDecks() {
  const playerLeft = document.getElementById('player-left');
  const playerRight = document.getElementById('player-right');
  
  if (playerLeft) {
    playerLeft.innerHTML = createPlayerDeckHTML('left');
  }
  
  if (playerRight) {
    playerRight.innerHTML = createPlayerDeckHTML('right');
  }
  
  console.log('Player decks initialized with professional layout');
}

// Update Album Cover Function
function updateAlbumCover(side: 'left' | 'right', song: NavidromeSong) {
  const albumCoverElement = document.getElementById(`album-cover-${side}`);
  console.log(`🎨 Updating album cover for ${side} player:`, {
    element: albumCoverElement,
    song: song.title,
    coverArt: song.coverArt,
    navidromeClient: !!navidromeClient
  });
  
  if (!albumCoverElement) {
    console.error(`❌ Album cover element not found: album-cover-${side}`);
    return;
  }
  
  if (!navidromeClient) {
    console.warn(`❌ Navidrome client not available`);
    albumCoverElement.innerHTML = `
      <div class="no-cover">
        <span class="material-icons">music_note</span>
      </div>
    `;
    return;
  }
  
  if (song.coverArt) {
    const coverUrl = navidromeClient.getCoverArtUrl(song.coverArt, 90);
    console.log(`🖼️ Setting cover URL: ${coverUrl}`);
    
    const img = document.createElement('img');
    img.src = coverUrl;
    img.alt = 'Album Cover';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    
    // Debug: Check if image loads
    img.onload = () => {
      console.log(`✅ Album cover loaded successfully for ${side}`);
    };
    img.onerror = (error) => {
      console.error(`❌ Album cover failed to load for ${side}:`, error);
      console.error(`Failed URL: ${coverUrl}`);
      // Fallback to no-cover display
      albumCoverElement.innerHTML = `
        <div class="no-cover">
          <span class="material-icons">music_note</span>
        </div>
      `;
    };
    
    albumCoverElement.innerHTML = '';
    albumCoverElement.appendChild(img);
  } else {
    console.log(`❓ No cover art for song: ${song.title}`);
    albumCoverElement.innerHTML = `
      <div class="no-cover">
        <span class="material-icons">music_note</span>
      </div>
    `;
  }
}

// Update Time Display Function
function updateTimeDisplay(side: 'left' | 'right', currentTime: number, duration: number) {
  const timeDisplay = document.getElementById(`time-display-${side}`);
  if (!timeDisplay) return;
  
  const current = formatTime(currentTime);
  const total = formatTime(duration);
  timeDisplay.textContent = `${current} / ${total}`;
}

// Format time helper function
function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// WaveSurfer instances for both players
const waveSurfers: { [key in 'left' | 'right']?: WaveSurfer } = {};

// Initialize WaveSurfer for a player
function initializeWaveSurfer(side: 'left' | 'right'): WaveSurfer {
  const container = document.getElementById(`waveform-${side}`);
  if (!container) {
    throw new Error(`Waveform container not found for ${side} player`);
  }

  // Destroy existing wavesurfer if it exists
  if (waveSurfers[side]) {
    waveSurfers[side]!.destroy();
  }

  // Create new WaveSurfer instance
  const wavesurfer = WaveSurfer.create({
    container: container,
    waveColor: '#666',
    progressColor: '#00ff88',
    cursorColor: '#ffffff',
    barWidth: 2,
    barGap: 1,
    height: 50,
    normalize: true,
    backend: 'WebAudio'
  });

  waveSurfers[side] = wavesurfer;
  return wavesurfer;
}

// Reset WaveSurfer for a new track
function resetWaveform(side: 'left' | 'right') {
  const wavesurfer = waveSurfers[side];
  if (wavesurfer) {
    // Stop playback and reset to beginning
    wavesurfer.stop();
    wavesurfer.seekTo(0);
    console.log(`Waveform reset for ${side} player`);
  }
}

// Load audio file into WaveSurfer for a player
function loadWaveform(side: 'left' | 'right', audioUrl: string) {
  console.log(`Loading new waveform for ${side} player from: ${audioUrl}`);
  
  // Reset existing waveform first
  resetWaveform(side);
  
  // Initialize WaveSurfer if not exists
  if (!waveSurfers[side]) {
    initializeWaveSurfer(side);
  }
  
  const wavesurfer = waveSurfers[side]!;
  
  // Load the new audio file (this will reset the waveform)
  wavesurfer.load(audioUrl);
  
  // Optional: Add event listeners
  wavesurfer.on('ready', () => {
    console.log(`New waveform ready for ${side} player - progress reset to 0`);
    // Ensure we're at the beginning
    wavesurfer.seekTo(0);
  });
  
  wavesurfer.on('error', (error) => {
    console.error(`Waveform error for ${side} player:`, error);
  });
}

// Sync WaveSurfer with HTML audio element
function syncWaveSurferWithAudio(side: 'left' | 'right', audio: HTMLAudioElement) {
  const wavesurfer = waveSurfers[side];
  if (!wavesurfer) return;
  
  // Flag to prevent sync loops
  let syncing = false;
  
  // Store event handlers to properly remove them later
  const eventHandlers = {
    play: () => {
      if (syncing) return;
      syncing = true;
      // Only sync if WaveSurfer is not already playing to avoid loop
      if (!wavesurfer.isPlaying()) {
        wavesurfer.play();
      }
      syncing = false;
    },
    pause: () => {
      if (syncing) return;
      syncing = true;
      // Only sync if WaveSurfer is playing to avoid loop
      if (wavesurfer.isPlaying()) {
        wavesurfer.pause();
      }
      syncing = false;
    },
    seeked: () => {
      if (syncing) return;
      const progress = audio.currentTime / audio.duration;
      wavesurfer.seekTo(progress || 0);
    },
    loadstart: () => {
      resetWaveform(side);
    }
  };
  
  // Remove any existing listeners first
  if ((audio as any)._wavesurferHandlers) {
    const oldHandlers = (audio as any)._wavesurferHandlers;
    audio.removeEventListener('play', oldHandlers.play);
    audio.removeEventListener('pause', oldHandlers.pause);
    audio.removeEventListener('seeked', oldHandlers.seeked);
    audio.removeEventListener('loadstart', oldHandlers.loadstart);
  }
  
  // Add fresh event listeners
  audio.addEventListener('play', eventHandlers.play);
  audio.addEventListener('pause', eventHandlers.pause);
  audio.addEventListener('seeked', eventHandlers.seeked);
  audio.addEventListener('loadstart', eventHandlers.loadstart);
  
  // Store handlers for later cleanup
  (audio as any)._wavesurferHandlers = eventHandlers;
}

// Clean up WaveSurfer sync for a player
function cleanupWaveSurferSync(side: 'left' | 'right') {
  const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
  if (audio && (audio as any)._wavesurferHandlers) {
    const handlers = (audio as any)._wavesurferHandlers;
    audio.removeEventListener('play', handlers.play);
    audio.removeEventListener('pause', handlers.pause);
    audio.removeEventListener('seeked', handlers.seeked);
    audio.removeEventListener('loadstart', handlers.loadstart);
    delete (audio as any)._wavesurferHandlers;
  }
}

// Navidrome Client (wird später mit echten Credentials initialisiert)
let navidromeClient: NavidromeClient;

// Globale Variablen
let currentSongs: NavidromeSong[] = [];
let currentAlbums: NavidromeAlbum[] = [];
let currentArtists: NavidromeArtist[] = [];
let queue: NavidromeSong[] = [];
let autoQueueEnabled = true; // Auto-Queue standardmäßig aktiviert

document.addEventListener("DOMContentLoaded", async () => {
  console.log("DOM fully loaded and parsed");
  
  // Initialize Player Decks
  initializePlayerDecks();
  
  // Login-Formular initialisieren
  initializeNavidromeLogin();
  
  // Mikrofon Toggle Funktionalität
  const micBtn = document.getElementById("mic-toggle") as HTMLButtonElement;
  let micActive = false;
  
  micBtn?.addEventListener("click", () => {
    micActive = !micActive;
    
    if (micActive) {
      micBtn.classList.add("active");
      micBtn.innerHTML = '<span class="material-icons">mic</span> MIKROFON AN';
      console.log("Mikrofon aktiviert - pulsiert rot");
    } else {
      micBtn.classList.remove("active");
      micBtn.innerHTML = '<span class="material-icons">mic</span> MIKROFON';
      console.log("Mikrofon deaktiviert");
    }
  });
  
  // Broadcast Button Funktionalität
  const broadcastBtn = document.getElementById("broadcast-toggle") as HTMLButtonElement;
  let broadcastActive = false;
  
  broadcastBtn?.addEventListener("click", () => {
    broadcastActive = !broadcastActive;
    
    if (broadcastActive) {
      broadcastBtn.innerHTML = '<span class="material-icons">radio</span> LIVE';
      broadcastBtn.style.background = "linear-gradient(135deg, #ff3333 0%, #cc0000 100%)";
      console.log("Broadcast aktiviert");
    } else {
      broadcastBtn.innerHTML = '<span class="material-icons">radio</span> Broadcast';
      broadcastBtn.style.background = "linear-gradient(135deg, #ff8800 0%, #cc6600 100%)";
      console.log("Broadcast deaktiviert");
    }
  });

  // Auto-Queue Toggle Funktionalität für alle Buttons
  const autoQueueButtons = document.querySelectorAll(".auto-queue-btn") as NodeListOf<HTMLButtonElement>;
  
  autoQueueButtons.forEach(autoQueueBtn => {
    autoQueueBtn?.addEventListener("click", () => {
      autoQueueEnabled = !autoQueueEnabled;
      
      // Alle Auto-Queue Buttons synchron aktualisieren
      autoQueueButtons.forEach(btn => {
        if (autoQueueEnabled) {
          btn.textContent = "🔄 AUTO-QUEUE";
          btn.classList.remove("inactive");
        } else {
          btn.textContent = "⏸ AUTO-QUEUE";
          btn.classList.add("inactive");
        }
      });
      
      console.log(autoQueueEnabled ? "Auto-Queue aktiviert" : "Auto-Queue deaktiviert");
    });
  });
  
  // Tab Navigation
  initializeTabs();
  
  // Search Funktionalität
  initializeSearch();
  
  // Queue Drag & Drop (permanent initialisieren)
  initializeQueuePermanent();
  
  // Audio Player initialisieren
  initializeAudioPlayers();
  
  // Rating-Event-Listeners initialisieren
  initializeRatingListeners();
});

// Musikbibliothek initialisieren
async function initializeMusicLibrary() {
  console.log("Initializing music library...");
  
  try {
    // Lade initial Songs
    await loadSongs();
    
    // Lade Albums
    await loadAlbums();
    
    // Lade Artists
    await loadArtists();
    
  } catch (error) {
    console.error("Error loading music library:", error);
    showError("Error loading music library: " + error);
  }
}

// Tab Navigation initialisieren
function initializeTabs() {
  const tabBtns = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  
  console.log(`Found ${tabBtns.length} tab buttons and ${tabContents.length} tab contents`);
  
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.getAttribute('data-tab');
      console.log(`Switching to tab: ${tabName}`);
      
      // Alle Tabs deaktivieren
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(content => {
        content.classList.remove('active');
        (content as HTMLElement).style.display = 'none';
      });
      
      // Aktiven Tab aktivieren
      btn.classList.add('active');
      const activeContent = document.getElementById(`tab-${tabName}`);
      if (activeContent) {
        activeContent.classList.add('active');
        activeContent.style.display = 'flex';
        console.log(`Activated tab content: tab-${tabName}`);
        
        // Re-initialize listeners for the active tab if needed
        if (tabName === 'albums') {
          setTimeout(() => {
            const albumsContainer = document.getElementById('albums-grid');
            if (albumsContainer) {
              addAlbumClickListeners(albumsContainer);
              console.log('Re-added album click listeners after tab switch');
            }
          }, 100);
        } else if (tabName === 'artists') {
          setTimeout(() => {
            const artistsContainer = document.getElementById('artists-list');
            if (artistsContainer) {
              addArtistClickListeners(artistsContainer);
              console.log('Re-added artist click listeners after tab switch');
            }
          }, 100);
        }
      } else {
        console.error(`Tab content not found: tab-${tabName}`);
      }
    });
  });
}

// Search Funktionalität initialisieren
function initializeSearch() {
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  const searchBtn = document.getElementById('search-btn') as HTMLButtonElement;
  
  const performSearch = async () => {
    if (!navidromeClient) {
      showError('Not connected to Navidrome');
      return;
    }
    
    const query = searchInput.value.trim();
    
    // Wenn Suchfeld leer ist, zeige No Search State
    if (!query) {
      showNoSearchState();
      return;
    }
    
    console.log('Searching for:', query);
    
    try {
      showSearchLoading();
      const results = await navidromeClient.search(query);
      displaySearchResults(results);
    } catch (error) {
      console.error('Search error:', error);
      showError('Search failed: ' + error);
    }
  };
  
  searchBtn?.addEventListener('click', performSearch);
  searchInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  });
  
  // Bei Eingabe-Änderungen auch prüfen
  searchInput?.addEventListener('input', () => {
    // Wenn Feld geleert wird, zeige No Search State
    if (!searchInput.value.trim()) {
      showNoSearchState();
    }
  });
}

// Songs laden
async function loadSongs() {
  if (!navidromeClient) return;
  
  console.log('Loading songs...');
  const songsContainer = document.getElementById('songs-list');
  if (!songsContainer) return;
  
  try {
    currentSongs = await navidromeClient.getSongs(100);
    console.log(`Loaded ${currentSongs.length} songs`);
    
    // Erstelle Songs-Tabelle mit Header
    let html = '<div class="songs-table-header">';
    html += '<div class="header-cover">Cover</div>';
    html += '<div class="header-title">Title</div>';
    html += '<div class="header-artist">Artist</div>';
    html += '<div class="header-album">Album</div>';
    html += '<div class="header-rating">Rating</div>';
    html += '<div class="header-duration">Duration</div>';
    html += '</div>';
    html += '<div class="songs-table">' + currentSongs.map(song => createSongHTMLOneline(song)).join('') + '</div>';
    
    songsContainer.innerHTML = html;
    addDragListeners(songsContainer);
    addSongClickListeners(songsContainer);
  } catch (error) {
    console.error('Error loading songs:', error);
    songsContainer.innerHTML = '<div class="loading">Error loading songs</div>';
  }
}

// Albums laden
async function loadAlbums() {
  if (!navidromeClient) return;
  
  console.log('Loading albums...');
  const albumsContainer = document.getElementById('albums-grid');
  if (!albumsContainer) return;
  
  try {
    currentAlbums = await navidromeClient.getAlbums(50);
    console.log(`Loaded ${currentAlbums.length} albums`);
    
    albumsContainer.innerHTML = currentAlbums.map(album => createAlbumHTML(album)).join('');
    
    // Hinzufügen der Click Listener für Albums
    setTimeout(() => {
      addAlbumClickListeners(albumsContainer);
      console.log('Album click listeners added to albums grid');
    }, 50);
  } catch (error) {
    console.error('Error loading albums:', error);
    albumsContainer.innerHTML = '<div class="loading">Error loading albums</div>';
  }
}

// Artists laden
async function loadArtists() {
  if (!navidromeClient) return;
  
  console.log('Loading artists...');
  const artistsContainer = document.getElementById('artists-list');
  if (!artistsContainer) return;
  
  try {
    currentArtists = await navidromeClient.getArtists();
    console.log(`Loaded ${currentArtists.length} artists`);
    
    artistsContainer.innerHTML = currentArtists.map(artist => createArtistHTML(artist)).join('');
    
    // Hinzufügen der Click Listener für Artists
    setTimeout(() => {
      addArtistClickListeners(artistsContainer);
      console.log('Artist click listeners added to artists list');
    }, 50);
  } catch (error) {
    console.error('Error loading artists:', error);
    artistsContainer.innerHTML = '<div class="loading">Error loading artists</div>';
  }
}

// Song HTML erstellen
// Song HTML als Einzeiler für einheitliche Darstellung erstellen

// Hilfsfunktion zum Erstellen von Artist-Links aus dem artists Array
function createArtistLinks(song: NavidromeSong): string {
  // Verwende artists Array falls verfügbar, sonst Fallback auf artist string
  if (song.artists && song.artists.length > 0) {
    if (song.artists.length === 1) {
      const artist = song.artists[0];
      return `<span class="clickable-artist" draggable="false" data-artist-id="${artist.id}" data-artist-name="${escapeHtml(artist.name)}" title="View artist details">${escapeHtml(artist.name)}</span>`;
    } else {
      // Multiple Artists - jeder einzeln klickbar
      const artistLinks = song.artists.map(artist => 
        `<span class="clickable-artist" draggable="false" data-artist-id="${artist.id}" data-artist-name="${escapeHtml(artist.name)}" title="View artist details">${escapeHtml(artist.name)}</span>`
      ).join('<span class="artist-separator"> • </span>');
      
      return `<span class="multi-artist">${artistLinks}</span>`;
    }
  } else {
    // Fallback für alte API oder wenn artists Array nicht verfügbar
    return `<span class="clickable-artist" draggable="false" data-artist-name="${escapeHtml(song.artist)}" title="View artist details">${escapeHtml(song.artist)}</span>`;
  }
}
function createSongHTMLOneline(song: NavidromeSong): string {
  const duration = formatDuration(song.duration);
  const coverUrl = song.coverArt && navidromeClient ? navidromeClient.getCoverArtUrl(song.coverArt, 60) : '';
  
  return `
    <div class="track-item-oneline" draggable="true" data-song-id="${song.id}" data-cover-art="${song.coverArt || ''}" data-type="song">
      <div class="track-cover">
        ${coverUrl ? `<img src="${coverUrl}" alt="Cover" />` : '<div class="no-cover"><span class="material-icons">music_note</span></div>'}
      </div>
      <div class="track-title">${escapeHtml(song.title)}</div>
      <div class="track-artist">${createArtistLinks(song)}</div>
      <div class="track-album clickable-album" draggable="false" data-album-id="${song.albumId || ''}" data-album-name="${escapeHtml(song.album)}" title="View album details">${escapeHtml(song.album)}</div>
      <div class="track-rating" data-song-id="${song.id}">
        ${createStarRating(song.userRating || 0, song.id)}
      </div>
      <div class="track-duration">${duration}</div>
    </div>
  `;
}

// 5-Sterne Rating System erstellen
function createStarRating(currentRating: number, songId: string): string {
  let starsHTML = '';
  for (let i = 1; i <= 5; i++) {
    const filled = i <= currentRating ? 'filled' : '';
    starsHTML += `<span class="star ${filled}" data-rating="${i}" data-song-id="${songId}">★</span>`;
  }
  return starsHTML;
}

// Rating setzen
async function setRating(songId: string, rating: number) {
  if (!navidromeClient) return;
  
  const success = await navidromeClient.setRating(songId, rating);
  if (success) {
    // Update UI
    updateRatingDisplay(songId, rating);
    console.log(`Rating set: ${rating} stars for song ${songId}`);
  }
}

// Rating Display aktualisieren
function updateRatingDisplay(songId: string, rating: number) {
  const ratingContainers = document.querySelectorAll(`[data-song-id="${songId}"] .rating-stars`);
  ratingContainers.forEach(container => {
    container.innerHTML = createStarRating(rating, songId);
  });
  
  // Update player rating if this song is currently playing
  updatePlayerRating('left', songId, rating);
  updatePlayerRating('right', songId, rating);
}

// Player Rating aktualisieren
function updatePlayerRating(player: string, songId: string, rating: number) {
  const currentSongId = getCurrentSongId(player);
  if (currentSongId === songId) {
    const playerRating = document.getElementById(`player-rating-${player}`);
    if (playerRating) {
      playerRating.innerHTML = createStarRating(rating, songId);
    }
  }
}

// Aktuelle Song ID aus Player holen
function getCurrentSongId(player: string): string | null {
  const audio = document.getElementById(`audio-${player}`) as HTMLAudioElement;
  return audio?.dataset.songId || null;
}

// Album HTML erstellen
function createAlbumHTML(album: NavidromeAlbum): string {
  const coverUrl = album.coverArt && navidromeClient ? navidromeClient.getCoverArtUrl(album.coverArt, 300) : '';
  const year = (album as any).year || (album as any).date ? 
    new Date((album as any).year || (album as any).date).getFullYear() : '';
  const songCount = album.songCount || 0;
  
  return `
    <div class="album-item-modern" draggable="true" data-album-id="${album.id}" data-type="album" data-cover-art="${album.coverArt || ''}">
      <div class="album-cover-container">
        <div class="album-cover-modern" style="background-image: url('${coverUrl}')">
          ${!coverUrl ? '<div class="album-no-cover"><span class="material-icons">album</span></div>' : ''}
          <div class="album-overlay">
            <div class="album-play-button">
              <span class="material-icons">play_arrow</span>
            </div>
            <div class="album-actions">
              <span class="album-song-count">${songCount} tracks</span>
              ${year ? `<span class="album-year">${year}</span>` : ''}
            </div>
          </div>
        </div>
      </div>
      <div class="album-info-modern">
        <div class="album-title-modern" title="${escapeHtml(album.name)}">${escapeHtml(album.name)}</div>
        <div class="album-artist-modern" title="${escapeHtml(album.artist)}">${escapeHtml(album.artist)}</div>
      </div>
    </div>
  `;
}

// Artist HTML erstellen
function createArtistHTML(artist: NavidromeArtist): string {
  return `
    <div class="artist-item" data-artist-id="${artist.id}" data-artist-name="${escapeHtml(artist.name)}">
      <div class="artist-name">${escapeHtml(artist.name)}</div>
      <div class="artist-info">${artist.albumCount} albums</div>
    </div>
  `;
}

// Search Results anzeigen
function displaySearchResults(results: any) {
  const searchResultsSection = document.getElementById('search-results');
  const noSearchState = document.getElementById('no-search-state');
  const searchContent = document.getElementById('search-content');
  
  if (!searchResultsSection || !searchContent) {
    console.error('Search results containers not found');
    return;
  }
  
  let html = '';
  
  // Artists zuerst
  if (results.artist && results.artist.length > 0) {
    html += '<h4>Artists</h4>';
    html += '<div class="artists-section">' + results.artist.map((artist: NavidromeArtist) => createArtistHTML(artist)).join('') + '</div>';
  }
  
  // Dann Albums
  if (results.album && results.album.length > 0) {
    html += '<h4>Albums</h4>';
    html += '<div class="albums-grid">' + results.album.map((album: NavidromeAlbum) => createAlbumHTML(album)).join('') + '</div>';
  }
  
  // Songs zuletzt
  if (results.song && results.song.length > 0) {
    html += '<h4>Songs</h4>';
    html += '<div class="songs-table-header">';
    html += '<div class="header-cover">Cover</div>';
    html += '<div class="header-title">Title</div>';
    html += '<div class="header-artist">Artist</div>';
    html += '<div class="header-album">Album</div>';
    html += '<div class="header-rating">Rating</div>';
    html += '<div class="header-duration">Duration</div>';
    html += '</div>';
    html += '<div class="songs-table">' + results.song.map((song: NavidromeSong) => createSongHTMLOneline(song)).join('') + '</div>';
  }
  
  if (!html) {
    html = '<div class="no-results">No results found</div>';
  }
  
  // Search results anzeigen, No Search State verstecken
  searchContent.innerHTML = html;
  searchResultsSection.style.display = 'block';
  if (noSearchState) {
    noSearchState.style.display = 'none';
  }
  
  console.log('Search results displayed');
  
  // Kleine Verzögerung für DOM-Rendering
  setTimeout(() => {
    addDragListeners(searchContent);
    console.log('Drag listeners added to search results');
    addAlbumClickListeners(searchContent);
    console.log('Album click listeners added to search results');
    addArtistClickListeners(searchContent);
    console.log('Artist click listeners added to search results');
    addSongClickListeners(searchContent);
    console.log('Song click listeners added to search results');
  }, 50);
}

// Drag & Drop Listeners hinzufügen
function addDragListeners(container: Element) {
  const trackItems = container.querySelectorAll('.track-item, .track-item-oneline');
  const albumItems = container.querySelectorAll('.album-item-modern[draggable="true"]');
  
  console.log(`Adding drag listeners to ${trackItems.length} track items and ${albumItems.length} album items`);
  
  trackItems.forEach((item, index) => {
    item.addEventListener('dragstart', (e: Event) => {
      const dragEvent = e as DragEvent;
      const target = e.target as HTMLElement;
      target.classList.add('dragging');
      console.log(`Drag started for track item ${index}, song ID: ${target.dataset.songId}`);
      
      if (dragEvent.dataTransfer) {
        dragEvent.dataTransfer.setData('text/plain', target.dataset.songId || '');
        dragEvent.dataTransfer.effectAllowed = 'copy';
      }
    });
    
    item.addEventListener('dragend', (e) => {
      const target = e.target as HTMLElement;
      target.classList.remove('dragging');
      console.log('Drag ended for track item');
    });
  });
  
  // Album drag functionality
  albumItems.forEach((item, index) => {
    item.addEventListener('dragstart', (e: Event) => {
      const dragEvent = e as DragEvent;
      const target = e.target as HTMLElement;
      target.classList.add('dragging');
      console.log(`Drag started for album item ${index}, album ID: ${target.dataset.albumId}`);
      
      if (dragEvent.dataTransfer) {
        dragEvent.dataTransfer.setData('application/x-album-id', target.dataset.albumId || '');
        dragEvent.dataTransfer.effectAllowed = 'copy';
      }
    });
    
    item.addEventListener('dragend', (e) => {
      const target = e.target as HTMLElement;
      target.classList.remove('dragging');
      console.log('Drag ended for album item');
    });
  });
}

// Song-interne Click Listeners hinzufügen (für Artist und Album in Songs)
function addSongClickListeners(container: Element) {
  console.log('Adding song click listeners to container:', container);
  
  // Artist Click Listeners
  const artistElements = container.querySelectorAll('.clickable-artist');
  console.log(`Found ${artistElements.length} clickable artists`);
  
  artistElements.forEach((element, index) => {
    const artistId = (element as HTMLElement).dataset.artistId;
    const artistName = (element as HTMLElement).dataset.artistName;
    console.log(`Setting up artist click ${index}: ${artistName} (ID: ${artistId})`);
    
    element.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation(); // Verhindert Drag-Start
      console.log(`Artist clicked from song: ${artistName} (ID: ${artistId})`);
      console.log('Click event details:', { target: e.target, currentTarget: e.currentTarget });
      
      if (artistId) {
        // Wenn wir eine Artist ID haben, verwende diese direkt
        console.log(`Calling showArtistDetails with ID: ${artistId} and name: ${artistName}`);
        await showArtistDetails(artistId, artistName);
      } else if (artistName && navidromeClient) {
        // Fallback: Suche nach Artist by Name
        console.log(`No artist ID found, searching by name: ${artistName}`);
        try {
          const searchResults = await navidromeClient.search(artistName);
          if (searchResults.artist && searchResults.artist.length > 0) {
            // Finde exakten Match oder ersten Treffer
            const artist = searchResults.artist.find((a: any) => 
              a.name.toLowerCase().trim() === artistName.toLowerCase().trim()
            ) || searchResults.artist[0];
            
            if (artist) {
              console.log(`Found artist through search: ${artist.name} (ID: ${artist.id})`);
              await showArtistDetails(artist.id);
            } else {
              console.error('Artist not found in search results');
            }
          } else {
            console.error('No artists found for search term:', artistName);
          }
        } catch (error) {
          console.error('Error searching for artist:', error);
        }
      } else {
        console.error('No artist ID or name found, or navidromeClient not available');
      }
    });
    
    // Debug-Event für Mousedown
    element.addEventListener('mousedown', () => {
      console.log(`Artist mousedown: ${artistName}`);
    });
  });
  
  // Album Click Listeners
  const albumElements = container.querySelectorAll('.clickable-album');
  console.log(`Found ${albumElements.length} clickable albums`);
  
  albumElements.forEach((element, index) => {
    const albumId = (element as HTMLElement).dataset.albumId;
    const albumName = (element as HTMLElement).dataset.albumName;
    console.log(`Setting up album click ${index}: ${albumName} (ID: ${albumId})`);
    
    element.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation(); // Verhindert Drag-Start
      console.log(`Album clicked from song: ${albumName} (ID: ${albumId})`);
      
      if (albumId && albumId !== '') {
        await showAlbumSongs(albumId);
      } else if (albumName && navidromeClient) {
        console.log(`Album clicked from song (no ID): ${albumName}, searching...`);
        
        try {
          // Suche nach Album by Name
          const searchResults = await navidromeClient.search(albumName);
          if (searchResults.album && searchResults.album.length > 0) {
            // Finde exakten Match oder ersten Treffer
            const album = searchResults.album.find((a: any) => 
              a.name.toLowerCase().trim() === albumName.toLowerCase().trim()
            ) || searchResults.album[0];
            
            if (album) {
              await showAlbumSongs(album.id);
            } else {
              console.error('Album not found in search results');
            }
          } else {
            console.error('No albums found for search term:', albumName);
          }
        } catch (error) {
          console.error('Error searching for album:', error);
        }
      }
    });
    
    // Debug-Event für Mousedown
    element.addEventListener('mousedown', () => {
      console.log(`Album mousedown: ${albumName}`);
    });
  });
}

// Album Click Listeners hinzufügen
function addAlbumClickListeners(container: Element) {
  // Support both modern and legacy album items
  const albumItems = container.querySelectorAll('.album-item, .album-item-modern');
  console.log(`Adding album click listeners to ${albumItems.length} albums in container:`, container);
  
  albumItems.forEach((item, index) => {
    const albumId = (item as HTMLElement).dataset.albumId;
    console.log(`Setting up album ${index}: ID=${albumId}`);
    
    // Entferne vorherige Listener falls vorhanden
    const clonedItem = item.cloneNode(true);
    item.parentNode?.replaceChild(clonedItem, item);
    
    clonedItem.addEventListener('click', async (e) => {
      // Check if clicked on play button - handle differently
      const target = e.target as HTMLElement;
      if (target.closest('.album-play-button')) {
        e.preventDefault();
        e.stopPropagation();
        console.log(`Album play button clicked: ${albumId}`);
        // TODO: Add play album functionality
        return;
      }
      
      e.preventDefault();
      e.stopPropagation();
      console.log(`Album clicked: ${albumId} (click event fired)`);
      
      if (albumId) {
        await showAlbumSongs(albumId);
      } else {
        console.error('Album ID not found on clicked element');
      }
    });
    
    // Zusätzlicher Debug-Event
    clonedItem.addEventListener('mousedown', () => {
      console.log(`Album mousedown: ${albumId}`);
    });
  });
}

// Artist Click Listeners hinzufügen
function addArtistClickListeners(container: Element) {
  const artistItems = container.querySelectorAll('.artist-item');
  console.log(`Adding artist click listeners to ${artistItems.length} artists`);
  
  artistItems.forEach((item, index) => {
    const artistId = (item as HTMLElement).dataset.artistId;
    const artistName = (item as HTMLElement).dataset.artistName;
    console.log(`Setting up artist ${index}: ID=${artistId}, Name=${artistName}`);
    
    // Entferne vorherige Listener falls vorhanden
    const clonedItem = item.cloneNode(true);
    item.parentNode?.replaceChild(clonedItem, item);
    
    clonedItem.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log(`Artist clicked from search results: ${artistId} (click event fired)`);
      console.log('Click event details:', { target: e.target, currentTarget: e.currentTarget });
      
      if (artistId) {
        console.log(`Calling showArtistDetails with ID: ${artistId} and name: ${artistName}`);
        await showArtistDetails(artistId, artistName);
      } else {
        console.error('Artist ID not found on clicked element');
      }
    });
    
    // Zusätzlicher Debug-Event
    clonedItem.addEventListener('mousedown', () => {
      console.log(`Artist mousedown: ${artistId}`);
    });
  });
}

// Album Songs anzeigen
async function showAlbumSongs(albumId: string) {
  if (!navidromeClient) return;
  
  try {
    console.log(`Loading songs for album ${albumId}`);
    
    // Versuche Album in currentAlbums zu finden
    let album = currentAlbums.find(a => a.id === albumId);
    
    // Falls nicht gefunden, lade Album-Info direkt von Navidrome
    if (!album) {
      console.log('Album not in currentAlbums, fetching from Navidrome...');
      try {
        const fetchedAlbum = await navidromeClient.getAlbumInfo(albumId);
        if (fetchedAlbum) {
          album = fetchedAlbum;
        }
      } catch (error) {
        console.error('Error fetching album info:', error);
      }
    }
    
    const albumSongs = await navidromeClient.getAlbumSongs(albumId);
    
    // Prüfe ob wir in Search-View sind oder in der normalen Songs-Liste
    const searchContent = document.getElementById('search-content');
    const songsContainer = document.getElementById('songs-list');
    const targetContainer = searchContent?.style.display !== 'none' ? searchContent : songsContainer;
    
    if (targetContainer) {
      const albumName = album ? album.name : 'Unknown Album';
      const albumArtist = album ? album.artist : 'Unknown Artist';
      
      let html = `
        <div class="album-header">
          <h3>Album: ${escapeHtml(albumName)} - ${escapeHtml(albumArtist)}</h3>
          <button class="back-btn" id="back-to-search">← Back to Search</button>
        </div>
      `;
      
      // Songs-Tabelle mit Header
      html += '<div class="songs-table-header">';
      html += '<div class="header-cover">Cover</div>';
      html += '<div class="header-title">Title</div>';
      html += '<div class="header-artist">Artist</div>';
      html += '<div class="header-album">Album</div>';
      html += '<div class="header-rating">Rating</div>';
      html += '<div class="header-duration">Duration</div>';
      html += '</div>';
      html += '<div class="songs-table">' + albumSongs.map(song => createSongHTMLOneline(song)).join('') + '</div>';
      
      targetContainer.innerHTML = html;
      addDragListeners(targetContainer);
      addSongClickListeners(targetContainer);
      
      // Back Button Event Listener
      const backBtn = document.getElementById('back-to-search');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          // Gehe zurück zu No Search State
          showNoSearchState();
        });
      }
    }
  } catch (error) {
    console.error('Error loading album songs:', error);
    showError(`Error loading album songs: ${error}`);
  }
}

// Artist Details anzeigen
async function showArtistDetails(artistId: string, artistName?: string) {
  if (!navidromeClient) {
    console.error('Navidrome client not available');
    return;
  }
  
  try {
    console.log(`Loading details for artist ${artistId} (name: ${artistName})`);
    
    // Versuche zuerst direkt per ID über die API
    let artist = await navidromeClient.getArtist(artistId);
    
    if (!artist) {
      console.log(`Artist with ID ${artistId} not found via direct API call`);
      // Fallback: Suche in currentArtists (für cached Artists)
      const cachedArtist = currentArtists.find(a => a.id === artistId);
      if (cachedArtist) {
        artist = cachedArtist;
      } else if (artistName) {
        // Letzter Fallback: search by name
        console.log(`Trying to find artist by name: ${artistName}`);
        const searchResults = await navidromeClient.search(artistName);
        if (searchResults.artist && searchResults.artist.length > 0) {
          artist = searchResults.artist.find((a: any) => 
            a.name.toLowerCase().trim() === artistName.toLowerCase().trim()
          ) || searchResults.artist[0];
        }
      }
      
      if (!artist) {
        console.error('Artist not found through any method');
        showError(`Artist not found: ${artistName || artistId}`);
        return;
      }
    }
    
    console.log(`Found artist: ${artist.name}`);
    
    const artistSongs = await navidromeClient.getArtistSongs(artistId);
    const artistOwnAlbums = await navidromeClient.getArtistAlbums(artistId);  // Eigene Alben vom Artist-Endpoint
    const allAlbumsWithArtist = await navidromeClient.getAllAlbumsWithArtist(artist.name);  // Alle Alben mit Songs des Künstlers
    
    console.log('Artist own albums:', artistOwnAlbums.map(a => a.name));
    console.log('All albums with artist:', allAlbumsWithArtist.map(a => `${a.name} by ${a.artist}`));
    
    // Filtere Alben: zeige nur solche, wo der Künstler NICHT der Hauptkünstler ist
    const appearsOnAlbums = allAlbumsWithArtist.filter(album => {
      // Prüfe ob es NICHT in den eigenen Alben ist
      const notInOwnAlbums = !artistOwnAlbums.some(ownAlbum => ownAlbum.id === album.id);
      
      // Prüfe ob der Künstler NICHT der Hauptkünstler des Albums ist (exakter Vergleich)
      const notMainArtist = album.artist.toLowerCase().trim() !== (artist?.name || '').toLowerCase().trim();
      
      console.log(`Album "${album.name}" by "${album.artist}": notInOwn=${notInOwnAlbums}, notMain=${notMainArtist}`);
      
      return notInOwnAlbums && notMainArtist;
    });
    
    // Prüfe ob wir in Search-View sind oder in der normalen Songs-Liste
    const searchContent = document.getElementById('search-content');
    const songsContainer = document.getElementById('songs-list');
    const targetContainer = searchContent?.style.display !== 'none' ? searchContent : songsContainer;
    
    if (targetContainer && artist) {
      let html = `
        <div class="artist-header">
          <h3>Artist: ${escapeHtml(artist.name)}</h3>
          <button class="back-btn" id="back-to-search-artist">← Back to Search</button>
        </div>
      `;
      
      // Top Songs Sektion mit einheitlicher Tabelle
      if (artistSongs.length > 0) {
        html += `
        <div class="artist-section">
          <h4>Top Songs</h4>
          <div class="songs-table-header">
            <div class="header-cover">Cover</div>
            <div class="header-title">Title</div>
            <div class="header-artist">Artist</div>
            <div class="header-album">Album</div>
            <div class="header-rating">Rating</div>
            <div class="header-duration">Duration</div>
          </div>
          <div class="songs-table">
            ${artistSongs.slice(0, 10).map((song: NavidromeSong) => createSongHTMLOneline(song)).join('')}
          </div>
        </div>
        `;
      }
      
      // Albums Sektion
      html += `
        <div class="artist-section">
          <h4>Albums</h4>
          <div class="albums-grid">
            ${artistOwnAlbums.map((album: NavidromeAlbum) => createAlbumHTML(album)).join('')}
          </div>
        </div>
      `;
      
      // Appears On Sektion
      if (appearsOnAlbums.length > 0) {
        html += `
        <div class="artist-section">
          <h4>Appears On</h4>
          <div class="albums-grid">
            ${appearsOnAlbums.map((album: NavidromeAlbum) => createAlbumHTML(album)).join('')}
          </div>
        </div>
        `;
      }
      
      targetContainer.innerHTML = html;
      addDragListeners(targetContainer);
      addAlbumClickListeners(targetContainer);
      addSongClickListeners(targetContainer);
      
      // Back Button Event Listener
      const backBtn = document.getElementById('back-to-search-artist');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          // Gehe zurück zu No Search State
          showNoSearchState();
        });
      }
    }
  } catch (error) {
    console.error('Error loading artist details:', error);
    showError(`Error loading artist details: ${error}`);
  }
}

// Hilfsfunktionen
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showError(message: string) {
  console.error(message);
  // Hier könnte eine Benutzeroberfläche für Fehler implementiert werden
}

function showSearchLoading() {
  const searchResultsSection = document.getElementById('search-results');
  const noSearchState = document.getElementById('no-search-state');
  const searchContent = document.getElementById('search-content');
  
  if (searchResultsSection && searchContent) {
    // Search results anzeigen, No Search State verstecken
    searchContent.innerHTML = '<div class="loading">Searching...</div>';
    searchResultsSection.style.display = 'block';
    if (noSearchState) {
      noSearchState.style.display = 'none';
    }
  }
}

// No Search State anzeigen (verstecke Search Results)
function showNoSearchState() {
  const searchResultsSection = document.getElementById('search-results');
  const noSearchState = document.getElementById('no-search-state');
  
  if (searchResultsSection && noSearchState) {
    searchResultsSection.style.display = 'none';
    noSearchState.style.display = 'flex';
  }
}

// Queue initialisieren (permanent)
function initializeQueuePermanent() {
  // Alle Queue-Container finden
  const queueContainers = document.querySelectorAll('.queue-items');
  console.log(`Found ${queueContainers.length} queue containers for permanent setup`);
  
  queueContainers.forEach((queueContainer, index) => {
    console.log(`Setting up permanent queue container ${index}`);
    
    // Event Handler definieren
    const dragoverHandler = (e: Event) => {
      e.preventDefault();
      queueContainer.classList.add('drag-over');
      console.log('Queue dragover event');
    };
    
    const dragleaveHandler = (e: Event) => {
      // Nur entfernen wenn wirklich die Queue verlassen wird
      const rect = queueContainer.getBoundingClientRect();
      const mouseEvent = e as MouseEvent;
      if (mouseEvent.clientX < rect.left || mouseEvent.clientX > rect.right || 
          mouseEvent.clientY < rect.top || mouseEvent.clientY > rect.bottom) {
        queueContainer.classList.remove('drag-over');
        console.log('Queue dragleave event');
      }
    };
    
    const dropHandler = async (e: Event) => {
      e.preventDefault();
      queueContainer.classList.remove('drag-over');
      console.log('Queue drop event');
      
      const dragEvent = e as DragEvent;
      const songId = dragEvent.dataTransfer?.getData('text/plain');
      console.log('Dropped song ID:', songId);
      
      if (songId) {
        await addToQueue(songId);
      }
    };
    
    // Event Listener hinzufügen
    queueContainer.addEventListener('dragover', dragoverHandler);
    queueContainer.addEventListener('dragleave', dragleaveHandler);
    queueContainer.addEventListener('drop', dropHandler);
  });
}

// Song zur Queue hinzufügen
async function addToQueue(songId: string) {
  console.log('Adding song to queue:', songId);
  
  // Finde Song in aktuellen Listen
  let song = currentSongs.find(s => s.id === songId);
  
  if (!song) {
    // Wenn nicht gefunden, versuche über Search Results zu finden
    const searchResults = document.querySelectorAll('.track-item');
    for (const item of searchResults) {
      const element = item as HTMLElement;
      if (element.dataset.songId === songId) {
        // Hier müsste der Song aus der API abgerufen werden
        // Für jetzt nehmen wir den ersten verfügbaren Song
        song = currentSongs[0];
        break;
      }
    }
  }
  
  if (song) {
    queue.push(song);
    updateQueueDisplay();
    console.log(`Song "${song.title}" added to queue. Queue length: ${queue.length}`);
  }
}

// Queue Anzeige aktualisieren
function updateQueueDisplay() {
  // Alle Queue-Container aktualisieren
  const queueContainers = document.querySelectorAll('.queue-items');
  
  queueContainers.forEach(queueContainer => {
    if (queue.length === 0) {
      queueContainer.innerHTML = '<div class="queue-empty">Drag tracks here to queue</div>';
      return;
    }
    
    queueContainer.innerHTML = queue.map((song, index) => `
      <div class="queue-item" data-queue-index="${index}">
        <div class="queue-number">${index + 1}</div>
        <div class="queue-info">
          <div class="queue-title">${escapeHtml(song.title)}</div>
          <div class="queue-artist">${escapeHtml(song.artist)}</div>
        </div>
        <button class="queue-remove" onclick="removeFromQueue(${index})">×</button>
      </div>
    `).join('');
  });
}

// Song aus Queue entfernen
function removeFromQueue(index: number) {
  if (index >= 0 && index < queue.length) {
    const removedSong = queue.splice(index, 1)[0];
    updateQueueDisplay();
    console.log(`Song "${removedSong.title}" removed from queue`);
  }
}

// Globale Funktion für HTML onclick
(window as any).removeFromQueue = removeFromQueue;

// Navidrome Login initialisieren
function initializeNavidromeLogin() {
  const loginBtn = document.getElementById('navidrome-login-btn') as HTMLButtonElement;
  const usernameInput = document.getElementById('navidrome-username') as HTMLInputElement;
  const passwordInput = document.getElementById('navidrome-password') as HTMLInputElement;
  const serverInput = document.getElementById('navidrome-server') as HTMLInputElement;
  const loginForm = document.getElementById('navidrome-login') as HTMLElement;
  const djControls = document.getElementById('dj-controls') as HTMLElement;
  const searchContainer = document.getElementById('search-container') as HTMLElement;
  
  // Umgebungsvariablen aus Vite abrufen
  const envUrl = import.meta.env.VITE_NAVIDROME_URL;
  const envUsername = import.meta.env.VITE_NAVIDROME_USERNAME;
  const envPassword = import.meta.env.VITE_NAVIDROME_PASSWORD;
  
  // Interne Login-Funktion definieren
  const performLogin = async (serverUrl: string, username: string, password: string) => {
    if (!username || !password) {
      console.log('❌ Please enter username and password');
      return;
    }
    
    try {
      console.log('🔄 Connecting to Navidrome...');
      if (loginBtn) {
        loginBtn.disabled = true;
        loginBtn.textContent = 'Connecting...';
      }
      
      // Erstelle Navidrome Client mit Credentials
      navidromeClient = new NavidromeClient({
        serverUrl: serverUrl,
        username: username,
        password: password
      });
      
      const authenticated = await navidromeClient.authenticate();
      
      if (authenticated) {
        console.log("✅ Navidrome connected successfully!");
        
        // Verstecke Login-Form, zeige DJ-Controls und Suchfeld
        loginForm.style.display = 'none';
        djControls.style.display = 'flex';
        searchContainer.style.display = 'flex';
        
        // Initialisiere Musikbibliothek
        await initializeMusicLibrary();
        
      } else {
        console.log('❌ Login failed - Wrong username or password');
        if (loginBtn) {
          loginBtn.textContent = 'Login Failed';
          setTimeout(() => {
            loginBtn.textContent = 'Login';
            loginBtn.disabled = false;
          }, 2000);
        }
      }
      
    } catch (error) {
      console.error("❌ Navidrome connection error:", error);
      if (loginBtn) {
        loginBtn.textContent = 'Connection Error';
        setTimeout(() => {
          loginBtn.textContent = 'Login';
          loginBtn.disabled = false;
        }, 2000);
      }
    }
  };
  
  // Felder verstecken wenn Werte in .env vorhanden sind
  if (envUrl) {
    const serverGroup = document.querySelector('.form-group:has(#navidrome-server)') as HTMLElement;
    if (serverGroup) serverGroup.style.display = 'none';
  }
  
  if (envUsername) {
    const usernameGroup = document.querySelector('.form-group:has(#navidrome-username)') as HTMLElement;
    if (usernameGroup) usernameGroup.style.display = 'none';
  }
  
  if (envPassword) {
    const passwordGroup = document.querySelector('.form-group:has(#navidrome-password)') as HTMLElement;
    if (passwordGroup) passwordGroup.style.display = 'none';
  }
  
  // Auto-Login wenn alle Credentials in .env vorhanden sind
  if (envUrl && envUsername && envPassword) {
    console.log('🔄 Auto-login with environment credentials...');
    performLogin(envUrl, envUsername, envPassword);
    return;
  }
  
  const performLoginFromForm = async () => {
    const username = usernameInput.value.trim() || envUsername;
    const password = passwordInput.value.trim() || envPassword;
    const serverUrl = serverInput.value.trim() || envUrl || "https://musik.radio-endstation.de";
    
    await performLogin(serverUrl, username, password);
  };
  
  loginBtn?.addEventListener('click', performLoginFromForm);
  
  // Enter-Taste in Passwort-Feld
  passwordInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      performLoginFromForm();
    }
  });
}

// Audio Players initialisieren
function initializeAudioPlayers() {
  const audioLeft = document.getElementById('audio-left') as HTMLAudioElement;
  const audioRight = document.getElementById('audio-right') as HTMLAudioElement;
  
  if (audioLeft) {
    setupAudioPlayer('left', audioLeft);
  }
  
  if (audioRight) {
    setupAudioPlayer('right', audioRight);
  }
  
  // Crossfader Funktionalität
  initializeCrossfader();
  
  // Drop Zones für Player
  initializePlayerDropZones();
}

// Audio Player Setup
function setupAudioPlayer(side: 'left' | 'right', audio: HTMLAudioElement) {
  const playPauseBtn = document.getElementById(`play-pause-${side}`) as HTMLButtonElement;
  const ejectBtn = document.getElementById(`eject-${side}`) as HTMLButtonElement;
  const restartBtn = document.getElementById(`restart-${side}`) as HTMLButtonElement;
  const volumeSlider = document.getElementById(`volume-${side}`) as HTMLInputElement;
  const progressContainer = document.getElementById(`progress-bar-${side}`) as HTMLElement;
  const playerDeck = document.getElementById(`player-${side}`) as HTMLElement;
  
  // Audio Event Listeners
  audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
      // Zeit-Anzeige aktualisieren
      updateTimeDisplay(side, audio.currentTime, audio.duration);
      
      // WaveSurfer progress is automatically synced
    }
  });
  
  audio.addEventListener('play', () => {
    console.log(`▶️ Player ${side.toUpperCase()} started playing`);
    if (playerDeck) {
      playerDeck.classList.add('playing');
    }
  });
  
  audio.addEventListener('pause', () => {
    console.log(`⏸️ Player ${side.toUpperCase()} paused`);
    if (playerDeck) {
      playerDeck.classList.remove('playing');
    }
  });
  
  audio.addEventListener('ended', () => {
    console.log(`🏁 Player ${side} finished playing`);
    
    // Update play button state
    const playPauseBtn = document.getElementById(`play-pause-${side}`) as HTMLButtonElement;
    if (playPauseBtn) {
      const icon = playPauseBtn.querySelector('.material-icons');
      if (icon) icon.textContent = 'play_arrow';
      playPauseBtn.classList.remove('playing');
    }
    
    if (playerDeck) {
      playerDeck.classList.remove('playing');
    }
    
    // Auto-Queue functionality
    if (autoQueueEnabled && queue.length > 0) {
      console.log(`🔄 Auto-Queue enabled: Loading next track to Player ${side.toUpperCase()}`);
      const nextTrack = queue.shift();
      if (nextTrack) {
        loadTrackToPlayer(side, nextTrack, true); // Auto-play next track
        updateQueueDisplay();
      }
    } else {
      console.log(`⏹ Auto-Queue disabled or queue empty on Player ${side.toUpperCase()}`);
    }
  });
  
  audio.addEventListener('loadstart', () => {
    console.log(`📥 Player ${side} loading...`);
  });
  
  audio.addEventListener('canplay', () => {
    console.log(`✅ Player ${side} ready to play`);
  });
  
  audio.addEventListener('error', (e) => {
    console.error(`❌ Player ${side} error:`, e);
    if (playerDeck) {
      playerDeck.classList.remove('playing');
    }
    showError(`Audio error on Player ${side.toUpperCase()}`);
  });
  
  // Control Button Event Listeners
  playPauseBtn?.addEventListener('click', () => {
    const wavesurfer = waveSurfers[side];
    
    // Prioritize WaveSurfer if available, disable HTML audio
    if (wavesurfer) {
      if (wavesurfer.isPlaying()) {
        wavesurfer.pause();
        const icon = playPauseBtn.querySelector('.material-icons');
        if (icon) icon.textContent = 'play_arrow';
        playPauseBtn.classList.remove('playing');
      } else {
        try {
          wavesurfer.play();
          const icon = playPauseBtn.querySelector('.material-icons');
          if (icon) icon.textContent = 'pause';
          playPauseBtn.classList.add('playing');
        } catch (e) {
          console.error(`❌ WaveSurfer play error on Player ${side}:`, e);
          showError(`Cannot play on Player ${side.toUpperCase()}: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
      }
    } else {
      // Fallback to HTML audio if WaveSurfer not available
      if (audio.paused) {
        if (audio.src) {
          audio.play().catch(e => {
            console.error(`❌ Play error on Player ${side}:`, e);
            showError(`Cannot play on Player ${side.toUpperCase()}: ${e.message}`);
          });
          const icon = playPauseBtn.querySelector('.material-icons');
          if (icon) icon.textContent = 'pause';
          playPauseBtn.classList.add('playing');
        } else {
          console.log(`❓ No track loaded on Player ${side}`);
          showError(`No track loaded on Player ${side.toUpperCase()}`);
        }
      } else {
        audio.pause();
        const icon = playPauseBtn.querySelector('.material-icons');
        if (icon) icon.textContent = 'play_arrow';
        playPauseBtn.classList.remove('playing');
      }
    }
  });
  
  ejectBtn?.addEventListener('click', () => {
    audio.pause();
    audio.currentTime = 0;
    audio.src = '';
    
    // Clear song ID for rating system
    delete audio.dataset.songId;
    
    const trackTitle = document.getElementById(`track-title-${side}`);
    const trackArtist = document.getElementById(`track-artist-${side}`);
    const playerRating = document.getElementById(`player-rating-${side}`);
    
    if (trackTitle) trackTitle.textContent = 'No Track Loaded';
    if (trackArtist) trackArtist.textContent = '-';
    if (playerRating) playerRating.innerHTML = '';
    
    if (playPauseBtn) {
      const icon = playPauseBtn.querySelector('.material-icons');
      if (icon) icon.textContent = 'play_arrow';
      playPauseBtn.classList.remove('playing');
    }
    if (playerDeck) {
      playerDeck.classList.remove('playing');
    }
    
    console.log(`💿 Player ${side.toUpperCase()} ejected`);
  });

  restartBtn?.addEventListener('click', () => {
    if (audio.src) {
      audio.currentTime = 0;
      console.log(`🔄 Player ${side.toUpperCase()} restarted`);
    } else {
      console.log(`❓ No track loaded on Player ${side}`);
      showError(`No track loaded on Player ${side.toUpperCase()}`);
    }
  });
  
  // Volume Control
  volumeSlider?.addEventListener('input', () => {
    const volume = parseInt(volumeSlider.value) / 100;
    audio.volume = volume;
    console.log(`Player ${side} volume: ${volume * 100}%`);
  });
  
  // Progress Bar Click Seeking
  progressContainer?.addEventListener('click', (e) => {
    if (audio.duration) {
      const rect = progressContainer.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const width = rect.width;
      const seekTime = (clickX / width) * audio.duration;
      audio.currentTime = seekTime;
      console.log(`Player ${side} seek to: ${seekTime}s`);
    }
  });
  
  // Initial volume setting
  if (volumeSlider) {
    audio.volume = parseInt(volumeSlider.value) / 100;
  }
}

// Track in Player laden
function loadTrackToPlayer(side: 'left' | 'right', song: NavidromeSong, autoPlay: boolean = false) {
  if (!navidromeClient) {
    console.error('Navidrome client not initialized');
    return;
  }
  
  const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
  const titleElement = document.getElementById(`track-title-${side}`);
  const artistElement = document.getElementById(`track-artist-${side}`);
  
  if (!audio) return;
  
  console.log(`Loading "${song.title}" to Player ${side.toUpperCase()}${autoPlay ? ' (auto-play)' : ''}`);
  
  // Stream URL von Navidrome
  const streamUrl = navidromeClient.getStreamUrl(song.id);
  
  // Reset WaveSurfer first (bevor neuer Track geladen wird)
  resetWaveform(side);
  
  // Vorherigen Track stoppen und zurücksetzen
  audio.pause();
  audio.currentTime = 0;
  
  // Neuen Track laden
  audio.src = streamUrl;
  
  // Track Info anzeigen
  if (titleElement) {
    titleElement.textContent = song.title;
  }
  if (artistElement) {
    artistElement.textContent = `${song.artist} - ${song.album}`;
  }
  
  // Album Cover aktualisieren
  updateAlbumCover(side, song);
  
  // Play-Button zurücksetzen (Track ist gestoppt)
  const playPauseBtn = document.getElementById(`play-pause-${side}`) as HTMLButtonElement;
  const icon = playPauseBtn?.querySelector('.material-icons');
  if (icon) icon.textContent = 'play_arrow';
  
  // Load new waveform using WaveSurfer (lädt automatisch neue Waveform)
  loadWaveform(side, audio.src);
  
  // Note: We don't sync WaveSurfer with audio to avoid double playback
  // WaveSurfer handles playback directly via play button
  
  // Song ID für Rating-System speichern
  audio.dataset.songId = song.id;
  
  // Rating anzeigen (async laden)
  const playerRating = document.getElementById(`player-rating-${side}`);
  if (playerRating) {
    playerRating.innerHTML = createStarRating(song.userRating || 0, song.id);
    
    // Rating async nachladen für bessere Performance
    loadRatingAsync(song.id);
  }
  
  // Auto-Play wenn gewünscht
  if (autoPlay) {
    // Warte bis Track geladen ist, dann spiele ab
    audio.addEventListener('loadeddata', () => {
      audio.play().then(() => {
        console.log(`🎵 Player ${side.toUpperCase()}: "${song.title}" is now playing`);
        
        // Update play button state
        const playPauseBtn = document.getElementById(`play-pause-${side}`) as HTMLButtonElement;
        if (playPauseBtn) {
          playPauseBtn.textContent = '⏸️';
          playPauseBtn.classList.add('playing');
        }
        
      }).catch(error => {
        console.error(`❌ Auto-play failed on Player ${side.toUpperCase()}:`, error);
        showError(`Auto-play failed on Player ${side.toUpperCase()}: ${error.message}`);
      });
    }, { once: true }); // Event listener nur einmal ausführen
  }
  
  // Crossfader anwenden falls aktiv
  applyCrossfader();
  
  console.log(`Player ${side.toUpperCase()}: "${song.title}" loaded successfully`);
}

// Crossfader anwenden (für neue Tracks)
function applyCrossfader() {
  const crossfader = document.getElementById('crossfader') as HTMLInputElement;
  if (crossfader) {
    // Triggere crossfader update
    crossfader.dispatchEvent(new Event('input'));
  }
}

// Crossfader initialisieren
function initializeCrossfader() {
  const crossfader = document.getElementById('crossfader') as HTMLInputElement;
  const audioLeft = document.getElementById('audio-left') as HTMLAudioElement;
  const audioRight = document.getElementById('audio-right') as HTMLAudioElement;
  
  if (!crossfader || !audioLeft || !audioRight) return;
  
  crossfader.addEventListener('input', () => {
    const value = parseInt(crossfader.value);
    
    // Crossfader: 0 = nur links, 50 = beide gleich, 100 = nur rechts
    // Korrekte Berechnung für fließenden Übergang
    let leftVolume, rightVolume;
    
    if (value <= 50) {
      // Von 0 bis 50: Links bleibt bei 100%, Rechts steigt von 0% auf 100%
      leftVolume = 1.0;
      rightVolume = value / 50.0;
    } else {
      // Von 50 bis 100: Rechts bleibt bei 100%, Links sinkt von 100% auf 0%
      leftVolume = (100 - value) / 50.0;
      rightVolume = 1.0;
    }
    
    // Basis-Volume von den Volume-Slidern
    const leftSlider = document.getElementById('volume-left') as HTMLInputElement;
    const rightSlider = document.getElementById('volume-right') as HTMLInputElement;
    
    const leftBaseVolume = leftSlider ? parseInt(leftSlider.value) / 100 : 0.8;
    const rightBaseVolume = rightSlider ? parseInt(rightSlider.value) / 100 : 0.8;
    
    // Kombinierte Volume setzen
    audioLeft.volume = Math.min(1, leftVolume * leftBaseVolume);
    audioRight.volume = Math.min(1, rightVolume * rightBaseVolume);
    
    console.log(`Crossfader: ${value}% - Left: ${Math.round(audioLeft.volume * 100)}%, Right: ${Math.round(audioRight.volume * 100)}%`);
  });
  
  // Initial Crossfader Position (Mitte)
  crossfader.value = '50';
  crossfader.dispatchEvent(new Event('input'));
}

// Player Drop Zones initialisieren
function initializePlayerDropZones() {
  initializePlayerDropZone('left');
  initializePlayerDropZone('right');
}

function initializePlayerDropZone(side: 'left' | 'right') {
  const playerDeck = document.getElementById(`player-${side}`);
  if (!playerDeck) return;
  
  playerDeck.addEventListener('dragover', (e) => {
    e.preventDefault();
    playerDeck.classList.add('drag-over');
  });
  
  playerDeck.addEventListener('dragleave', () => {
    playerDeck.classList.remove('drag-over');
  });
  
  playerDeck.addEventListener('drop', async (e) => {
    e.preventDefault();
    playerDeck.classList.remove('drag-over');
    
    const dragEvent = e as DragEvent;
    const songId = dragEvent.dataTransfer?.getData('text/plain');
    
    if (songId) {
      console.log(`🎵 Dropping song ${songId} on Player ${side.toUpperCase()}`);
      
      // Finde Song in verschiedenen Listen
      let song = findSongById(songId);
      
      if (song) {
        // Lade Track OHNE Auto-Play
        loadTrackToPlayer(side, song, false);
        console.log(`✅ Track "${song.title}" loaded on Player ${side.toUpperCase()} (ready to play)`);
      } else {
        console.error(`❌ Song with ID ${songId} not found`);
        showError(`Track not found. Please try searching or reloading the library.`);
      }
    }
  });
}

// Song nach ID in allen verfügbaren Listen finden
function findSongById(songId: string): NavidromeSong | null {
  // Suche in aktuellen Songs
  let song = currentSongs.find(s => s.id === songId);
  if (song) return song;
  
  // Suche in Search Results (DOM) - sowohl alte als auch neue Track-Items
  const searchResults = document.querySelectorAll('.track-item, .track-item-oneline');
  for (const item of searchResults) {
    const element = item as HTMLElement;
    if (element.dataset.songId === songId) {
      
      // Für neue einzeilige Track-Items
      if (element.classList.contains('track-item-oneline')) {
        const titleElement = element.querySelector('.track-title');
        const artistElement = element.querySelector('.track-artist');
        const albumElement = element.querySelector('.track-album');
        const coverArt = element.dataset.coverArt || undefined;
        
        if (titleElement && artistElement && albumElement) {
          return {
            id: songId,
            title: titleElement.textContent || 'Unknown',
            artist: artistElement.textContent || 'Unknown Artist',
            album: albumElement.textContent || 'Unknown Album',
            duration: 0,
            size: 0,
            suffix: 'mp3',
            bitRate: 0,
            coverArt: coverArt // Cover Art aus DOM extrahieren
          };
        }
      }
      
      // Für alte Track-Items (Fallback)
      const titleElement = element.querySelector('h4');
      const infoElement = element.querySelector('p');
      const coverArt = element.dataset.coverArt || undefined;
      
      if (titleElement && infoElement) {
        const title = titleElement.textContent || 'Unknown';
        const info = infoElement.textContent || '';
        const [artist, album] = info.split(' - ');
        
        return {
          id: songId,
          title: title,
          artist: artist || 'Unknown Artist',
          album: album || 'Unknown Album',
          duration: 0,
          size: 0,
          suffix: 'mp3',
          bitRate: 0,
          coverArt: coverArt // Cover Art auch für alte Items
        };
      }
    }
  }
  
  // Nicht gefunden
  return null;
}

// Rating-Event-Listeners initialisieren
function initializeRatingListeners() {
  document.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    
    if (target.classList.contains('star')) {
      const rating = parseInt(target.dataset.rating || '0');
      const songId = target.dataset.songId;
      
      if (songId && rating > 0) {
        await setRating(songId, rating);
        
        // Async Rating laden für bessere Performance
        loadRatingAsync(songId);
      }
    }
  });
  
  // Hover-Effekte für Sterne
  document.addEventListener('mouseover', (event) => {
    const target = event.target as HTMLElement;
    
    if (target.classList.contains('star')) {
      const rating = parseInt(target.dataset.rating || '0');
      const songId = target.dataset.songId;
      
      if (songId) {
        highlightStars(songId, rating);
      }
    }
  });
  
  document.addEventListener('mouseout', (event) => {
    const target = event.target as HTMLElement;
    
    if (target.classList.contains('star')) {
      const songId = target.dataset.songId;
      
      if (songId) {
        resetStarHighlight(songId);
      }
    }
  });
}

// Sterne für Hover-Effekt hervorheben
function highlightStars(songId: string, rating: number) {
  const stars = document.querySelectorAll(`[data-song-id="${songId}"] .star`);
  stars.forEach((star, index) => {
    const starElement = star as HTMLElement;
    if (index < rating) {
      starElement.classList.add('hover-preview');
    } else {
      starElement.classList.remove('hover-preview');
    }
  });
}

// Stern-Highlight zurücksetzen
function resetStarHighlight(songId: string) {
  const stars = document.querySelectorAll(`[data-song-id="${songId}"] .star`);
  stars.forEach(star => {
    star.classList.remove('hover-preview');
  });
}

// Rating asynchron laden (für bessere Performance)
async function loadRatingAsync(songId: string) {
  if (!navidromeClient) return;
  
  try {
    const rating = await navidromeClient.getRating(songId);
    if (rating !== null) {
      updateRatingDisplay(songId, rating);
    }
  } catch (error) {
    console.warn(`Failed to load rating for song ${songId}:`, error);
  }
}

// Recent Albums Funktion entfernt - wird nicht mehr benötigt
