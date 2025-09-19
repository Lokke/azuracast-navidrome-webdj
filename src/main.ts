import "./style.css";
import { NavidromeClient, type NavidromeSong, type NavidromeAlbum, type NavidromeArtist } from "./navidrome";

console.log("DJ Radio Webapp loaded!");

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
    if (!query) return;
    
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
    
    songsContainer.innerHTML = currentSongs.map(song => createSongHTML(song)).join('');
    addDragListeners(songsContainer);
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
function createSongHTML(song: NavidromeSong): string {
  const duration = formatDuration(song.duration);
  return `
    <div class="track-item" draggable="true" data-song-id="${song.id}" data-type="song">
      <h4>${escapeHtml(song.title)}</h4>
      <p>${escapeHtml(song.artist)} - ${escapeHtml(song.album)} (${duration})</p>
    </div>
  `;
}

// Album HTML erstellen
function createAlbumHTML(album: NavidromeAlbum): string {
  const coverUrl = album.coverArt && navidromeClient ? navidromeClient.getCoverArtUrl(album.coverArt, 200) : '';
  return `
    <div class="album-item" data-album-id="${album.id}">
      <div class="album-cover" style="background-image: url('${coverUrl}')"></div>
      <div class="album-title">${escapeHtml(album.name)}</div>
      <div class="album-artist">${escapeHtml(album.artist)}</div>
    </div>
  `;
}

// Artist HTML erstellen
function createArtistHTML(artist: NavidromeArtist): string {
  return `
    <div class="artist-item" data-artist-id="${artist.id}">
      <div class="artist-name">${escapeHtml(artist.name)}</div>
      <div class="artist-info">${artist.albumCount} albums</div>
    </div>
  `;
}

// Search Results anzeigen
function displaySearchResults(results: any) {
  const searchContainer = document.getElementById('search-results');
  if (!searchContainer) return;
  
  let html = '';
  
  if (results.song && results.song.length > 0) {
    html += '<h3>Songs</h3>';
    html += results.song.map((song: NavidromeSong) => createSongHTML(song)).join('');
  }
  
  if (results.album && results.album.length > 0) {
    html += '<h3>Albums</h3>';
    html += '<div class="albums-grid">' + results.album.map((album: NavidromeAlbum) => createAlbumHTML(album)).join('') + '</div>';
  }
  
  if (results.artist && results.artist.length > 0) {
    html += '<h3>Artists</h3>';
    html += results.artist.map((artist: NavidromeArtist) => createArtistHTML(artist)).join('');
  }
  
  if (!html) {
    html = '<div class="no-results">No results found</div>';
  }
  
  searchContainer.innerHTML = html;
  console.log('Search results HTML updated');
  
  // Kleine Verzögerung für DOM-Rendering
  setTimeout(() => {
    addDragListeners(searchContainer);
    console.log('Drag listeners added to search results');
    addAlbumClickListeners(searchContainer);
    console.log('Album click listeners added to search results');
    addArtistClickListeners(searchContainer);
    console.log('Artist click listeners added to search results');
  }, 50);
}

// Drag & Drop Listeners hinzufügen
function addDragListeners(container: Element) {
  const trackItems = container.querySelectorAll('.track-item');
  console.log(`Adding drag listeners to ${trackItems.length} track items`);
  
  trackItems.forEach((item, index) => {
    item.addEventListener('dragstart', (e: Event) => {
      const dragEvent = e as DragEvent;
      const target = e.target as HTMLElement;
      target.classList.add('dragging');
      console.log(`Drag started for item ${index}, song ID: ${target.dataset.songId}`);
      
      if (dragEvent.dataTransfer) {
        dragEvent.dataTransfer.setData('text/plain', target.dataset.songId || '');
        dragEvent.dataTransfer.effectAllowed = 'copy';
      }
    });
    
    item.addEventListener('dragend', (e) => {
      const target = e.target as HTMLElement;
      target.classList.remove('dragging');
      console.log('Drag ended');
    });
  });
}

// Album Click Listeners hinzufügen
function addAlbumClickListeners(container: Element) {
  const albumItems = container.querySelectorAll('.album-item');
  console.log(`Adding album click listeners to ${albumItems.length} albums in container:`, container);
  
  albumItems.forEach((item, index) => {
    const albumId = (item as HTMLElement).dataset.albumId;
    console.log(`Setting up album ${index}: ID=${albumId}`);
    
    item.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log(`Album clicked: ${albumId} (click event fired)`);
      
      if (albumId) {
        await showAlbumSongs(albumId);
      } else {
        console.error('Album ID not found on clicked element');
      }
    });
  });
}

// Artist Click Listeners hinzufügen
function addArtistClickListeners(container: Element) {
  const artistItems = container.querySelectorAll('.artist-item');
  console.log(`Adding artist click listeners to ${artistItems.length} artists`);
  
  artistItems.forEach(item => {
    item.addEventListener('click', async (e) => {
      e.preventDefault();
      const artistId = (item as HTMLElement).dataset.artistId;
      if (artistId) {
        console.log(`Artist clicked: ${artistId}`);
        await showArtistDetails(artistId);
      }
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
    
    // Songs Container finden und anzeigen
    const songsContainer = document.getElementById('songs-list');
    if (songsContainer) {
      const albumName = album ? album.name : 'Unknown Album';
      const albumArtist = album ? album.artist : 'Unknown Artist';
      
      songsContainer.innerHTML = `
        <div class="album-header">
          <h3>Album: ${escapeHtml(albumName)} - ${escapeHtml(albumArtist)}</h3>
          <button class="back-btn" id="back-to-songs">← Back to All Songs</button>
        </div>
        ${albumSongs.map(song => createSongHTML(song)).join('')}
      `;
      addDragListeners(songsContainer);
      
      // Back Button Event Listener
      const backBtn = document.getElementById('back-to-songs');
      if (backBtn) {
        backBtn.addEventListener('click', async () => {
          await loadSongs();
        });
      }
      
      // Wechsle zum Songs Tab
      const songsTab = document.querySelector('[data-tab="songs"]');
      if (songsTab) {
        (songsTab as HTMLElement).click();
      }
    }
  } catch (error) {
    console.error('Error loading album songs:', error);
    showError(`Error loading album songs: ${error}`);
  }
}

// Artist Details anzeigen
async function showArtistDetails(artistId: string) {
  if (!navidromeClient) return;
  
  try {
    console.log(`Loading details for artist ${artistId}`);
    const artist = currentArtists.find(a => a.id === artistId);
    const artistSongs = await navidromeClient.getArtistSongs(artistId);
    const artistAlbums = await navidromeClient.getArtistAlbums(artistId);
    
    // Songs Container finden und anzeigen
    const songsContainer = document.getElementById('songs-list');
    if (songsContainer && artist) {
      songsContainer.innerHTML = `
        <div class="artist-header">
          <h3>Artist: ${escapeHtml(artist.name)}</h3>
          <button class="back-btn" id="back-to-songs-artist">← Back to All Songs</button>
        </div>
        <div class="artist-section">
          <h4>Top Songs</h4>
          ${artistSongs.slice(0, 10).map((song: NavidromeSong) => createSongHTML(song)).join('')}
        </div>
        <div class="artist-section">
          <h4>Albums</h4>
          <div class="albums-grid">
            ${artistAlbums.map((album: NavidromeAlbum) => createAlbumHTML(album)).join('')}
          </div>
        </div>
      `;
      addDragListeners(songsContainer);
      addAlbumClickListeners(songsContainer);
      
      // Back Button Event Listener
      const backBtn = document.getElementById('back-to-songs-artist');
      if (backBtn) {
        backBtn.addEventListener('click', async () => {
          await loadSongs();
        });
      }
      
      // Wechsle zum Songs Tab
      const songsTab = document.querySelector('[data-tab="songs"]');
      if (songsTab) {
        (songsTab as HTMLElement).click();
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
  const searchContainer = document.getElementById('search-results');
  if (searchContainer) {
    searchContainer.innerHTML = '<div class="loading">Searching...</div>';
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
  
  const performLogin = async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    const serverUrl = serverInput.value.trim() || "https://musik.radio-endstation.de";
    
    if (!username || !password) {
      console.log('❌ Please enter username and password');
      return;
    }
    
    try {
      console.log('🔄 Connecting to Navidrome...');
      loginBtn.disabled = true;
      loginBtn.textContent = 'Connecting...';
      
      // Erstelle Navidrome Client mit eingegebenen Credentials
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
        loginBtn.textContent = 'Login Failed';
        setTimeout(() => {
          loginBtn.textContent = 'Login';
          loginBtn.disabled = false;
        }, 2000);
      }
      
    } catch (error) {
      console.error("❌ Navidrome connection error:", error);
      loginBtn.textContent = 'Connection Error';
      setTimeout(() => {
        loginBtn.textContent = 'Login';
        loginBtn.disabled = false;
      }, 2000);
    }
  };
  
  loginBtn?.addEventListener('click', performLogin);
  
  // Enter-Taste in Passwort-Feld
  passwordInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      performLogin();
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
  const progressBar = document.getElementById(`progress-${side}`) as HTMLElement;
  const progressContainer = document.getElementById(`progress-bar-${side}`) as HTMLElement;
  const playerDeck = document.getElementById(`player-${side}`) as HTMLElement;
  
  // Audio Event Listeners
  audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
      const progress = (audio.currentTime / audio.duration) * 100;
      if (progressBar) {
        progressBar.style.width = `${progress}%`;
      }
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
      playPauseBtn.textContent = '▶️';
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
    if (audio.paused) {
      if (audio.src) {
        audio.play().catch(e => {
          console.error(`❌ Play error on Player ${side}:`, e);
          showError(`Cannot play on Player ${side.toUpperCase()}: ${e.message}`);
        });
        playPauseBtn.textContent = '⏸️';
        playPauseBtn.classList.add('playing');
      } else {
        console.log(`❓ No track loaded on Player ${side}`);
        showError(`No track loaded on Player ${side.toUpperCase()}`);
      }
    } else {
      audio.pause();
      playPauseBtn.textContent = '▶️';
      playPauseBtn.classList.remove('playing');
    }
  });
  
  ejectBtn?.addEventListener('click', () => {
    audio.pause();
    audio.currentTime = 0;
    audio.src = '';
    const trackTitle = document.getElementById(`track-title-${side}`);
    const trackArtist = document.getElementById(`track-artist-${side}`);
    if (trackTitle) trackTitle.textContent = 'No Track Loaded';
    if (trackArtist) trackArtist.textContent = '';
    if (playPauseBtn) {
      playPauseBtn.textContent = '▶️';
      playPauseBtn.classList.remove('playing');
    }
    if (playerDeck) {
      playerDeck.classList.remove('playing');
    }
  });

  restartBtn?.addEventListener('click', () => {
    audio.currentTime = 0;
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
  
  // Vorherigen Track stoppen
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
  
  // Suche in Search Results (DOM)
  const searchResults = document.querySelectorAll('.track-item');
  for (const item of searchResults) {
    const element = item as HTMLElement;
    if (element.dataset.songId === songId) {
      // Extrahiere Song-Info aus dem DOM-Element
      const titleElement = element.querySelector('h4');
      const infoElement = element.querySelector('p');
      
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
          bitRate: 0
        };
      }
    }
  }
  
  // Nicht gefunden
  return null;
}
