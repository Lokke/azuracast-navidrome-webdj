import "./style.css";
import { SubsonicApiClient, type OpenSubsonicSong, type OpenSubsonicAlbum, type OpenSubsonicArtist } from "./navidrome";
import WaveSurfer from 'wavesurfer.js';

console.log("SubCaster loaded!");

// Global state for search results
let lastSearchResults: any = null;
let lastSearchQuery: string = '';

// Audio Mixing und Streaming Infrastruktur
let audioContext: AudioContext | null = null;
let masterGainNode: GainNode | null = null;
let streamGainNode: GainNode | null = null; // Separate Ausgabe f�r Stream
let leftPlayerGain: GainNode | null = null;
let rightPlayerGain: GainNode | null = null;
let microphoneGain: GainNode | null = null;
let crossfaderGain: { left: GainNode; right: GainNode } | null = null;
let streamCrossfaderGain: { left: GainNode; right: GainNode } | null = null; // Separate Crossfader f�r Stream
let microphoneStream: MediaStream | null = null;
let mediaRecorder: MediaRecorder | null = null;
let isStreaming: boolean = false;
let streamChunks: Blob[] = [];

// SMART METADATA PRIORITY SYSTEM
interface PlayerState {
  song: OpenSubsonicSong | null;
  isPlaying: boolean;
  startTime: number; // Timestamp when track started playing
  side: 'left' | 'right';
}

let playerStates: Record<'left' | 'right', PlayerState> = {
  left: { song: null, isPlaying: false, startTime: 0, side: 'left' },
  right: { song: null, isPlaying: false, startTime: 0, side: 'right' }
};

let currentStreamMetadata: OpenSubsonicSong | null = null; // Currently displayed metadata in stream

let bridgeSocket: WebSocket | null = null;

// Send metadata to SubCaster Stream
function sendMetadataToAzuraCast(song: OpenSubsonicSong) {
  if (bridgeSocket?.readyState === WebSocket.OPEN) {
    const metadataMessage = {
      type: 'metadata',
      data: {
        song: `${song.artist} - ${song.title}`,
        artist: song.artist,
        title: song.title,
        album: song.album
      }
    };
    
    console.log('?? Sending metadata to Stream:', metadataMessage);
    bridgeSocket.send(JSON.stringify(metadataMessage));
  }
}

// SMART METADATA PRIORITY SYSTEM
function updateStreamMetadata() {
  if (!isStreaming) return; // Only update metadata when streaming
  
  const activePlayers = Object.values(playerStates).filter(state => state.isPlaying && state.song);
  
  if (activePlayers.length === 0) {
    // No active players - clear metadata
    currentStreamMetadata = null;
    console.log('?? Stream metadata cleared - no active players');
    return;
  }
  
  // Priority logic: Latest started player has priority
  const priorityPlayer = activePlayers.reduce((latest, current) => 
    current.startTime > latest.startTime ? current : latest
  );
  
  // Only update if metadata actually changed
  if (currentStreamMetadata?.id !== priorityPlayer.song?.id) {
    currentStreamMetadata = priorityPlayer.song;
    
    if (currentStreamMetadata) {
      sendMetadataToAzuraCast(currentStreamMetadata);
      console.log(`?? Stream metadata updated: "${currentStreamMetadata.title}" (Player ${priorityPlayer.side.toUpperCase()})`);
    }
  }
}

// Track player state changes
function setPlayerState(side: 'left' | 'right', song: OpenSubsonicSong | null, isPlaying: boolean) {
  const state = playerStates[side];
  const wasPlaying = state.isPlaying;
  
  state.song = song;
  state.isPlaying = isPlaying;
  
  // Update start time if player just started playing
  if (isPlaying && !wasPlaying) {
    state.startTime = Date.now();
    console.log(`?? Player ${side.toUpperCase()} started: "${song?.title}" at ${state.startTime}`);
  } else if (!isPlaying && wasPlaying) {
    console.log(`?? Player ${side.toUpperCase()} stopped: "${song?.title}"`);
  }
  
  // Update stream metadata based on new state
  updateStreamMetadata();
}

// Get currently loaded song from player
function getCurrentLoadedSong(side: 'left' | 'right'): OpenSubsonicSong | null {
  const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
  if (!audio || !audio.dataset.songId) return null;
  
  // Find song by ID in current songs or player state
  return playerStates[side].song || 
         currentSongs.find(song => song.id === audio.dataset.songId) || 
         null;
}

// Complete deck reset when track ends or eject is pressed
function clearPlayerDeck(side: 'left' | 'right') {
  console.log(`?? Clearing Player ${side.toUpperCase()} deck completely`);
  
  const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
  const titleElement = document.getElementById(`track-title-${side}`);
  const artistElement = document.getElementById(`track-artist-${side}`);
  const albumCover = document.getElementById(`album-cover-${side}`) as HTMLImageElement;
  const playerRating = document.getElementById(`player-rating-${side}`);
  const timeDisplay = document.getElementById(`time-display-${side}`);
  
  // Clear audio
  if (audio) {
    audio.pause();
    audio.src = '';
    audio.currentTime = 0;
    delete audio.dataset.songId;
  }
  
  // Clear metadata display
  if (titleElement) titleElement.textContent = 'No Track Loaded';
  if (artistElement) artistElement.textContent = '';
  
  // Clear album cover
  if (albumCover) {
    albumCover.src = '/placeholder-cover.png';
    albumCover.alt = 'No Cover';
  }
  
  // Clear rating
  if (playerRating) {
    playerRating.innerHTML = '';
  }
  
  // Clear time display
  if (timeDisplay) {
    timeDisplay.textContent = '00:00 / 00:00';
  }
  
  // Reset waveform
  resetWaveform(side);
  
  // Clear player state
  setPlayerState(side, null, false);
  
  console.log(`? Player ${side.toUpperCase()} deck cleared completely`);
}

// Debug function to show current player states and metadata priority
function debugPlayerStates() {
  console.log('?? CURRENT PLAYER STATES DEBUG:');
  console.log('Left Player:', playerStates.left);
  console.log('Right Player:', playerStates.right);
  console.log('Current Stream Metadata:', currentStreamMetadata?.title || 'None');
  console.log('Is Streaming:', isStreaming);
  
  const activePlayers = Object.values(playerStates).filter(state => state.isPlaying && state.song);
  if (activePlayers.length > 0) {
    const priorityPlayer = activePlayers.reduce((latest, current) => 
      current.startTime > latest.startTime ? current : latest
    );
    console.log('Priority Player:', priorityPlayer.side.toUpperCase(), priorityPlayer.song?.title);
  } else {
    console.log('No active players');
  }
}

// Make debug function available globally
(window as any).debugPlayerStates = debugPlayerStates;

// Streaming Konfiguration
interface StreamConfig {
  serverUrl: string;
  serverType: 'icecast' | 'shoutcast';
  mountPoint: string; // nur f�r Icecast und Shoutcast v2
  password: string;
  bitrate: number;
  format: 'mp3' | 'aac';
  sampleRate: number;
  username?: string; // f�r manche Server
}

let streamConfig: StreamConfig = {
  serverUrl: getStreamServerUrl(),
  serverType: (import.meta.env.VITE_STREAM_SERVER_TYPE as 'icecast' | 'shoutcast') || 'icecast',
  mountPoint: import.meta.env.VITE_STREAM_MOUNT_POINT || '/live',
  password: import.meta.env.VITE_STREAM_PASSWORD,
  bitrate: parseInt(import.meta.env.VITE_STREAM_BITRATE) || 192, // Erh�ht auf 192 kbps f�r bessere Qualit�t
  format: 'mp3',
  sampleRate: 48000, // Erh�ht auf 48kHz f�r professionelle Audio-Qualit�t
  username: import.meta.env.VITE_STREAM_USERNAME
};

// Hilfsfunktion f�r Stream-Server-URL mit Proxy-Unterst�tzung
function getStreamServerUrl(): string {
  const useProxy = import.meta.env.VITE_USE_PROXY === 'true';
  
  if (useProxy) {
    const proxyServer = import.meta.env.VITE_PROXY_SERVER || 'http://localhost:3001';
    return `${proxyServer}/stream`;
  } else {
    return import.meta.env.VITE_STREAM_SERVER || 'http://localhost:8000';
  }
}

// AUDIO MIXING FUNCTIONS (Moved up for proper scoping)

// Audio-Mixing-System initialisieren
async function initializeAudioMixing() {
  try {
    // AudioContext mit dynamischer Sample Rate (Browser-Standard)
    const audioContextOptions: AudioContextOptions = {
      latencyHint: 'playback' // Optimiert f�r Playback statt Interaktion
      // sampleRate bewusst weggelassen ? Browser w�hlt optimale Sample Rate
    };
    
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)(audioContextOptions);
    
    // Log der tats�chlich verwendeten Sample Rate
    console.log(`?? AudioContext created with dynamic sample rate: ${audioContext.sampleRate} Hz`);
    console.log(`?? AudioContext state: ${audioContext.state}`);
    
    // Sample Rate Kompatibilit�t pr�fen
    const supportedRates = [8000, 16000, 22050, 44100, 48000, 96000, 192000];
    const currentRate = audioContext.sampleRate;
    const isStandardRate = supportedRates.includes(currentRate);
    
    console.log(`?? Sample Rate Analysis:`);
    console.log(`   - Current: ${currentRate} Hz`);
    console.log(`   - Is Standard: ${isStandardRate ? '?' : '??'}`);
    console.log(`   - Browser optimized for: ${currentRate >= 48000 ? 'High Quality' : 'Standard Quality'}`);
    
    // BROWSER AUDIO KOMPATIBILIT�T: AudioContext sofort suspendieren
    // Wird nur bei Broadcast aktiviert, sodass andere Tabs normal funktionieren
    if (audioContext.state === 'running') {
      await audioContext.suspend();
      console.log('?? AudioContext suspended by default - other tabs can play audio normally');
      console.log('?? Will only activate during broadcasting to avoid interference');
    }
    
    // Audio Context Policy: Andere Audio-Quellen nicht beeintr�chtigen
    if ('audioWorklet' in audioContext) {
      console.log('?? Audio Context supports advanced features - using isolated mode');
    }
    
    // Master Gain Node f�r Monitor-Ausgabe (Kopfh�rer/Lautsprecher)
    masterGainNode = audioContext.createGain();
    masterGainNode.gain.value = 0.99; // 99% Master-Volume
    masterGainNode.connect(audioContext.destination);
    
    // Stream Gain Node f�r Live-Stream (separate Ausgabe)
    streamGainNode = audioContext.createGain();
    streamGainNode.gain.value = 0.99; // 99% Stream-Volume
    
    // Separate Gain Nodes f�r jeden Player
    leftPlayerGain = audioContext.createGain();
    leftPlayerGain.gain.value = 1.0; // 100% Initial volume
    rightPlayerGain = audioContext.createGain();
    rightPlayerGain.gain.value = 1.0; // 100% Initial volume
    
    // Crossfader Gain Nodes f�r Monitor-Ausgabe
    crossfaderGain = {
      left: audioContext.createGain(),
      right: audioContext.createGain()
    };
    
    // Crossfader Gain Nodes f�r Stream-Ausgabe (separate Kontrolle)
    streamCrossfaderGain = {
      left: audioContext.createGain(),
      right: audioContext.createGain()
    };
    
    // Initial Crossfader in der Mitte (beide Kan�le gleichlaut)
    const initialGain = Math.cos(0.5 * Math.PI / 2); // ~0.707 f�r 50% Position
    crossfaderGain.left.gain.value = initialGain;
    crossfaderGain.right.gain.value = initialGain;
    streamCrossfaderGain.left.gain.value = initialGain;
    streamCrossfaderGain.right.gain.value = initialGain;
    
    // Mikrofon Gain Node
    microphoneGain = audioContext.createGain();
    microphoneGain.gain.value = 0; // Standardm��ig stumm (wird �ber Button aktiviert)
    
    // Monitor-Routing: Crossfader Gains mit Master verbinden
    crossfaderGain.left.connect(masterGainNode);
    crossfaderGain.right.connect(masterGainNode);
    
    // Stream-Routing: Stream Crossfader Gains mit Stream verbinden
    streamCrossfaderGain.left.connect(streamGainNode);
    streamCrossfaderGain.right.connect(streamGainNode);
    
    // Player Gains mit beiden Crossfadern verbinden
    leftPlayerGain.connect(crossfaderGain.left);
    leftPlayerGain.connect(streamCrossfaderGain.left);
    rightPlayerGain.connect(crossfaderGain.right);
    rightPlayerGain.connect(streamCrossfaderGain.right);
    
    // Mikrofon zu beiden Ausg�ngen verbinden
    microphoneGain.connect(masterGainNode);
    microphoneGain.connect(streamGainNode);
    
    console.log('??? Audio mixing system initialized with separate monitor and stream outputs');
    
    // Volume Meter sofort nach Audio-Initialisierung starten
    setTimeout(() => {
      console.log('?? Starting volume meters...');
      startVolumeMeter('left');
      startVolumeMeter('right');
      startVolumeMeter('mic');
    }, 500); // Kurze Verz�gerung f�r Audio-Kontext Stabilit�t
    
    return true;
  } catch (error) {
    console.error('Failed to initialize audio mixing:', error);
    return false;
  }
}

// Audio-Quellen zu Mixing-System hinzuf�gen
function connectAudioToMixer(audioElement: HTMLAudioElement, side: 'left' | 'right') {
  if (!audioContext) {
    console.error(`? AudioContext not initialized for ${side} player`);
    return false;
  }
  
  try {
    // Entferne vorherige AudioSource-Verbindung falls vorhanden
    if ((audioElement as any)._audioSourceNode) {
      try {
        (audioElement as any)._audioSourceNode.disconnect();
        console.log(`?? Disconnected previous ${side} audio source`);
      } catch (e) {
        // Source node already disconnected
      }
    }
    
    // WICHTIG: Audio Element Eigenschaften f�r bessere Browser-Kompatibilit�t setzen
    audioElement.crossOrigin = 'anonymous';
    audioElement.preservesPitch = false; // Weniger CPU-intensiv
    
    // MediaElementAudioSourceNode erstellen (mit Browser-Audio-Koexistenz)
    const sourceNode = audioContext.createMediaElementSource(audioElement);
    (audioElement as any)._audioSourceNode = sourceNode; // Speichere Referenz f�r sp�teres Cleanup
    
    // BROWSER AUDIO KOMPATIBILIT�T: Duplex Output f�r normale Browser-Audio
    try {
      // Versuche normale Audio-Pipeline beizubehalten (falls Browser es unterst�tzt)
      if ('setSinkId' in audioElement) {
        console.log(`?? ${side} player: Browser supports setSinkId - maintaining dual audio pipeline`);
      }
    } catch (e) {
      console.log(`??  ${side} player: Browser audio pipeline fully captured by Web Audio API`);
    }
    
    // Mit entsprechendem Player Gain verbinden
    if (side === 'left' && leftPlayerGain) {
      sourceNode.connect(leftPlayerGain);
      console.log(`?? Connected ${side} player to leftPlayerGain (Web Audio API)`);
      
    } else if (side === 'right' && rightPlayerGain) {
      sourceNode.connect(rightPlayerGain);
      console.log(`?? Connected ${side} player to rightPlayerGain (Web Audio API)`);
      
    } else {
      console.error(`? Failed to connect ${side} player: gain node not available`);
      return false;
    }
    
    // WICHTIG: Nach createMediaElementSource wird das Audio-Element stumm!
    // Es muss �ber die Web Audio API Pipeline laufen
    console.log(`??  ${side} audio now routed through Web Audio API ? Stream`);
    
    // Debugging: Aktueller Audio-Flow anzeigen
    console.log(`?? Audio Flow: ${side} Player ? ${side}PlayerGain ? StreamGainNode ? MediaRecorder ? Shoutcast`);
    
    return true;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('AudioNode is already connected')) {
      console.log(`? ${side} player already connected to mixer`);
      return true;
    } else if (errorMsg.includes('MediaElementAudioSource')) {
      console.warn(`??  ${side} player already has MediaElementSource - this is normal for track changes`);
      return true;
    } else {
      console.error(`? Failed to connect ${side} player to mixer:`, error);
      return false;
    }
  }
}

// Player Deck Fragment Template
function createPlayerDeckHTML(side: 'left' | 'right'): string {
  const playerLetter = side === 'left' ? 'A' : 'B';
  const labelClass = side === 'left' ? 'left' : 'right';
  
  return `
    <div class="player-label ${labelClass}">
      <div class="player-label-dot"></div>
      <span class="player-label-text">Player ${playerLetter}</span>
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
        <!-- Volume Meter -->
        <div class="volume-meter" id="volume-meter-${side}">
          <div class="meter-bars">
            <div class="meter-bar" style="--level: 0"></div>
            <div class="meter-bar" style="--level: 1"></div>
            <div class="meter-bar" style="--level: 2"></div>
            <div class="meter-bar" style="--level: 3"></div>
            <div class="meter-bar" style="--level: 4"></div>
            <div class="meter-bar" style="--level: 5"></div>
            <div class="meter-bar" style="--level: 6"></div>
            <div class="meter-bar" style="--level: 7"></div>
            <div class="meter-bar orange" style="--level: 8"></div>
            <div class="meter-bar red" style="--level: 9"></div>
          </div>
          <div class="meter-label">dB</div>
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
function updateAlbumCover(side: 'left' | 'right', song: OpenSubsonicSong) {
  const albumCoverElement = document.getElementById(`album-cover-${side}`);
  console.log(`?? Updating album cover for ${side} player:`, {
    element: albumCoverElement,
    song: song.title,
    coverArt: song.coverArt,
    openSubsonicClient: !!openSubsonicClient
  });
  
  if (!albumCoverElement) {
    console.error(`? Album cover element not found: album-cover-${side}`);
    return;
  }
  
  if (!openSubsonicClient) {
    console.warn(`? OpenSubsonic client not available`);
    albumCoverElement.innerHTML = `
      <div class="no-cover">
        <span class="material-icons">music_note</span>
      </div>
    `;
    return;
  }
  
  if (song.coverArt) {
    const coverUrl = openSubsonicClient.getCoverArtUrl(song.coverArt, 90);
    console.log(`??? Setting cover URL: ${coverUrl}`);
    
    const img = document.createElement('img');
    img.src = coverUrl;
    img.alt = 'Album Cover';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    
    // Debug: Check if image loads
    img.onload = () => {
      console.log(`? Album cover loaded successfully for ${side}`);
    };
    img.onerror = (error) => {
      console.error(`? Album cover failed to load for ${side}:`, error);
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
    console.log(`? No cover art for song: ${song.title}`);
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
  
  // WaveSurfer muten - es soll nur Visualization sein, kein Audio output
  wavesurfer.setVolume(0);
  console.log(`?? WaveSurfer ${side} set to mute (visualization only)`);

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
// WaveSurfer Synchronisation (currently unused, but kept for future enhancement)
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

// OpenSubsonic Client (wird sp�ter mit echten Credentials initialisiert)
let openSubsonicClient: SubsonicApiClient;

// Globale Variablen
let currentSongs: OpenSubsonicSong[] = [];
let currentAlbums: OpenSubsonicAlbum[] = [];
let currentArtists: OpenSubsonicArtist[] = [];
let queue: OpenSubsonicSong[] = [];
let autoQueueEnabled = true; // Auto-Queue standardm��ig aktiviert

document.addEventListener("DOMContentLoaded", async () => {
  console.log("DOM fully loaded and parsed");
  
  // Initialize Player Decks
  initializePlayerDecks();
  
  // Login-Formular initialisieren
  initializeOpenSubsonicLogin();
  
  // Stream-Konfiguration Panel initialisieren
  initializeStreamConfigPanel();
  
  // Initialize Media Library (nur Event Listeners, keine Daten)
  initializeMediaLibrary();
  
  // Mikrofon Toggle Funktionalit�t
  const micBtn = document.getElementById("mic-toggle") as HTMLButtonElement;
  const micVolumeSlider = document.getElementById("mic-volume") as HTMLInputElement;
  let micActive = false;
  
  // Mikrofon Volume Control
  micVolumeSlider?.addEventListener("input", (e) => {
    const target = e.target as HTMLInputElement;
    const volume = parseInt(target.value) / 100;
    if (microphoneGain) {
      microphoneGain.gain.value = micActive ? volume : 0;
      console.log(`?? Microphone volume: ${Math.round(volume * 100)}%`);
    }
  });
  
  micBtn?.addEventListener("click", async () => {
    micActive = !micActive;
    
    if (micActive) {
      // Mikrofon einschalten und Audio-Mixing initialisieren falls n�tig
      if (!audioContext) {
        await initializeAudioMixing();
      }
      
      // Mikrofon einrichten
      const micReady = await setupMicrophone();
      if (micReady) {
        // Volume basierend auf Slider setzen
        const volume = parseInt(micVolumeSlider?.value || "70") / 100;
        setMicrophoneEnabled(true, volume);
        micBtn.classList.add("active");
        micBtn.innerHTML = '<span class="material-icons">mic</span> MIKROFON AN';
        console.log("?? Mikrofon aktiviert - pulsiert rot");
      } else {
        micActive = false;
        alert('Microphone access denied or not available');
      }
    } else {
      setMicrophoneEnabled(false);
      micBtn.classList.remove("active");
      micBtn.innerHTML = '<span class="material-icons">mic</span> MIKROFON';
      console.log("Mikrofon deaktiviert");
    }
  });
  
// Audio-Mixing-System initialisieren
// Audio-Quellen zu Mixing-System hinzuf�gen

// CORS-Fehlermeldung anzeigen
function showCORSErrorMessage() {
  // Pr�fen ob bereits eine Fehlermeldung angezeigt wird
  if (document.getElementById('cors-error-message')) return;
  
  const errorDiv = document.createElement('div');
  errorDiv.id = 'cors-error-message';
  errorDiv.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(135deg, #ff4444 0%, #cc0000 100%);
    color: white;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 10000;
    max-width: 400px;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 14px;
    line-height: 1.4;
  `;
  
  errorDiv.innerHTML = `
    <div style="display: flex; align-items: center; margin-bottom: 10px;">
      <span class="material-icons" style="margin-right: 8px;">error</span>
      <strong>Streaming Connection Blocked</strong>
    </div>
    <p style="margin: 8px 0;">Browser-Security (CORS) verhindert direkte Verbindungen zu Shoutcast-Servern.</p>
    <div style="margin-top: 12px; font-size: 12px; opacity: 0.9;">
      <strong>L�sungen:</strong><br>
      � Proxy-Server verwenden<br>
      � Browser mit --disable-web-security starten<br>
      � Server CORS-Header konfigurieren
    </div>
    <button onclick="this.parentElement.remove()" style="
      position: absolute;
      top: 8px;
      right: 8px;
      background: none;
      border: none;
      color: white;
      font-size: 18px;
      cursor: pointer;
      opacity: 0.7;
    ">&times;</button>
  `;
  
  document.body.appendChild(errorDiv);
  
  // Automatisch nach 10 Sekunden entfernen
  setTimeout(() => {
    if (errorDiv.parentElement) {
      errorDiv.remove();
    }
  }, 10000);
}

// Mikrofon zum Mixing-System hinzuf�gen
async function setupMicrophone() {
  if (!audioContext || !microphoneGain) return false;
  
  try {
    // DYNAMISCHE SAMPLE RATE: Verwende AudioContext Sample Rate f�r Kompatibilit�t
    const contextSampleRate = audioContext.sampleRate;
    console.log(`?? Setting up microphone with dynamic sample rate: ${contextSampleRate} Hz`);
    
    // Mikrofon-Konfiguration f�r DJ-Anwendung (ALLE Audio-Effekte deaktiviert f�r beste Verst�ndlichkeit)
    microphoneStream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        // Basis-Audio-Einstellungen - ALLE Effekte AUS f�r nat�rliche Stimme
        echoCancellation: false,          // Echo-Cancel AUS - verschlechtert oft DJ-Mikrofone
        noiseSuppression: false,          // Noise-Suppress AUS - kann Stimme verzerren
        autoGainControl: false,           // AGC aus f�r manuelle Lautst�rke-Kontrolle
        
        // DYNAMISCHE Sample Rate - passt sich an AudioContext an
        sampleRate: { 
          ideal: contextSampleRate,       // Verwende AudioContext Sample Rate
          min: 8000,                      // Minimum f�r Fallback
          max: 192000                     // Maximum f�r High-End Mikrofone
        },
        sampleSize: { ideal: 16 },        // 16-bit Audio
        channelCount: { ideal: 1 },       // Mono f�r geringere Bandbreite
        
        // Browser-spezifische Verbesserungen - ALLE AUS f�r nat�rliche Stimme
        // @ts-ignore - Browser-spezifische Eigenschaften
        googEchoCancellation: false,      // Google Echo-Cancel AUS
        // @ts-ignore
        googAutoGainControl: false,       // Google AGC AUS
        // @ts-ignore
        googNoiseSuppression: false,      // Google Noise-Suppress AUS
        // @ts-ignore
        googHighpassFilter: false,        // Highpass-Filter AUS
        // @ts-ignore
        googTypingNoiseDetection: false,  // Typing-Detection AUS
        // @ts-ignore
        googAudioMirroring: false
      } 
    });
    
    // Mikrofon-Track Sample Rate Analyse
    microphoneStream.getAudioTracks().forEach((track, index) => {
      track.enabled = true; // Track ist aktiv f�r Aufnahme
      
      const settings = track.getSettings();
      console.log(`?? Microphone Track ${index + 1} Settings:`);
      console.log(`   - Sample Rate: ${settings.sampleRate || 'unknown'} Hz`);
      console.log(`   - Channels: ${settings.channelCount || 'unknown'}`);
      console.log(`   - Sample Size: ${settings.sampleSize || 'unknown'} bit`);
      console.log(`   - Echo Cancellation: ${settings.echoCancellation ? '?' : '?'}`);
      console.log(`   - Noise Suppression: ${settings.noiseSuppression ? '?' : '?'}`);
      console.log(`   - Auto Gain Control: ${settings.autoGainControl ? '?' : '?'}`);
      
      // Sample Rate Kompatibilit�t pr�fen
      if (settings.sampleRate && settings.sampleRate !== contextSampleRate) {
        console.warn(`??  Sample Rate Mismatch: Microphone=${settings.sampleRate}Hz, AudioContext=${contextSampleRate}Hz`);
        console.log(`?? Browser will automatically resample: ${settings.sampleRate}Hz ? ${contextSampleRate}Hz`);
      } else {
        console.log(`? Perfect Sample Rate Match: ${contextSampleRate}Hz`);
      }
      
      // Erweiterte Track-Einstellungen - ALLE Audio-Effekte deaktiviert f�r nat�rliche Stimme
      if (track.applyConstraints) {
        track.applyConstraints({
          echoCancellation: false,      // Echo-Cancel AUS f�r DJ-Mikrofon
          noiseSuppression: false,      // Noise-Suppress AUS f�r nat�rliche Stimme
          autoGainControl: false,       // AGC AUS f�r manuelle Kontrolle
          sampleRate: contextSampleRate // Dynamische Sample Rate
        }).catch(e => console.warn('Could not apply advanced mic constraints:', e));
      }
    });
    
    // MediaStreamAudioSourceNode erstellen
    const micSourceNode = audioContext.createMediaStreamSource(microphoneStream);
    
    // Optional: Kompressor f�r bessere Mikrofon-Qualit�t hinzuf�gen
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-24, audioContext.currentTime);
    compressor.knee.setValueAtTime(30, audioContext.currentTime);
    compressor.ratio.setValueAtTime(12, audioContext.currentTime);
    compressor.attack.setValueAtTime(0.003, audioContext.currentTime);
    compressor.release.setValueAtTime(0.25, audioContext.currentTime);
    
    // Audio-Kette: Mikrofon -> Kompressor -> Gain
    micSourceNode.connect(compressor);
    compressor.connect(microphoneGain);
    
    console.log(`?? Microphone connected with enhanced audio processing (${contextSampleRate}Hz, compression, dynamic compatibility)`);
    return true;
  } catch (error) {
    console.error('Failed to setup microphone:', error);
    // Fallback mit einfacheren Einstellungen versuchen
    try {
      console.log('?? Trying microphone fallback with browser defaults...');
      microphoneStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false
          // Keine Sample Rate Constraints ? Browser w�hlt automatisch
        } 
      });
      
      const micSourceNode = audioContext.createMediaStreamSource(microphoneStream);
      micSourceNode.connect(microphoneGain);
      
      console.log('?? Microphone connected with basic settings (fallback)');
      return true;
    } catch (fallbackError) {
      console.error('Failed to setup microphone even with basic settings:', fallbackError);
      return false;
    }
  }
}

// Crossfader-Position setzen (0 = links, 0.5 = mitte, 1 = rechts)
function setCrossfaderPosition(position: number) {
  if (!crossfaderGain || !streamCrossfaderGain) return;
  
  // Position zwischen 0 und 1 begrenzen
  position = Math.max(0, Math.min(1, position));
  
  // Links: maximum bei 0, minimum bei 1
  const leftGain = Math.cos(position * Math.PI / 2);
  // Rechts: minimum bei 0, maximum bei 1
  const rightGain = Math.sin(position * Math.PI / 2);
  
  // Monitor-Crossfader (f�r Speaker/Kopfh�rer)
  crossfaderGain.left.gain.value = leftGain;
  crossfaderGain.right.gain.value = rightGain;
  
  // Stream-Crossfader (f�r Live-Stream) - gleiche Werte
  streamCrossfaderGain.left.gain.value = leftGain;
  streamCrossfaderGain.right.gain.value = rightGain;
  
  console.log(`??? Crossfader position: ${position}, Left: ${leftGain.toFixed(2)}, Right: ${rightGain.toFixed(2)} (Monitor + Stream)`);
}

// Mikrofon ein-/ausschalten
function setMicrophoneEnabled(enabled: boolean, volume: number = 1) {
  if (!microphoneGain) return;
  
  microphoneGain.gain.value = enabled ? volume : 0;
  console.log(`?? Microphone ${enabled ? 'enabled' : 'disabled'} with volume ${Math.round(volume * 100)}%`);
}

// MediaRecorder f�r Streaming einrichten
async function initializeStreamRecorder() {
  if (!audioContext || !streamGainNode) {
    console.error('Audio context or stream gain node not initialized');
    return false;
  }
  
  try {
    // MediaStreamDestination erstellen f�r Stream-Aufnahme
    const destination = audioContext.createMediaStreamDestination();
    streamGainNode.connect(destination); // Verwende streamGainNode statt masterGainNode
    
    // MediaRecorder mit MP3-kompatiblen Einstellungen
    let options: MediaRecorderOptions;
    
    if (streamConfig.format === 'mp3') {
      // MP3 wird nicht direkt von MediaRecorder unterst�tzt
      // Fallback auf AAC in MP4 Container oder WebM/Opus
      options = {
        mimeType: 'audio/mp4',  // AAC in MP4 - n�her an MP3
        audioBitsPerSecond: streamConfig.bitrate * 1000
      };
      
      // Fallback falls MP4 nicht unterst�tzt wird
      if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
        options = {
          mimeType: 'audio/webm;codecs=opus',
          audioBitsPerSecond: streamConfig.bitrate * 1000
        };
      }
    } else {
      // AAC
      options = {
        mimeType: 'audio/mp4',
        audioBitsPerSecond: streamConfig.bitrate * 1000
      };
    }
    
    mediaRecorder = new MediaRecorder(destination.stream, options);
    
    // Event Handlers f�r MediaRecorder
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        streamChunks.push(event.data);
        
        // Send raw audio data to SubCaster Stream WebSocket
        if (isStreaming && bridgeSocket?.readyState === WebSocket.OPEN) {
          // Send raw audio binary data directly
          bridgeSocket.send(event.data);
        }
      }
    };
    
    mediaRecorder.onstart = () => {
      console.log('Stream recording started');
      streamChunks = [];
    };
    
    mediaRecorder.onstop = () => {
      console.log('Stream recording stopped');
    };
    
    mediaRecorder.onerror = (event) => {
      console.error('MediaRecorder error:', event);
    };
    
    console.log('Stream recorder initialized with format:', options.mimeType);
    return true;
  } catch (error) {
    console.error('Failed to initialize stream recorder:', error);
    return false;
  }
}

// HTTP-Verbindung zu Icecast/Shoutcast Server
let streamConnection: XMLHttpRequest | null = null;

function connectToStreamingServer() {
  return new Promise<boolean>((resolve) => {
    try {
      streamConnection = new XMLHttpRequest();
      
      // Verwende die bereits konfigurierte Stream-URL (mit Proxy-Logik)
      let streamUrl = streamConfig.serverUrl;
      
      // F�r Icecast Mount Point anh�ngen, au�er bei Proxy (bereits enthalten)
      const useProxy = import.meta.env.VITE_USE_PROXY === 'true';
      if (!useProxy && streamConfig.serverType === 'icecast' && streamConfig.mountPoint) {
        streamUrl += streamConfig.mountPoint;
      }
      
      console.log(`Connecting to ${streamConfig.serverType} server: ${streamUrl}`);
      console.log(`Using proxy: ${useProxy}`);
      
      // HTTP PUT Request f�r Streaming
      streamConnection.open('PUT', streamUrl, true);
      
      // Headers f�r Icecast/Shoutcast
      if (streamConfig.serverType === 'icecast') {
        // Icecast Headers
        streamConnection.setRequestHeader('Authorization', 
          'Basic ' + btoa(`${streamConfig.username || 'source'}:${streamConfig.password}`));
        streamConnection.setRequestHeader('Content-Type', 'audio/mpeg');
        streamConnection.setRequestHeader('Ice-Name', 'DJ Radio Live Stream');
        streamConnection.setRequestHeader('Ice-Description', 'Live DJ Set');
        streamConnection.setRequestHeader('Ice-Genre', 'Electronic');
        streamConnection.setRequestHeader('Ice-Bitrate', streamConfig.bitrate.toString());
        streamConnection.setRequestHeader('Ice-Public', '1');
      } else {
        // Shoutcast Headers
        streamConnection.setRequestHeader('Authorization', 
          'Basic ' + btoa(`:${streamConfig.password}`));
        streamConnection.setRequestHeader('Content-Type', 'audio/mpeg');
        streamConnection.setRequestHeader('Icy-Name', 'DJ Radio Live Stream');
        streamConnection.setRequestHeader('Icy-Genre', 'Electronic');
        streamConnection.setRequestHeader('Icy-Br', streamConfig.bitrate.toString());
        streamConnection.setRequestHeader('Icy-Pub', '1');
      }
      
      streamConnection.onreadystatechange = () => {
        if (streamConnection!.readyState === XMLHttpRequest.DONE) {
          if (streamConnection!.status === 200 || streamConnection!.status === 201) {
            console.log('Successfully connected to streaming server');
            resolve(true);
          } else {
            console.error(`Failed to connect: ${streamConnection!.status} ${streamConnection!.statusText}`);
            resolve(false);
          }
        }
      };
      
      streamConnection.onerror = () => {
        console.error('Connection error to streaming server (likely CORS issue)');
        resolve(false);
      };
      
      streamConnection.ontimeout = () => {
        console.error('Connection timeout to streaming server');
        resolve(false);
      };
      
      // Verbindung initialisieren (leerer Body f�r Initial-Request)
      try {
        streamConnection.send();
      } catch (e) {
        console.error('Failed to send request (CORS restriction):', e);
        resolve(false);
      }
      
    } catch (error) {
      console.error('Failed to connect to streaming server:', error);
      resolve(false);
    }
  });
}

// Audio Chunk an Server senden
function sendAudioChunkToServer(audioChunk: Blob) {
  if (!streamConnection || streamConnection.readyState !== XMLHttpRequest.DONE) {
    console.warn('Stream connection not ready, cannot send audio chunk');
    return;
  }
  
  // Neuer Request f�r jeden Chunk (Shoutcast/Icecast Protokoll)
  const chunkRequest = new XMLHttpRequest();
  const streamUrl = streamConfig.serverType === 'shoutcast' && !streamConfig.mountPoint 
    ? streamConfig.serverUrl 
    : `${streamConfig.serverUrl}${streamConfig.mountPoint}`;
  
  chunkRequest.open('POST', streamUrl, true);
  chunkRequest.setRequestHeader('Content-Type', 'audio/mpeg');
  
  // Authorization wiederholen
  if (streamConfig.serverType === 'icecast') {
    chunkRequest.setRequestHeader('Authorization', 
      'Basic ' + btoa(`${streamConfig.username || 'source'}:${streamConfig.password}`));
  } else {
    chunkRequest.setRequestHeader('Authorization', 
      'Basic ' + btoa(`:${streamConfig.password}`));
  }
  
  // Audio-Daten senden
  chunkRequest.send(audioChunk);
}

// Live-Streaming starten (Browser-to-Shoutcast via Proxy)
async function startLiveStream() {
  try {
    console.log('Starting live stream...');
    
    // Direktes Liquidsoap Harbor Streaming (ohne Bridge)
    return await startDirectStream();
  } catch (error) {
    console.error('Failed to start live stream:', error);
    return false;
  }
}

// Direktes Liquidsoap Harbor Streaming (ohne Bridge)
async function startDirectStream(): Promise<boolean> {
  try {
    console.log('Starting direct Liquidsoap Harbor stream...');
    
    // 1. Audio Mixing System initialisieren
    if (!audioContext || !streamGainNode) {
      const mixingReady = await initializeAudioMixing();
      if (!mixingReady) {
        throw new Error('Failed to initialize audio mixing');
      }
    }
    
    // 2. MediaStreamDestination f�r direktes Streaming
    if (!audioContext || !streamGainNode) {
      throw new Error('Audio context or stream gain node not ready');
    }
    
    const destination = audioContext.createMediaStreamDestination();
    streamGainNode.connect(destination); // Verwende streamGainNode f�r Stream-Output
    
    // 3. MediaRecorder f�r ICY-kompatible Daten mit optimierten Einstellungen
    const recorder = new MediaRecorder(destination.stream, {
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: streamConfig.bitrate * 1000,
      // Opus-spezifische Optimierungen f�r bessere Qualit�t
      bitsPerSecond: streamConfig.bitrate * 1000
    });
    
    // 4. Direkte HTTP-POST Verbindung zu Harbor (�ber unified server API)
    const harborUrl = `/api/stream`;
    
    // Verwende Credentials (Unified oder Individual aus .env)
    const useUnifiedLogin = import.meta.env.VITE_USE_UNIFIED_LOGIN === 'true';
    const unifiedUsername = import.meta.env.VITE_UNIFIED_USERNAME;
    const unifiedPassword = import.meta.env.VITE_UNIFIED_PASSWORD;
    const individualUsername = import.meta.env.VITE_STREAM_USERNAME;
    const individualPassword = import.meta.env.VITE_STREAM_PASSWORD;
    
    const username = useUnifiedLogin ? unifiedUsername : individualUsername;
    const password = useUnifiedLogin ? unifiedPassword : individualPassword;
    
    if (!username || !password) {
      const missingType = useUnifiedLogin ? 'unified' : 'individual streaming';
      throw new Error(`Missing ${missingType} credentials: username or password not set in .env`);
    }
    
    const credentials = btoa(`${username}:${password}`);
    console.log(`?? Using ${useUnifiedLogin ? 'unified' : 'individual'} credentials for streaming`);
    console.log(`?? Raw env values: username="${username}", password="${password}"`);
    console.log(`?? Combined credentials: "${username}:${password}"`);
    console.log(`?? Base64 encoded: ${credentials}`);
    
    let isConnected = false;
    let chunkQueue: Blob[] = [];
    
    // Funktion zum Senden von Audio-Chunks
    const sendAudioChunk = async (audioBlob: Blob) => {
      try {
        const response = await fetch(harborUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'audio/webm',
            'Ice-Public': '0',
            'Ice-Name': 'SubCaster Live Stream',
            'Ice-Description': 'Live broadcast from SubCaster',
            'User-Agent': 'SubCaster/1.0'
          },
          body: audioBlob,
          keepalive: true
        });
        
        if (response.ok) {
          if (!isConnected) {
            isConnected = true;
            console.log('? Direct Harbor connection established (via CORS proxy)');
            showStatusMessage('? Connected to Liquidsoap Harbor (direct)', 'success');
          }
        } else {
          console.error('Harbor rejected chunk:', response.status, response.statusText);
          if (response.status === 401) {
            throw new Error('Authentication failed');
          }
        }
      } catch (error) {
        console.error('Failed to send audio chunk:', error);
        throw error;
      }
    };
    
    // 5. MediaRecorder Event Handler
    recorder.ondataavailable = async (event) => {
      if (event.data.size > 0) {
        chunkQueue.push(event.data);
        
        // Chunks in Serie senden (nicht parallel)
        if (chunkQueue.length === 1) {
          while (chunkQueue.length > 0) {
            const chunk = chunkQueue.shift()!;
            try {
              await sendAudioChunk(chunk);
            } catch (error) {
              console.error('Failed to send chunk, stopping stream:', error);
              await stopLiveStream();
              return;
            }
          }
        }
      }
    };
    
    // 6. Mikrofon einrichten
    await setupMicrophone();
    
    // 7. Recording starten
    recorder.start(1000); // 1-Sekunden-Chunks
    
    mediaRecorder = recorder;
    isStreaming = true;
    
    console.log('Direct Harbor stream started successfully');
    return true;
    
  } catch (error) {
    console.error('Failed to start direct stream:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    showStatusMessage(`? Direct stream failed: ${errorMessage}`, 'error');
    return false;
  }
}

// Live-Streaming stoppen
async function stopLiveStream() {
  try {
    console.log('Stopping live stream...');
    
    isStreaming = false;
    
    // MediaRecorder stoppen
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
    
    // Stream-Verbindung schlie�en (f�r HTTP-Mode)
    if (streamConnection) {
      streamConnection.abort();
      streamConnection = null;
    }
    
    // Mikrofon-Stream stoppen
    if (microphoneStream) {
      microphoneStream.getTracks().forEach(track => track.stop());
      microphoneStream = null;
    }
    
    console.log('Live stream stopped');
    return true;
    
  } catch (error) {
    console.error('Failed to stop live stream:', error);
    return false;
  }
}

  // Live Status Indicator / Broadcast Button Funktionalit�t
  const liveIndicator = document.getElementById("live-status") as HTMLButtonElement;
  let broadcastActive = false;
  
  liveIndicator?.addEventListener("click", async () => {
    broadcastActive = !broadcastActive;
    
    if (broadcastActive) {
      // BROWSER AUDIO KOMPATIBILIT�T: AudioContext nur f�r Streaming aktivieren
      if (audioContext && audioContext.state === 'suspended') {
        console.log('?? Resuming AudioContext for broadcasting (other tabs should remain unaffected)');
        try {
          await audioContext.resume();
        } catch (e) {
          console.warn('AudioContext resume failed:', e);
        }
      }
      
      // Live-Streaming starten
      const success = await startLiveStream();
      
      if (success) {
        liveIndicator.classList.add("active");
        liveIndicator.title = "Stop Live Broadcast";
        console.log("Live broadcast started");
        
        // Streaming-Status anzeigen
        showStreamingStatus(true);
      } else {
        // Fehler beim Starten - Status zur�cksetzen
        broadcastActive = false;
        liveIndicator.classList.remove("active");
        console.error("Failed to start live broadcast");
        
        // CORS-spezifische Fehlermeldung anzeigen
        showCORSErrorMessage();
        
        // Nach 5 Sekunden zur�ck zu normalem State
        setTimeout(() => {
          liveIndicator.classList.remove("active");
          liveIndicator.title = "Start Live Broadcast";
        }, 5000);
      }
    } else {
      // Live-Streaming stoppen
      await stopLiveStream();
      
      // BROWSER AUDIO KOMPATIBILIT�T: AudioContext suspendieren um andere Tabs nicht zu beeintr�chtigen
      if (audioContext && audioContext.state === 'running') {
        console.log('?? Suspending AudioContext to restore normal browser audio for other tabs');
        try {
          await audioContext.suspend();
          console.log('? AudioContext suspended - other tabs should work normally now');
        } catch (e) {
          console.warn('AudioContext suspend failed:', e);
        }
      }
      
      liveIndicator.classList.remove("active");
      liveIndicator.title = "Start Live Broadcast";
      console.log("Live broadcast stopped");
      
      // Streaming-Status verstecken
      showStreamingStatus(false);
    }
  });

// Streaming-Status anzeigen/verstecken
function showStreamingStatus(isLive: boolean) {
  // Erstelle oder aktualisiere Streaming-Status-Anzeige
  let statusElement = document.getElementById('streaming-status');
  
  if (!statusElement) {
    statusElement = document.createElement('div');
    statusElement.id = 'streaming-status';
    statusElement.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #ff3333 0%, #cc0000 100%);
      color: white;
      padding: 12px 20px;
      border-radius: 25px;
      font-weight: bold;
      z-index: 1000;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 15px rgba(255, 51, 51, 0.3);
      transition: opacity 0.3s ease;
    `;
    document.body.appendChild(statusElement);
  }
  
  if (isLive) {
    statusElement.innerHTML = '<span class="material-icons">fiber_manual_record</span> LIVE ON AIR';
    statusElement.style.opacity = '1';
    
    // Pulsing-Animation f�r Live-Indikator
    statusElement.style.animation = 'pulse 2s ease-in-out infinite';
  } else {
    statusElement.style.opacity = '0';
    statusElement.style.animation = 'none';
    
    // Element nach Animation entfernen
    setTimeout(() => {
      if (statusElement && statusElement.parentNode) {
        statusElement.parentNode.removeChild(statusElement);
      }
    }, 300);
  }
}

// Stream-Konfiguration Panel Funktionalit�t
function initializeStreamConfigPanel() {
  const configBtn = document.getElementById('stream-config-btn');
  const configPanel = document.getElementById('stream-config-panel');
  const saveBtn = document.getElementById('save-stream-config');
  const cancelBtn = document.getElementById('cancel-stream-config');
  
  // Konfiguration laden
  loadStreamConfig();
  
  // Pr�fen ob �berhaupt konfigurierbare Felder vorhanden sind
  const useUnifiedLogin = import.meta.env.VITE_USE_UNIFIED_LOGIN === 'true';
  const hasUnifiedCredentials = import.meta.env.VITE_UNIFIED_USERNAME && import.meta.env.VITE_UNIFIED_PASSWORD;
  const hasIndividualCredentials = import.meta.env.VITE_STREAM_USERNAME && import.meta.env.VITE_STREAM_PASSWORD;
  const hasServerConfig = import.meta.env.VITE_STREAM_SERVER;
  
  // Wenn alle wichtigen Konfigurationen fest definiert sind, Settings-Button verstecken
  const allConfigured = hasServerConfig && ((useUnifiedLogin && hasUnifiedCredentials) || (!useUnifiedLogin && hasIndividualCredentials));
  
  if (allConfigured && configBtn) {
    configBtn.style.display = 'none';
    console.log('?? Stream settings completely configured via environment - hiding settings button');
    return;
  }
  
  // Panel ein-/ausblenden
  configBtn?.addEventListener('click', () => {
    if (configPanel) {
      const isVisible = configPanel.style.display !== 'none';
      configPanel.style.display = isVisible ? 'none' : 'block';
    }
  });
  
  // Konfiguration speichern
  saveBtn?.addEventListener('click', () => {
    saveStreamConfig();
    if (configPanel) {
      configPanel.style.display = 'none';
    }
  });
  
  // Panel schlie�en
  cancelBtn?.addEventListener('click', () => {
    loadStreamConfig(); // �nderungen verwerfen
    if (configPanel) {
      configPanel.style.display = 'none';
    }
  });
  
  // Server-Type �nderung verwalten
  const typeSelect = document.getElementById('stream-server-type') as HTMLSelectElement;
  typeSelect?.addEventListener('change', updateMountPointVisibility);
  
  // Initial Mount Point Sichtbarkeit setzen
  updateMountPointVisibility();
  
  // Panel schlie�en bei Klick au�erhalb
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (configPanel && 
        configPanel.style.display !== 'none' && 
        !configPanel.contains(target) && 
        !configBtn?.contains(target)) {
      configPanel.style.display = 'none';
    }
  });
}

// Stream-Konfiguration laden
function loadStreamConfig() {
  // Aus localStorage laden oder Standardwerte verwenden
  const saved = localStorage.getItem('streamConfig');
  if (saved) {
    try {
      streamConfig = { ...streamConfig, ...JSON.parse(saved) };
    } catch (e) {
      console.warn('Failed to load stream config from localStorage');
    }
  }
  
  // UI-Felder aktualisieren mit aktueller Konfiguration (inkl. .env Werte)
  const urlInput = document.getElementById('stream-server-url') as HTMLInputElement;
  const typeSelect = document.getElementById('stream-server-type') as HTMLSelectElement;
  const mountInput = document.getElementById('mount-point') as HTMLInputElement;
  const usernameInput = document.getElementById('stream-username') as HTMLInputElement;
  const passwordInput = document.getElementById('stream-password') as HTMLInputElement;
  const bitrateSelect = document.getElementById('stream-bitrate') as HTMLSelectElement;
  const formatSelect = document.getElementById('stream-format') as HTMLSelectElement;
  
  // Credential-Logik (Unified oder Individual)
  const useUnifiedLogin = import.meta.env.VITE_USE_UNIFIED_LOGIN === 'true';
  const unifiedUsername = import.meta.env.VITE_UNIFIED_USERNAME;
  const unifiedPassword = import.meta.env.VITE_UNIFIED_PASSWORD;
  const individualUsername = import.meta.env.VITE_STREAM_USERNAME;
  const individualPassword = import.meta.env.VITE_STREAM_PASSWORD;
  
  const finalUsername = useUnifiedLogin ? unifiedUsername : individualUsername;
  const finalPassword = useUnifiedLogin ? unifiedPassword : individualPassword;
  
  // Server-Konfiguration aus Environment-Variablen
  const envStreamServer = import.meta.env.VITE_STREAM_SERVER;
  const envStreamPort = import.meta.env.VITE_STREAM_PORT;
  const envStreamMount = import.meta.env.VITE_STREAM_MOUNT;
  
  // Original Server-URL anzeigen (nicht die Proxy-URL)
  const originalServerUrl = envStreamServer || 'http://localhost:8000';
  const useProxy = import.meta.env.VITE_USE_PROXY === 'true';
  
  if (urlInput) {
    urlInput.value = originalServerUrl;
    // Hinweis anzeigen wenn Proxy verwendet wird
    if (useProxy) {
      urlInput.title = `Using CORS Proxy: ${streamConfig.serverUrl}`;
      urlInput.style.borderColor = '#4CAF50';
    }
  }
  if (typeSelect) typeSelect.value = streamConfig.serverType;
  if (mountInput) mountInput.value = streamConfig.mountPoint;
  if (usernameInput) usernameInput.value = finalUsername || '';
  if (passwordInput) passwordInput.value = finalPassword || '';
  if (bitrateSelect) bitrateSelect.value = streamConfig.bitrate.toString();
  if (formatSelect) formatSelect.value = streamConfig.format;
  
  // Server-Konfiguration verstecken wenn in .env definiert
  if (envStreamServer) {
    const serverGroup = document.querySelector('.config-group:has(#stream-server-url)') as HTMLElement;
    if (serverGroup) serverGroup.style.display = 'none';
  }
  
  if (envStreamServer) {
    const typeGroup = document.querySelector('.config-group:has(#stream-server-type)') as HTMLElement;
    if (typeGroup) typeGroup.style.display = 'none';
  }
  
  if (envStreamMount) {
    const mountGroup = document.querySelector('.config-group:has(#mount-point)') as HTMLElement;
    if (mountGroup) mountGroup.style.display = 'none';
  }
  
  // Felder verstecken wenn bereits gef�llt
  if (finalUsername) {
    const usernameGroup = document.querySelector('.config-group:has(#stream-username)') as HTMLElement;
    if (usernameGroup) usernameGroup.style.display = 'none';
  }
  
  if (finalPassword) {
    const passwordGroup = document.querySelector('.config-group:has(#stream-password)') as HTMLElement;
    if (passwordGroup) passwordGroup.style.display = 'none';
  }
  
  // Unified Login Info in Header anzeigen
  if (useUnifiedLogin && unifiedUsername) {
    const configTitle = document.querySelector('#stream-config-panel h3');
    if (configTitle) {
      configTitle.textContent = `Streaming Config (Unified: ${unifiedUsername})`;
      (configTitle as HTMLElement).style.color = '#4CAF50';
    }
  }
  
  // Mount Point Feld je nach Server-Typ anzeigen/verstecken
  updateMountPointVisibility();
  
  // Proxy-Status-Indikator aktualisieren
  updateProxyStatusIndicator();
}

// Proxy-Status-Indikator aktualisieren
function updateProxyStatusIndicator() {
  const proxyStatus = document.getElementById('proxy-status');
  const useProxy = import.meta.env.VITE_USE_PROXY === 'true';
  const useBridge = import.meta.env.VITE_USE_BRIDGE === 'true';
  
  if (proxyStatus) {
    if (useBridge) {
      proxyStatus.style.display = 'flex';
      proxyStatus.innerHTML = `
        <span class="material-icons" style="color: #2196F3; font-size: 16px;">stream</span>
        <span style="color: #2196F3; font-size: 12px; font-weight: 500;">WebRTC?Shoutcast Bridge Active (${import.meta.env.VITE_WEBRTC_BRIDGE || 'ws://localhost:3003'})</span>
      `;
    } else if (useProxy) {
      proxyStatus.style.display = 'flex';
      proxyStatus.innerHTML = `
        <span class="material-icons" style="color: #4CAF50; font-size: 16px;">security</span>
        <span style="color: #4CAF50; font-size: 12px; font-weight: 500;">CORS Proxy Active (${import.meta.env.VITE_PROXY_SERVER || 'http://localhost:3001'})</span>
      `;
    } else {
      proxyStatus.style.display = 'flex';
      proxyStatus.innerHTML = `
        <span class="material-icons" style="color: #ff9800; font-size: 16px;">warning</span>
        <span style="color: #ff9800; font-size: 12px; font-weight: 500;">Direct Connection (may be blocked by CORS)</span>
      `;
    }
  }
}

// Stream-Konfiguration speichern
function saveStreamConfig() {
  const urlInput = document.getElementById('stream-server-url') as HTMLInputElement;
  const typeSelect = document.getElementById('stream-server-type') as HTMLSelectElement;
  const mountInput = document.getElementById('mount-point') as HTMLInputElement;
  const usernameInput = document.getElementById('stream-username') as HTMLInputElement;
  const passwordInput = document.getElementById('stream-password') as HTMLInputElement;
  const bitrateSelect = document.getElementById('stream-bitrate') as HTMLSelectElement;
  const formatSelect = document.getElementById('stream-format') as HTMLSelectElement;
  
  // Neue Konfiguration sammeln
  const newConfig: StreamConfig = {
    serverUrl: getStreamServerUrl(), // Berechnet automatisch Proxy vs. direkte URL
    serverType: (typeSelect?.value as 'icecast' | 'shoutcast') || streamConfig.serverType,
    mountPoint: mountInput?.value || streamConfig.mountPoint,
    username: usernameInput?.value || streamConfig.username,
    password: passwordInput?.value || streamConfig.password,
    bitrate: parseInt(bitrateSelect?.value) || streamConfig.bitrate,
    format: (formatSelect?.value as 'mp3' | 'aac') || streamConfig.format,
    sampleRate: streamConfig.sampleRate // Beibehalten
  };
  
  // Validierung der urspr�nglichen Server-URL (nicht Proxy)
  const originalUrl = urlInput?.value || streamConfig.serverUrl;
  if (!originalUrl || !newConfig.password) {
    alert('Please fill in server URL and password');
    return;
  }
  
  if (newConfig.serverType === 'icecast' && !newConfig.mountPoint) {
    alert('Mount point is required for Icecast');
    return;
  }
  
  // Konfiguration aktualisieren
  streamConfig = newConfig;
  
  // In localStorage speichern
  try {
    localStorage.setItem('streamConfig', JSON.stringify(streamConfig));
    console.log('Stream configuration saved:', streamConfig);
    
    // Kurze Best�tigung anzeigen
    const saveBtn = document.getElementById('save-stream-config');
    if (saveBtn) {
      const originalText = saveBtn.textContent;
      saveBtn.textContent = 'Saved!';
      setTimeout(() => {
        saveBtn.textContent = originalText;
      }, 1500);
    }
  } catch (e) {
    console.error('Failed to save stream config:', e);
    alert('Failed to save configuration');
  }
}

// Mount Point Sichtbarkeit je nach Server-Typ
function updateMountPointVisibility() {
  const typeSelect = document.getElementById('stream-server-type') as HTMLSelectElement;
  const mountGroup = document.querySelector('.mount-point-group') as HTMLElement;
  
  if (typeSelect && mountGroup) {
    if (typeSelect.value === 'shoutcast') {
      mountGroup.style.display = 'none';
    } else {
      mountGroup.style.display = 'block';
    }
  }
}

  // Auto-Queue Toggle Funktionalit�t f�r alle Buttons
  const autoQueueButtons = document.querySelectorAll(".auto-queue-btn") as NodeListOf<HTMLButtonElement>;
  
  autoQueueButtons.forEach(autoQueueBtn => {
    autoQueueBtn?.addEventListener("click", () => {
      autoQueueEnabled = !autoQueueEnabled;
      
      // Alle Auto-Queue Buttons synchron aktualisieren
      autoQueueButtons.forEach(btn => {
        if (autoQueueEnabled) {
          btn.textContent = "?? AUTO-QUEUE";
          btn.classList.remove("inactive");
        } else {
          btn.textContent = "? AUTO-QUEUE";
          btn.classList.add("inactive");
        }
      });
      
      console.log(autoQueueEnabled ? "Auto-Queue aktiviert" : "Auto-Queue deaktiviert");
    });
  });
  
  // Tab Navigation
  initializeTabs();
  
  // Search Funktionalit�t
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
  console.log("📚 initializeMusicLibrary started");
  
  try {
    // Lade initial Songs
    console.log("🎵 Loading songs...");
    await loadSongs();
    
    // Lade Albums
    console.log("💿 Loading albums...");
    await loadAlbums();
    
    // Lade Artists
    console.log("👨‍🎤 Loading artists...");
    await loadArtists();
    
    // Initialize and show the unified library browser after login
    console.log("🌐 Calling enableLibraryAfterLogin...");
    enableLibraryAfterLogin();
    console.log("✅ Library browser initialized after login");
    
  } catch (error) {
    console.error("❌ Error loading music library:", error);
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

// Search Funktionalit�t initialisieren
function initializeSearch() {
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  const searchBtn = document.getElementById('search-btn') as HTMLButtonElement;
  
  const performSearch = async () => {
    if (!openSubsonicClient) {
      showError('Not connected to OpenSubsonic');
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
      const results = await openSubsonicClient.search(query);
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
  
  // Bei Eingabe-�nderungen auch pr�fen
  searchInput?.addEventListener('input', () => {
    // Wenn Feld geleert wird, zeige No Search State
    if (!searchInput.value.trim()) {
      showNoSearchState();
    }
  });
}

// Songs laden
async function loadSongs() {
  if (!openSubsonicClient) return;
  
  console.log('Loading songs...');
  const songsContainer = document.getElementById('songs-list');
  if (!songsContainer) return;
  
  try {
    currentSongs = await openSubsonicClient.getSongs(100);
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
    // Use unified song container instead of HTML string
    const songsContainer = createUnifiedSongsContainer(currentSongs, 'album');
    const albumDetailsContainer = document.getElementById('album-details');
    if (albumDetailsContainer) {
      const existingSongsTable = albumDetailsContainer.querySelector('.songs-table, .unified-songs-container');
      if (existingSongsTable) {
        existingSongsTable.replaceWith(songsContainer);
      } else {
        albumDetailsContainer.appendChild(songsContainer);
      }
    }
    
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
  if (!openSubsonicClient) return;
  
  console.log('Loading albums...');
  const albumsContainer = document.getElementById('albums-grid');
  if (!albumsContainer) return;
  
  try {
    currentAlbums = await openSubsonicClient.getAlbums(50);
    console.log(`Loaded ${currentAlbums.length} albums`);
    
    albumsContainer.innerHTML = currentAlbums.map(album => createAlbumHTML(album)).join('');
    
    // Hinzuf�gen der Click Listener f�r Albums
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
  if (!openSubsonicClient) return;
  
  console.log('Loading artists...');
  const artistsContainer = document.getElementById('artists-list');
  if (!artistsContainer) return;
  
  try {
    currentArtists = await openSubsonicClient.getArtists();
    console.log(`Loaded ${currentArtists.length} artists`);
    
    artistsContainer.innerHTML = currentArtists.map(artist => createArtistHTML(artist)).join('');
    
    // Hinzuf�gen der Click Listener f�r Artists
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
// Song HTML als Einzeiler f�r einheitliche Darstellung erstellen

// Hilfsfunktion zum Erstellen von Artist-Links aus dem artists Array
function createArtistLinks(song: OpenSubsonicSong): string {
  // Verwende artists Array falls verf�gbar, sonst Fallback auf artist string
  if (song.artists && song.artists.length > 0) {
    if (song.artists.length === 1) {
      const artist = song.artists[0];
      return `<span class="clickable-artist" draggable="false" data-artist-id="${artist.id}" data-artist-name="${escapeHtml(artist.name)}" title="View artist details">${escapeHtml(artist.name)}</span>`;
    } else {
      // Multiple Artists - jeder einzeln klickbar
      const artistLinks = song.artists.map(artist => 
        `<span class="clickable-artist" draggable="false" data-artist-id="${artist.id}" data-artist-name="${escapeHtml(artist.name)}" title="View artist details">${escapeHtml(artist.name)}</span>`
      ).join('<span class="artist-separator"> � </span>');
      
      return `<span class="multi-artist">${artistLinks}</span>`;
    }
  } else {
    // Fallback f�r alte API oder wenn artists Array nicht verf�gbar
    return `<span class="clickable-artist" draggable="false" data-artist-name="${escapeHtml(song.artist)}" title="View artist details">${escapeHtml(song.artist)}</span>`;
  }
}
// Einheitliche Song-Darstellung für alle Bereiche (Search, Album-Details, Queue)
function createUnifiedSongElement(song: OpenSubsonicSong, context: 'search' | 'album' | 'queue' = 'search'): HTMLElement {
  const trackItem = document.createElement('div');
  trackItem.className = 'spotify-card spotify-song-row';
  trackItem.dataset.songId = song.id;
  trackItem.dataset.coverArt = song.coverArt || '';
  trackItem.dataset.type = 'song';
  
  const duration = formatDuration(song.duration);
  const coverUrl = song.coverArt && openSubsonicClient ? openSubsonicClient.getCoverArtUrl(song.coverArt, 40) : '';
  
  // Spotify-style row layout für Song-Listen
  trackItem.innerHTML = `
    <div class="spotify-track-cover">
      ${coverUrl ? `<img src="${coverUrl}" alt="Cover" />` : '<div class="spotify-no-cover"><span class="material-icons">music_note</span></div>'}
    </div>
    <div class="spotify-track-title">${escapeHtml(song.title)}</div>
    <div class="spotify-track-artist">${createArtistLinks(song)}</div>
    <div class="spotify-track-album clickable-album" draggable="false" data-album-id="${song.albumId || ''}" data-album-name="${escapeHtml(song.album)}" title="View album details">${escapeHtml(song.album)}</div>
    <div class="spotify-track-rating" data-song-id="${song.id}">
      ${generateStarRating(getStoredTrackRating(song.id))}
    </div>
    <div class="spotify-track-duration">${duration}</div>
  `;
  
  // Drag and Drop aktivieren
  trackItem.draggable = true;
  trackItem.addEventListener('dragstart', (e) => {
    if (e.dataTransfer) {
      e.dataTransfer.setData('application/json', JSON.stringify({
        type: 'song',
        song: song,
        sourceUrl: openSubsonicClient?.getStreamUrl(song.id)
      }));
      e.dataTransfer.effectAllowed = 'copy';
    }
  });
  
  return trackItem;
}

// Container function for song lists
function createUnifiedSongsContainer(songs: OpenSubsonicSong[], context: 'search' | 'album' | 'queue' = 'album'): HTMLElement {
  const container = document.createElement('div');
  container.className = 'spotify-songs-container';
  
  songs.forEach(song => {
    const songElement = createUnifiedSongElement(song, context);
    container.appendChild(songElement);
  });
  
  return container;
}

function createSongHTMLOneline(song: OpenSubsonicSong): string {
  const duration = formatDuration(song.duration);
  const coverUrl = song.coverArt && openSubsonicClient ? openSubsonicClient.getCoverArtUrl(song.coverArt, 60) : '';
  
  return `
    <div class="spotify-card spotify-song-row" draggable="true" data-song-id="${song.id}" data-cover-art="${song.coverArt || ''}" data-type="song">
      <div class="spotify-track-cover">
        ${coverUrl ? `<img src="${coverUrl}" alt="Cover" />` : '<div class="spotify-no-cover"><span class="material-icons">music_note</span></div>'}
      </div>
      <div class="spotify-track-title">${escapeHtml(song.title)}</div>
      <div class="spotify-track-artist">${createArtistLinks(song)}</div>
      <div class="spotify-track-album clickable-album" draggable="false" data-album-id="${song.albumId || ''}" data-album-name="${escapeHtml(song.album)}" title="View album details">${escapeHtml(song.album)}</div>
      <div class="spotify-track-rating" data-song-id="${song.id}">
        ${createStarRating(song.userRating || 0, song.id)}
      </div>
      <div class="spotify-track-duration">${duration}</div>
    </div>
  `;
}

// 5-Sterne Rating System erstellen
function createStarRating(currentRating: number, songId: string): string {
  let starsHTML = '';
  for (let i = 1; i <= 5; i++) {
    const filled = i <= currentRating ? 'filled' : '';
    starsHTML += `<span class="star ${filled}" data-rating="${i}" data-song-id="${songId}">?</span>`;
  }
  return starsHTML;
}

// Rating setzen
async function setRating(songId: string, rating: number) {
  if (!openSubsonicClient) return;
  
  const success = await openSubsonicClient.setRating(songId, rating);
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
function createAlbumHTML(album: OpenSubsonicAlbum): string {
  const coverUrl = album.coverArt && openSubsonicClient ? openSubsonicClient.getCoverArtUrl(album.coverArt, 300) : '';
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
function createArtistHTML(artist: OpenSubsonicArtist): string {
  return `
    <div class="artist-item" data-artist-id="${artist.id}" data-artist-name="${escapeHtml(artist.name)}">
      <div class="artist-name">${escapeHtml(artist.name)}</div>
      <div class="artist-info">${artist.albumCount} albums</div>
    </div>
  `;
}

// Search Results anzeigen mit MediaContainer
function displaySearchResults(results: any, addToHistory: boolean = true) {
  // FIRST: Switch to search tab to make elements accessible
  const searchTabBtn = document.querySelector('.tab-btn[data-tab="search"]') as HTMLElement;
  const browseTabBtn = document.querySelector('.tab-btn[data-tab="browse"]') as HTMLElement;
  const searchContent = document.getElementById('search-content');
  const browseContent = document.getElementById('browse-content');
  
  if (searchTabBtn && browseTabBtn && searchContent && browseContent) {
    // Switch to search tab
    browseTabBtn.classList.remove('active');
    searchTabBtn.classList.add('active');
    browseContent.classList.remove('active');
    searchContent.classList.add('active');
  }

  if (!searchContent) {
    console.error('Search content container not found');
    return;
  }

  // Speichere die aktuellen Suchergebnisse
  lastSearchResults = results;
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  if (searchInput) {
    lastSearchQuery = searchInput.value.trim();
  }
  
  // Clear previous content and use searchContent directly as universal container
  searchContent.innerHTML = '';
  
  let hasResults = false;
  
  // Artists mit MediaContainer
  if (results.artist && results.artist.length > 0) {
    hasResults = true;
    const artistsContainer = document.createElement('div');
    artistsContainer.innerHTML = '<h4>Artists</h4><div id="search-artists"></div>';
    searchContent.appendChild(artistsContainer);
    
    const artistItems: MediaItem[] = results.artist.map((artist: OpenSubsonicArtist) => ({
      id: artist.id,
      name: artist.name,
      type: 'artist' as const,
      coverArt: artist.coverArt,
      artistImageUrl: artist.artistImageUrl,
      albumCount: artist.albumCount
    }));

    const artistContainer = new MediaContainer({
      containerId: 'search-artists',
      items: artistItems,
      displayMode: 'grid',
      itemType: 'artist',
      showInfo: false,
      onItemClick: (item) => {
        const artist = results.artist.find((a: OpenSubsonicArtist) => a.id === item.id);
        if (artist) loadArtistAlbums(artist);
      }
    });

    artistContainer.render();
  }
  
  // Albums mit MediaContainer
  if (results.album && results.album.length > 0) {
    hasResults = true;
    const albumsContainer = document.createElement('div');
    albumsContainer.innerHTML = '<h4>Albums</h4><div id="search-albums"></div>';
    searchContent.appendChild(albumsContainer);
    
    const albumItems: MediaItem[] = results.album.map((album: OpenSubsonicAlbum) => ({
      id: album.id,
      name: album.name,
      type: 'album' as const,
      coverArt: album.coverArt,
      artist: album.artist,
      year: album.year
    }));

    const albumContainer = new MediaContainer({
      containerId: 'search-albums',
      items: albumItems,
      displayMode: 'grid',
      itemType: 'album',
      showInfo: false,
      onItemClick: (item) => {
        const album = results.album.find((a: OpenSubsonicAlbum) => a.id === item.id);
        if (album) loadAlbumTracks(album);
      }
    });

    albumContainer.render();
  }
  
  // Songs mit MediaContainer
  if (results.song && results.song.length > 0) {
    hasResults = true;
    const songsContainer = document.createElement('div');
    songsContainer.innerHTML = '<h4>Songs</h4><div id="search-songs"></div>';
    searchContent.appendChild(songsContainer);
    
    const songItems: MediaItem[] = results.song.map((song: OpenSubsonicSong) => ({
      id: song.id,
      name: song.title,
      type: 'song' as const,
      coverArt: song.coverArt,
      artist: song.artist,
      album: song.album,
      duration: song.duration
    }));

    const songContainer = new MediaContainer({
      containerId: 'search-songs',
      items: songItems,
      displayMode: 'list',
      itemType: 'song',
      showInfo: false,
      onItemClick: (item) => {
        const song = results.song.find((s: OpenSubsonicSong) => s.id === item.id);
        if (song) {
          console.log('Playing song:', song.title);
          // TODO: Add to player or start playing
        }
      }
    });

    songContainer.render();
  }
  
  if (!hasResults) {
    searchContent.innerHTML = '<div class="no-results">No results found</div>';
  }
  
  console.log('Search results displayed with MediaContainer');
}

// Zur�ck zu den letzten Suchergebnissen
function returnToLastSearchResults() {
  if (lastSearchResults) {
    console.log('Returning to last search results:', lastSearchQuery);
    
    // Setze das Suchfeld auf die letzte Suchanfrage
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    if (searchInput && lastSearchQuery) {
      searchInput.value = lastSearchQuery;
    }
    
    // Zeige die gespeicherten Suchergebnisse wieder an
    displaySearchResults(lastSearchResults);
  } else {
    console.log('No previous search results found, showing no search state');
    showNoSearchState();
    
    // Zeige kurz eine Hinweismeldung
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    if (searchInput) {
      const originalPlaceholder = searchInput.placeholder;
      searchInput.placeholder = 'No previous search to return to...';
      setTimeout(() => {
        searchInput.placeholder = originalPlaceholder;
      }, 2000);
    }
  }
}

// Drag & Drop Listeners hinzuf�gen
function addDragListeners(container: Element) {
  const trackItems = container.querySelectorAll('.track-item, .track-item-oneline, .spotify-song-row, .unified-song-item');
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

// Song-interne Click Listeners hinzuf�gen (f�r Artist und Album in Songs)
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
        // Use the new LibraryBrowser system
        const artist: OpenSubsonicArtist = {
          id: artistId,
          name: artistName || 'Unknown Artist',
          albumCount: 0
        };
        if (libraryBrowser) {
          libraryBrowser.showArtist(artist);
        } else {
          console.error('LibraryBrowser not available');
        }
      } else if (artistName && openSubsonicClient) {
        // Fallback: Suche nach Artist by Name
        console.log(`No artist ID found, searching by name: ${artistName}`);
        try {
          const searchResults = await openSubsonicClient.search(artistName);
          if (searchResults.artist && searchResults.artist.length > 0) {
            // Finde exakten Match oder ersten Treffer
            const artist = searchResults.artist.find((a: any) => 
              a.name.toLowerCase().trim() === artistName.toLowerCase().trim()
            ) || searchResults.artist[0];
            
            if (artist) {
              console.log(`Found artist through search: ${artist.name} (ID: ${artist.id})`);
              if (libraryBrowser) {
                libraryBrowser.showArtist(artist);
              } else {
                console.error('LibraryBrowser not available');
              }
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
        console.error('No artist ID or name found, or OpenSubsonicClient not available');
      }
    });
    
    // Debug-Event f�r Mousedown
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
      } else if (albumName && openSubsonicClient) {
        console.log(`Album clicked from song (no ID): ${albumName}, searching...`);
        
        try {
          // Suche nach Album by Name
          const searchResults = await openSubsonicClient.search(albumName);
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
    
    // Debug-Event f�r Mousedown
    element.addEventListener('mousedown', () => {
      console.log(`Album mousedown: ${albumName}`);
    });
  });
}

// Album Click Listeners hinzuf�gen
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
    
    // Zus�tzlicher Debug-Event
    clonedItem.addEventListener('mousedown', () => {
      console.log(`Album mousedown: ${albumId}`);
    });
  });
}

// Artist Click Listeners hinzuf�gen
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
    
    // Zus�tzlicher Debug-Event
    clonedItem.addEventListener('mousedown', () => {
      console.log(`Artist mousedown: ${artistId}`);
    });
  });
}

// Album Songs anzeigen
async function showAlbumSongs(albumId: string, addToHistory: boolean = true) {
  if (!openSubsonicClient) return;
  
  try {
    console.log(`Loading songs for album ${albumId}`);
    
    // Versuche Album in currentAlbums zu finden
    let album = currentAlbums.find(a => a.id === albumId);
    
    // Falls nicht gefunden, lade Album-Info direkt von OpenSubsonic
    if (!album) {
      console.log('Album not in currentAlbums, fetching from OpenSubsonic...');
      try {
        const fetchedAlbum = await openSubsonicClient.getAlbumInfo(albumId);
        if (fetchedAlbum) {
          album = fetchedAlbum;
        }
      } catch (error) {
        console.error('Error fetching album info:', error);
      }
    }
    
    const albumSongs = await openSubsonicClient.getAlbumSongs(albumId);
    
    showAlbumSongsFromState({ albumId, album, songs: albumSongs });
    
  } catch (error) {
    console.error('Error loading album songs:', error);
    showError('Failed to load album songs');
  }
}

// Show album songs from state (without adding to history)
function showAlbumSongsFromState(data: { albumId: string, album: any, songs: OpenSubsonicSong[] }) {
  const { album, songs } = data;
    
    // Pr�fe ob wir in Search-View sind oder in der normalen Songs-Liste
    const searchContent = document.getElementById('search-content');
    const songsContainer = document.getElementById('songs-list');
    const targetContainer = searchContent?.style.display !== 'none' ? searchContent : songsContainer;
    
    if (targetContainer) {
      const albumName = album ? album.name : 'Unknown Album';
      const albumArtist = album ? album.artist : 'Unknown Artist';
      
      let html = `
        <div class="album-header">
          <h3>Album: ${escapeHtml(albumName)} - ${escapeHtml(albumArtist)}</h3>
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
      // Use unified song container for artist songs
      const songsContainer = createUnifiedSongsContainer(songs, 'album');
      const artistDetailsContainer = document.getElementById('artist-details');
      if (artistDetailsContainer) {
        const existingSongsTable = artistDetailsContainer.querySelector('.songs-table, .unified-songs-container');
        if (existingSongsTable) {
          existingSongsTable.replaceWith(songsContainer);
        } else {
          artistDetailsContainer.appendChild(songsContainer);
        }
      }
      
      targetContainer.innerHTML = html;
      addDragListeners(targetContainer);
      addSongClickListeners(targetContainer);
    }
}

// Artist Details anzeigen
async function showArtistDetails(artistId: string, artistName?: string, addToHistory: boolean = true) {
  if (!openSubsonicClient) {
    console.error('OpenSubsonic client not available');
    return;
  }
  
  try {
    console.log(`Loading artist details for ${artistId}`);
    const artistData = await openSubsonicClient.getArtistAlbums(artistId);
    
    // Add to browser history
    
    showArtistDetailsFromState({ artistId, artistName, artistData });
    
  } catch (error) {
    console.error('Error loading artist details:', error);
    showError('Failed to load artist details');
  }
}

// Show artist details from state (without adding to history)
function showArtistDetailsFromState(data: { artistId: string, artistName?: string, artistData: any }) {
  console.log('Showing artist details from state:', data);
  // For now, just go back to search - full artist view can be implemented later
  if (lastSearchResults) {
    displaySearchResults(lastSearchResults);
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
  // Hier k�nnte eine Benutzeroberfl�che f�r Fehler implementiert werden
}

// Status-Nachrichten anzeigen (f�r Bridge-Feedback)
function showStatusMessage(message: string, type: 'success' | 'error' | 'info' = 'info') {
  console.log(`[${type.toUpperCase()}]`, message);
  
  // Tempor�res Status-Element erstellen falls noch nicht vorhanden
  let statusElement = document.getElementById('bridge-status-message');
  if (!statusElement) {
    statusElement = document.createElement('div');
    statusElement.id = 'bridge-status-message';
    statusElement.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 8px;
      color: white;
      font-weight: bold;
      z-index: 10000;
      max-width: 400px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transition: all 0.3s ease;
    `;
    document.body.appendChild(statusElement);
  }
  
  // Style basierend auf Type
  statusElement.style.backgroundColor = 
    type === 'success' ? '#10b981' :
    type === 'error' ? '#ef4444' :
    '#3b82f6';
  
  statusElement.textContent = message;
  statusElement.style.display = 'block';
  statusElement.style.opacity = '1';
  
  // Nach 5 Sekunden ausblenden
  setTimeout(() => {
    if (statusElement) {
      statusElement.style.opacity = '0';
      setTimeout(() => {
        statusElement.style.display = 'none';
      }, 300);
    }
  }, 5000);
}

function showSearchLoading() {
  const searchContent = document.getElementById('search-content');
  
  if (searchContent) {
    searchContent.innerHTML = '<div class="loading">Searching...</div>';
  }
}

// No Search State anzeigen (leere Suchergebnisse)
function showNoSearchState() {
  const searchContent = document.getElementById('search-content');
  
  if (searchContent) {
    searchContent.innerHTML = '<div class="search-prompt"><span class="material-icons">search</span><h3>Search for music</h3><p>Enter a song, album or artist name to find music</p></div>';
  }
  
  // Lösche Suchhistorie, wenn zurück zum No Search State
  lastSearchResults = null;
  lastSearchQuery = '';
  console.log('Search history cleared');
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
    
    // Event Listener hinzuf�gen
    queueContainer.addEventListener('dragover', dragoverHandler);
    queueContainer.addEventListener('dragleave', dragleaveHandler);
    queueContainer.addEventListener('drop', dropHandler);
  });
}

// Song zur Queue hinzuf�gen
async function addToQueue(songId: string) {
  console.log('Adding song to queue:', songId);
  
  // Finde Song in aktuellen Listen
  let song = currentSongs.find(s => s.id === songId);
  
  if (!song) {
    // Wenn nicht gefunden, versuche �ber Search Results zu finden
    const searchResults = document.querySelectorAll('.track-item, .spotify-song-row, .unified-song-item');
    for (const item of searchResults) {
      const element = item as HTMLElement;
      if (element.dataset.songId === songId) {
        // Hier m�sste der Song aus der API abgerufen werden
        // F�r jetzt nehmen wir den ersten verf�gbaren Song
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
        <button class="queue-remove" onclick="removeFromQueue(${index})">�</button>
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

// Globale Funktion f�r HTML onclick
(window as any).removeFromQueue = removeFromQueue;

// OpenSubsonic Login initialisieren
function initializeOpenSubsonicLogin() {
  const loginBtn = document.getElementById('OpenSubsonic-login-btn') as HTMLButtonElement;
  const usernameInput = document.getElementById('OpenSubsonic-username') as HTMLInputElement;
  const passwordInput = document.getElementById('OpenSubsonic-password') as HTMLInputElement;
  const serverInput = document.getElementById('OpenSubsonic-server') as HTMLInputElement;
  const loginForm = document.getElementById('OpenSubsonic-login') as HTMLElement;
  const djControls = document.getElementById('dj-controls') as HTMLElement;
  // Note: searchContainer no longer exists - removed with tab system
  
  // Umgebungsvariablen aus Vite abrufen
  const envUrl = import.meta.env.VITE_OpenSubsonic_URL;
  const envUsername = import.meta.env.VITE_OpenSubsonic_USERNAME;
  const envPassword = import.meta.env.VITE_OpenSubsonic_PASSWORD;
  
  // Unified Login Konfiguration
  const useUnifiedLogin = import.meta.env.VITE_USE_UNIFIED_LOGIN === 'true';
  const unifiedUsername = import.meta.env.VITE_UNIFIED_USERNAME;
  const unifiedPassword = import.meta.env.VITE_UNIFIED_PASSWORD;
  
  // Bestimme finale Credentials (Unified hat Vorrang)
  const finalUsername = useUnifiedLogin ? unifiedUsername : envUsername;
  const finalPassword = useUnifiedLogin ? unifiedPassword : envPassword;
  
  // Interne Login-Funktion definieren
  const performLogin = async (serverUrl: string, username: string, password: string) => {
    if (!username || !password) {
      console.log('? Please enter username and password');
      return;
    }
    
    try {
      console.log('?? Connecting to OpenSubsonic...');
      if (loginBtn) {
        loginBtn.disabled = true;
        loginBtn.textContent = 'Connecting...';
      }
      
      // Erstelle OpenSubsonic Client mit Credentials
      openSubsonicClient = new SubsonicApiClient({
        serverUrl: serverUrl,
        username: username,
        password: password
      });
      
      const authenticated = await openSubsonicClient.authenticate();
      
      if (authenticated) {
        console.log("? OpenSubsonic connected successfully!");
        
        // Verstecke Login-Form, zeige DJ-Controls
        loginForm.style.display = 'none';
        djControls.style.display = 'flex';
        // Note: searchContainer no longer exists - search is now integrated in LibraryBrowser
        
        // Initialisiere Musikbibliothek
        console.log("🎵 About to call initializeMusicLibrary...");
        await initializeMusicLibrary();
        console.log("🎵 Finished calling initializeMusicLibrary");
        
        console.log("📊 Final state check:");
        console.log("  - libraryBrowser exists:", !!libraryBrowser);
        console.log("  - browse-content element:", !!document.getElementById('browse-content'));
        console.log("  - openSubsonicClient exists:", !!openSubsonicClient);
        
      } else {
        console.log('? Login failed - Wrong username or password');
        if (loginBtn) {
          loginBtn.textContent = 'Login Failed';
          setTimeout(() => {
            loginBtn.textContent = 'Login';
            loginBtn.disabled = false;
          }, 2000);
        }
      }
      
    } catch (error) {
      console.error("? OpenSubsonic connection error:", error);
      if (loginBtn) {
        loginBtn.textContent = 'Connection Error';
        setTimeout(() => {
          loginBtn.textContent = 'Login';
          loginBtn.disabled = false;
        }, 2000);
      }
    }
  };
  
  // Felder verstecken wenn Werte verf�gbar sind (Unified oder Individual)
  if (envUrl) {
    const serverGroup = document.querySelector('.form-group:has(#OpenSubsonic-server)') as HTMLElement;
    if (serverGroup) serverGroup.style.display = 'none';
  }
  
  if (finalUsername) {
    const usernameGroup = document.querySelector('.form-group:has(#OpenSubsonic-username)') as HTMLElement;
    if (usernameGroup) usernameGroup.style.display = 'none';
  }
  
  if (finalPassword) {
    const passwordGroup = document.querySelector('.form-group:has(#OpenSubsonic-password)') as HTMLElement;
    if (passwordGroup) passwordGroup.style.display = 'none';
  }
  
  // Unified Login Info anzeigen
  if (useUnifiedLogin && unifiedUsername) {
    const loginTitle = loginForm.querySelector('h3');
    if (loginTitle) {
      loginTitle.textContent = `Login (Unified: ${unifiedUsername})`;
      loginTitle.style.color = '#4CAF50';
    }
  }
  
  // Auto-Login wenn alle Credentials verf�gbar sind
  if (envUrl && finalUsername && finalPassword) {
    console.log(`?? Auto-login with ${useUnifiedLogin ? 'unified' : 'individual'} credentials...`);
    performLogin(envUrl, finalUsername, finalPassword);
    return;
  }
  
  const performLoginFromForm = async () => {
    const username = usernameInput.value.trim() || finalUsername;
    const password = passwordInput.value.trim() || finalPassword;
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
  
  // Crossfader Funktionalit�t
  initializeCrossfader();
  
  // Drop Zones f�r Player
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
    console.log(`?? Player ${side.toUpperCase()} started playing`);
    if (playerDeck) {
      playerDeck.classList.add('playing');
    }
    
    // PLAYER STATE: Track is now playing
    const song = getCurrentLoadedSong(side);
    if (song) {
      setPlayerState(side, song, true);
    }
  });
  
  audio.addEventListener('pause', () => {
    console.log(`?? Player ${side.toUpperCase()} paused`);
    if (playerDeck) {
      playerDeck.classList.remove('playing');
    }
    
    // PLAYER STATE: Track is paused
    const song = getCurrentLoadedSong(side);
    if (song) {
      setPlayerState(side, song, false);
    }
  });
  
  audio.addEventListener('ended', () => {
    console.log(`?? Player ${side} finished playing`);
    
    // PLAYER STATE: Track finished - clear player
    setPlayerState(side, null, false);
    
    // Clear deck completely when track ends
    clearPlayerDeck(side);
    
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
      console.log(`?? Auto-Queue enabled: Loading next track to Player ${side.toUpperCase()}`);
      const nextTrack = queue.shift();
      if (nextTrack) {
        loadTrackToPlayer(side, nextTrack, true); // Auto-play next track
        updateQueueDisplay();
      }
    } else {
      console.log(`? Auto-Queue disabled or queue empty on Player ${side.toUpperCase()}`);
    }
  });
  
  audio.addEventListener('loadstart', () => {
    console.log(`?? Player ${side} loading...`);
  });
  
  audio.addEventListener('canplay', () => {
    console.log(`? Player ${side} ready to play`);
  });
  
  audio.addEventListener('error', (e) => {
    console.error(`? Player ${side} error:`, e);
    if (playerDeck) {
      playerDeck.classList.remove('playing');
    }
    showError(`Audio error on Player ${side.toUpperCase()}`);
  });
  
  // Control Button Event Listeners
  playPauseBtn?.addEventListener('click', () => {
    const wavesurfer = waveSurfers[side];
    
    // HTML Audio controls playback, WaveSurfer follows for visualization
    if (audio.paused) {
      if (audio.src) {
        audio.play().catch(e => {
          console.error(`? Play error on Player ${side}:`, e);
          showError(`Cannot play on Player ${side.toUpperCase()}: ${e.message}`);
        });
        
        // Sync WaveSurfer visualization if available
        if (wavesurfer) {
          try {
            wavesurfer.play();
          } catch (e) {
            console.warn(`?? WaveSurfer sync error on Player ${side}:`, e);
          }
        }
        
        const icon = playPauseBtn.querySelector('.material-icons');
        if (icon) icon.textContent = 'pause';
        playPauseBtn.classList.add('playing');
      } else {
        console.log(`? No track loaded on Player ${side}`);
        showError(`No track loaded on Player ${side.toUpperCase()}`);
      }
    } else {
      audio.pause();
      
      // Sync WaveSurfer visualization if available
      if (wavesurfer) {
        try {
          wavesurfer.pause();
        } catch (e) {
          console.warn(`?? WaveSurfer sync error on Player ${side}:`, e);
        }
      }
      
      const icon = playPauseBtn.querySelector('.material-icons');
      if (icon) icon.textContent = 'play_arrow';
      playPauseBtn.classList.remove('playing');
    }
  });
  
  ejectBtn?.addEventListener('click', () => {
    console.log(`?? Player ${side.toUpperCase()} eject button pressed`);
    
    // Complete deck clearing including metadata update
    clearPlayerDeck(side);
    
    // Reset UI elements
    if (playPauseBtn) {
      const icon = playPauseBtn.querySelector('.material-icons');
      if (icon) icon.textContent = 'play_arrow';
      playPauseBtn.classList.remove('playing');
    }
    if (playerDeck) {
      playerDeck.classList.remove('playing');
    }
    
    console.log(`?? Player ${side.toUpperCase()} ejected`);
  });

  restartBtn?.addEventListener('click', () => {
    if (audio.src) {
      audio.currentTime = 0;
      console.log(`?? Player ${side.toUpperCase()} restarted`);
    } else {
      console.log(`? No track loaded on Player ${side}`);
      showError(`No track loaded on Player ${side.toUpperCase()}`);
    }
  });
  
  // Volume Control - steuert Web Audio API GainNodes
  volumeSlider?.addEventListener('input', () => {
    const volume = parseInt(volumeSlider.value) / 100;
    
    // Web Audio API Gain steuern (f�r Streaming)
    if (side === 'left' && leftPlayerGain) {
      leftPlayerGain.gain.value = volume;
      console.log(`??? Player ${side} Web Audio gain: ${volume}`);
    } else if (side === 'right' && rightPlayerGain) {
      rightPlayerGain.gain.value = volume;
      console.log(`??? Player ${side} Web Audio gain: ${volume}`);
    }
    
    // HTML Audio Element auch setzen (f�r direkte Abh�rung ohne Web Audio)
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
function loadTrackToPlayer(side: 'left' | 'right', song: OpenSubsonicSong, autoPlay: boolean = false) {
  if (!openSubsonicClient) {
    console.error('OpenSubsonic client not initialized');
    return;
  }
  
  const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
  const titleElement = document.getElementById(`track-title-${side}`);
  const artistElement = document.getElementById(`track-artist-${side}`);
  
  if (!audio) return;
  
  console.log(`Loading "${song.title}" to Player ${side.toUpperCase()}${autoPlay ? ' (auto-play)' : ''}`);
  
  // Stream URL von OpenSubsonic
  const streamUrl = openSubsonicClient.getStreamUrl(song.id);
  
  // Reset WaveSurfer first (bevor neuer Track geladen wird)
  resetWaveform(side);
  
  // Vorherigen Track stoppen und zur�cksetzen
  audio.pause();
  audio.currentTime = 0;
  
  // PLAYER STATE: Track loaded but not playing yet
  setPlayerState(side, song, false);
  
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
  
  // Play-Button zur�cksetzen (Track ist gestoppt)
  const playPauseBtn = document.getElementById(`play-pause-${side}`) as HTMLButtonElement;
  const icon = playPauseBtn?.querySelector('.material-icons');
  if (icon) icon.textContent = 'play_arrow';
  
  // Load new waveform using WaveSurfer (l�dt automatisch neue Waveform)
  loadWaveform(side, audio.src);
  
  // Audio-Event-Listener werden nach allen Funktionsdefinitionen hinzugef�gt
  setupAudioEventListeners(audio, side);
  
  // Note: We don't sync WaveSurfer with audio to avoid double playback
  // WaveSurfer handles playback directly via play button
  
  // Song ID f�r Rating-System speichern
  audio.dataset.songId = song.id;
  
  // Rating anzeigen (async laden)
  const playerRating = document.getElementById(`player-rating-${side}`);
  if (playerRating) {
    playerRating.innerHTML = createStarRating(song.userRating || 0, song.id);
    
    // Rating async nachladen f�r bessere Performance
    loadRatingAsync(song.id);
  }
  
  // Auto-Play wenn gew�nscht
  if (autoPlay) {
    // Warte bis Track geladen ist, dann spiele ab
    audio.addEventListener('loadeddata', () => {
      audio.play().then(() => {
        console.log(`?? Player ${side.toUpperCase()}: "${song.title}" is now playing`);
        
        // PLAYER STATE: Auto-play started
        setPlayerState(side, song, true);
        
        // Update play button state
        const playPauseBtn = document.getElementById(`play-pause-${side}`) as HTMLButtonElement;
        if (playPauseBtn) {
          playPauseBtn.textContent = '??';
          playPauseBtn.classList.add('playing');
        }
        
      }).catch((error: any) => {
        console.error(`? Auto-play failed on Player ${side.toUpperCase()}:`, error);
        showError(`Auto-play failed on Player ${side.toUpperCase()}: ${error.message}`);
      });
    }, { once: true }); // Event listener nur einmal ausf�hren
  }
  
  // Crossfader anwenden falls aktiv
  applyCrossfader();
  
  console.log(`Player ${side.toUpperCase()}: "${song.title}" loaded successfully`);
}

// Crossfader anwenden (f�r neue Tracks)
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
    
    // Konvertiere Crossfader-Position (0-100) zu Audio-Pipeline-Position (0-1)
    const position = value / 100;
    
    // Audio-Pipeline Crossfader setzen falls verf�gbar
    if (crossfaderGain && streamCrossfaderGain) {
      // Position zwischen 0 und 1 begrenzen
      const clampedPosition = Math.max(0, Math.min(1, position));
      
      // Links: maximum bei 0, minimum bei 1
      const leftGain = Math.cos(clampedPosition * Math.PI / 2);
      // Rechts: minimum bei 0, maximum bei 1
      const rightGain = Math.sin(clampedPosition * Math.PI / 2);
      
      // Monitor-Crossfader
      crossfaderGain.left.gain.value = leftGain;
      crossfaderGain.right.gain.value = rightGain;
      
      // Stream-Crossfader (synchron)
      streamCrossfaderGain.left.gain.value = leftGain;
      streamCrossfaderGain.right.gain.value = rightGain;
      
      console.log(`??? Crossfader Web Audio: ${position}, Left: ${leftGain.toFixed(2)}, Right: ${rightGain.toFixed(2)} (Monitor + Stream)`);
    }
    
    // Fallback: Direkte Audio-Element-Kontrolle
    // Crossfader: 0 = nur links, 50 = beide gleich, 100 = nur rechts
    // Korrekte Berechnung f�r flie�enden �bergang
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
      console.log(`?? Dropping song ${songId} on Player ${side.toUpperCase()}`);
      
      // Finde Song in verschiedenen Listen
      let song = findSongById(songId);
      
      if (song) {
        // Lade Track OHNE Auto-Play
        loadTrackToPlayer(side, song, false);
        console.log(`? Track "${song.title}" loaded on Player ${side.toUpperCase()} (ready to play)`);
      } else {
        console.error(`? Song with ID ${songId} not found`);
        showError(`Track not found. Please try searching or reloading the library.`);
      }
    }
  });
}

// Song nach ID in allen verf�gbaren Listen finden
function findSongById(songId: string): OpenSubsonicSong | null {
  // Suche in aktuellen Songs
  let song = currentSongs.find(s => s.id === songId);
  if (song) return song;
  
  // Suche in Search Results (DOM) - sowohl alte als auch neue Track-Items
  const searchResults = document.querySelectorAll('.track-item, .track-item-oneline, .spotify-song-row, .unified-song-item');
  for (const item of searchResults) {
    const element = item as HTMLElement;
    if (element.dataset.songId === songId) {
      
      // F�r neue einzeilige Track-Items
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
      
      // F�r alte Track-Items (Fallback)
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
          coverArt: coverArt // Cover Art auch f�r alte Items
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
        
        // Async Rating laden f�r bessere Performance
        loadRatingAsync(songId);
      }
    }
  });
  
  // Hover-Effekte f�r Sterne
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

// Sterne f�r Hover-Effekt hervorheben
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

// Stern-Highlight zur�cksetzen
function resetStarHighlight(songId: string) {
  const stars = document.querySelectorAll(`[data-song-id="${songId}"] .star`);
  stars.forEach(star => {
    star.classList.remove('hover-preview');
  });
}

// Rating asynchron laden (f�r bessere Performance)
async function loadRatingAsync(songId: string) {
  if (!openSubsonicClient) return;
  
  try {
    const rating = await openSubsonicClient.getRating(songId);
    if (rating !== null) {
      updateRatingDisplay(songId, rating);
    }
  } catch (error) {
    console.warn(`Failed to load rating for song ${songId}:`, error);
  }
}

// Audio Level Monitoring f�r Volume Meter
let volumeMeterIntervals: { [key: string]: NodeJS.Timeout } = {};

function startVolumeMeter(side: 'left' | 'right' | 'mic') {
  // Stoppe vorherige Intervalle
  if (volumeMeterIntervals[side]) {
    clearInterval(volumeMeterIntervals[side]);
  }
  
  const meterId = side === 'mic' ? 'mic-volume-meter' : `volume-meter-${side}`;
  const meterElement = document.getElementById(meterId);
  
  if (!meterElement || !audioContext) return;
  
  // AnalyserNode f�r Audio-Level-Messung erstellen
  let analyser: AnalyserNode;
  let gainNode: GainNode | null = null;
  
  if (side === 'left') {
    gainNode = leftPlayerGain;
  } else if (side === 'right') {
    gainNode = rightPlayerGain;
  } else if (side === 'mic') {
    gainNode = microphoneGain;
  }
  
  if (!gainNode) return;
  
  try {
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    
    // Verbinde Gain Node mit Analyser (ohne Audio-Flow zu st�ren)
    gainNode.connect(analyser);
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // Update Interval
    volumeMeterIntervals[side] = setInterval(() => {
      analyser.getByteFrequencyData(dataArray);
      
      // Berechne RMS (Root Mean Square) f�r bessere Level-Anzeige
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / bufferLength);
      
      // Konvertiere zu dB und normalisiere (0-10 Balken)
      const dbValue = 20 * Math.log10(rms / 255);
      const normalizedLevel = Math.max(0, Math.min(10, Math.floor((dbValue + 60) / 6)));
      
      updateVolumeMeter(meterId, normalizedLevel);
    }, 50); // 20 FPS Update-Rate
    
    console.log(`?? Volume meter started for ${side}`);
  } catch (error) {
    console.error(`Failed to start volume meter for ${side}:`, error);
  }
}

function updateVolumeMeter(meterId: string, level: number) {
  const meterElement = document.getElementById(meterId);
  if (!meterElement) return;
  
  // Support f�r beide Meter-Typen: kompakt und regular
  const bars = meterElement.querySelectorAll('.meter-bar-compact, .meter-bar');
  bars.forEach((bar, index) => {
    if (index < level) {
      bar.classList.add('active');
    } else {
      bar.classList.remove('active');
    }
  });
}

function stopVolumeMeter(side: 'left' | 'right' | 'mic') {
  if (volumeMeterIntervals[side]) {
    clearInterval(volumeMeterIntervals[side]);
    delete volumeMeterIntervals[side];
    console.log(`?? Volume meter stopped for ${side}`);
  }
}

// Audio Event Listeners Setup
function setupAudioEventListeners(audio: HTMLAudioElement, side: 'left' | 'right') {
  // Audio zu Mixing-System hinzuf�gen f�r Live-Streaming
  audio.addEventListener('loadeddata', () => {
    console.log(`?? TRACK LOADED: ${side} player audio element src: ${audio.src}`);
    setTimeout(async () => {
      if (!audioContext) {
        // Audio-Mixing automatisch initialisieren wenn erster Track geladen wird
        console.log("??? Initializing audio mixing...");
        const success = await initializeAudioMixing();
        if (success) {
          console.log(`?? Connecting ${side} player to mixer (first time)`);
          const connected = connectAudioToMixer(audio, side);
          console.log(`?? Connection result for ${side}: ${connected}`);
        } else {
          console.error(`? Failed to initialize audio mixing for ${side}`);
        }
      } else {
        console.log(`?? Connecting ${side} player to mixer (track change)`);
        const connected = connectAudioToMixer(audio, side);
        console.log(`?? Connection result for ${side}: ${connected}`);
      }
    }, 0);
  });
  
  // ZUS�TZLICH: Sicherstellen dass Verbindung bei Play-Event existiert
  audio.addEventListener('play', () => {
    console.log(`?? PLAY EVENT: ${side} player starting playback`);
    // Verbindung nochmals pr�fen/herstellen bei Wiedergabe
    if (audioContext && (leftPlayerGain || rightPlayerGain)) {
      const connected = connectAudioToMixer(audio, side);
      if (connected) {
        console.log(`? ${side} player audio routing verified for stream`);
      } else {
        console.error(`? ${side} player audio routing FAILED`);
      }
    } else {
      console.error(`? ${side} player: audioContext or gain nodes not ready`);
    }
  });
}

// Volume Meter bei Audio-Events starten/stoppen
document.addEventListener('DOMContentLoaded', () => {
  // Player Volume Control Event Listeners
  ['left', 'right'].forEach(side => {
    const volumeSlider = document.getElementById(`volume-${side}`) as HTMLInputElement;
    
    volumeSlider?.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      const volume = parseInt(target.value) / 100;
      
      if (side === 'left' && leftPlayerGain) {
        leftPlayerGain.gain.value = volume;
        console.log(`?? ${side} player volume: ${Math.round(volume * 100)}%`);
      } else if (side === 'right' && rightPlayerGain) {
        rightPlayerGain.gain.value = volume;
        console.log(`?? ${side} player volume: ${Math.round(volume * 100)}%`);
      }
    });
  });
  
  // Auto-start volume meters when audio mixing is initialized
  setTimeout(() => {
    if (audioContext) {
      startVolumeMeter('left');
      startVolumeMeter('right');
      startVolumeMeter('mic');
    }
  }, 1000);
});

// Recent Albums Funktion entfernt - wird nicht mehr ben�tigt

// ======= MEDIA LIBRARY FUNCTIONS =======

// Initialize Media Library with Unified Browser
function initializeMediaLibrary() {
  // Don't initialize the browser yet - only show login hint
  // The browser will be initialized after successful login
  showLoginHintForLibrary();
}

// Zeige Login-Hinweis für Media Library
function showLoginHintForLibrary() {
  console.log("🔒 showLoginHintForLibrary called");
  
  // Show login hint in the browser content
  const browseContent = document.getElementById('browse-content');
  if (browseContent) {
    console.log("📦 Setting login hint in browse-content");
    browseContent.innerHTML = `
      <div class="library-login-hint">
        <div class="login-prompt">
          <span class="material-icons">lock</span>
          <h3>Login Required</h3>
          <p>Please login to your OpenSubsonic server to browse and play music</p>
        </div>
      </div>
    `;
  } else {
    console.error("❌ browse-content not found for login hint");
  }
}

// Aktiviere Media Library nach erfolgreichem Login
function enableLibraryAfterLogin() {
  console.log("🔓 enableLibraryAfterLogin called!");
  console.log("📡 openSubsonicClient available:", !!openSubsonicClient);
  
  const browseContent = document.getElementById('browse-content');
  console.log("📦 browse-content element found:", !!browseContent);
  
  if (!browseContent) {
    console.error("❌ browse-content element not found!");
    return;
  }
  
  // Initialize and show the library browser with content
  try {
    console.log("🚀 Creating new LibraryBrowser...");
    libraryBrowser = new LibraryBrowser();
    console.log("✅ LibraryBrowser created successfully");
  } catch (error) {
    console.error("❌ Error initializing LibraryBrowser:", error);
  }
}

// Load content for Browse tab
async function loadBrowseContent() {
  if (!openSubsonicClient) {
    console.warn('OpenSubsonic client not available for browse content');
    return;
  }

  console.log('Starting to load browse content...');

  try {
    // Load all sections in parallel
    await Promise.all([
      loadRecentAlbums(),
      loadRandomAlbums(),
      loadRandomArtists()
    ]);
    
    console.log('✅ All browse content loaded successfully');
  } catch (error) {
    console.error('Failed to load browse content:', error);
  }
}

// Create album card element
function createAlbumCard(album: OpenSubsonicAlbum): HTMLElement {
  const cardContainer = document.createElement('div');
  cardContainer.className = 'album-card-container';

  const card = document.createElement('div');
  card.className = 'album-card';
  card.dataset.albumId = album.id;

  const coverUrl = album.coverArt 
    ? openSubsonicClient.getCoverArtUrl(album.coverArt, 300)
    : '';

  // Card contains only the cover and play overlay
  card.innerHTML = `
    <div class="album-cover">
      ${coverUrl 
        ? `<img src="${coverUrl}" alt="${album.name}" loading="lazy">`
        : '<span class="material-icons">album</span>'
      }
      <div class="play-overlay">
        <span class="material-icons">play_arrow</span>
      </div>
    </div>
  `;

  // Info goes below the card
  const info = document.createElement('div');
  info.className = 'album-info-external';
  info.innerHTML = `
    <div class="album-title" title="${album.name}">${album.name}</div>
    <div class="album-artist" title="${album.artist}">${album.artist}</div>
    ${album.year ? `<div class="album-year">${album.year}</div>` : ''}
  `;

  cardContainer.appendChild(card);
  cardContainer.appendChild(info);

  // Add click handler to the entire container
  cardContainer.addEventListener('click', () => loadAlbumTracks(album));

  return cardContainer;
}

// Create artist card element
function createArtistCard(artist: OpenSubsonicArtist): HTMLElement {
  const card = document.createElement('div');
  card.className = 'artist-card';
  card.dataset.artistId = artist.id;

  const avatarDiv = document.createElement('div');
  avatarDiv.className = 'artist-avatar';

  // Verwende artistImageUrl falls verfügbar, sonst coverArt, sonst Fallback Icon
  // Always show fallback icon - no image loading
  avatarDiv.innerHTML = '<span class="material-icons">artist</span>';

  const nameDiv = document.createElement('div');
  nameDiv.className = 'artist-name';
  nameDiv.title = artist.name;
  nameDiv.textContent = artist.name;

  card.appendChild(avatarDiv);
  card.appendChild(nameDiv);

  // Add click handler to load artist albums
  card.addEventListener('click', () => loadArtistAlbums(artist));

  return card;
}

// Load tracks from an album and display results
async function loadAlbumTracks(album: OpenSubsonicAlbum) {
  if (!openSubsonicClient) return;

  try {
    console.log(`Loading tracks for album: ${album.name}`);
    
    // Load album tracks
    const tracks = await openSubsonicClient.getAlbumTracks(album.id);
    
    // Show album detail view in browse tab
    showAlbumDetailView(album, tracks);
  } catch (error) {
    console.error('Failed to load album tracks:', error);
  }
}

// Load albums from an artist and display in detail view
async function loadArtistAlbums(artist: OpenSubsonicArtist) {
  if (!openSubsonicClient) return;

  try {
    console.log(`Loading albums for artist: ${artist.name}`);
    
    // Load artist albums
    const albums = await openSubsonicClient.getArtistAlbums(artist.id);
    
    // Show artist detail view in browse tab
    showArtistDetailView(artist, albums);
  } catch (error) {
    console.error('Failed to load artist albums:', error);
  }
}

// Generate star rating HTML
function generateStarRating(rating: number): string {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    const filled = i <= rating ? 'filled' : '';
    stars.push(`<span class="star ${filled}" data-rating="${i}">★</span>`);
  }
  return stars.join('');
}

// Update track rating
function updateTrackRating(trackId: string, rating: number) {
  if (!openSubsonicClient) return;
  
  try {
    // Store rating locally (in future could sync with server)
    const storedRatings = JSON.parse(localStorage.getItem('trackRatings') || '{}');
    storedRatings[trackId] = rating;
    localStorage.setItem('trackRatings', JSON.stringify(storedRatings));
    
    console.log(`Rated track ${trackId}: ${rating} stars`);
    
    // TODO: If OpenSubsonic supports rating API, call it here
    // openSubsonicClient.setRating(trackId, rating);
  } catch (error) {
    console.error('Failed to update track rating:', error);
  }
}

// Get stored track rating
function getStoredTrackRating(trackId: string): number {
  try {
    const storedRatings = JSON.parse(localStorage.getItem('trackRatings') || '{}');
    return storedRatings[trackId] || 0;
  } catch {
    return 0;
  }
}

// Show album detail view
function showAlbumDetailView(album: OpenSubsonicAlbum, tracks: OpenSubsonicSong[]) {
  const browseContent = document.getElementById('browse-content');
  if (!browseContent) return;

  // Hide all sections
  const sections = browseContent.querySelectorAll('.media-section');
  sections.forEach(section => {
    (section as HTMLElement).style.display = 'none';
  });

  // Remove existing detail view
  const existingDetail = browseContent.querySelector('.detail-view');
  if (existingDetail) {
    existingDetail.remove();
  }

  // Create album detail view
  const detailView = document.createElement('div');
  detailView.className = 'detail-view';
  
  const coverUrl = album.coverArt 
    ? openSubsonicClient.getCoverArtUrl(album.coverArt, 300)
    : '';

  detailView.innerHTML = `
    <div class="album-detail">
      <div class="album-info">
        <button class="back-btn" onclick="showBrowseView()">
          <span class="material-icons">arrow_back</span> Back
        </button>
        <div class="album-info-content">
          <div class="album-cover-large">
            ${coverUrl 
              ? `<img src="${coverUrl}" alt="${album.name}">`
              : '<span class="material-icons">album</span>'
            }
          </div>
          <div class="album-meta">
            <h2>${album.name}</h2>
            <h3>${album.artist || 'Unknown Artist'}</h3>
            ${album.year ? `<p>Year: ${album.year}</p>` : ''}
            <p>${tracks.length} tracks</p>
          </div>
        </div>
      </div>
      <div class="track-list">
        <h4>Tracks</h4>
        <div class="tracks">
          ${tracks.map((track, index) => `
            <div class="track-item" data-track-id="${track.id}" draggable="true">
              <span class="track-number">${index + 1}</span>
              <span class="track-title">${track.title}</span>
              <div class="track-rating" data-track-id="${track.id}">
                ${generateStarRating(getStoredTrackRating(track.id))}
              </div>
              <span class="track-duration">${formatDuration(track.duration || 0)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  browseContent.appendChild(detailView);
  
  // Add drag and drop handlers for tracks
  const trackItems = detailView.querySelectorAll('.track-item');
  trackItems.forEach((item, index) => {
    const trackElement = item as HTMLElement;
    const trackId = trackElement.getAttribute('data-track-id');
    const track = tracks.find(t => t.id === trackId);
    
    // Drag handlers
    trackElement.addEventListener('dragstart', (e) => {
      trackElement.classList.add('dragging');
      if (track && e.dataTransfer) {
        e.dataTransfer.setData('application/json', JSON.stringify({
          type: 'track',
          track: track,
          sourceUrl: openSubsonicClient?.getStreamUrl(track.id)
        }));
        e.dataTransfer.effectAllowed = 'copy';
      }
    });
    
    trackElement.addEventListener('dragend', () => {
      trackElement.classList.remove('dragging');
    });
    
    // Click handler for playing
    trackElement.addEventListener('click', (e) => {
      // Ignore clicks on rating stars
      if ((e.target as HTMLElement).classList.contains('star')) return;
      
      if (track) {
        console.log('Playing track:', track.title);
        // TODO: Add to player or start playing
      }
    });
  });
  
  // Add rating handlers
  const ratingContainers = detailView.querySelectorAll('.track-rating');
  ratingContainers.forEach(container => {
    const trackId = container.getAttribute('data-track-id');
    const stars = container.querySelectorAll('.star');
    
    stars.forEach((star, index) => {
      const starElement = star as HTMLElement;
      
      // Hover effects
      starElement.addEventListener('mouseenter', () => {
        stars.forEach((s, i) => {
          s.classList.toggle('hover', i <= index);
        });
      });
      
      starElement.addEventListener('mouseleave', () => {
        stars.forEach(s => s.classList.remove('hover'));
      });
      
      // Click to rate
      starElement.addEventListener('click', (e) => {
        e.stopPropagation();
        const rating = parseInt(starElement.getAttribute('data-rating') || '0');
        updateTrackRating(trackId!, rating);
        
        // Update visual state
        stars.forEach((s, i) => {
          s.classList.toggle('filled', i < rating);
        });
      });
    });
  });
}

// Show artist detail view
function showArtistDetailView(artist: OpenSubsonicArtist, albums: OpenSubsonicAlbum[]) {
  const browseContent = document.getElementById('browse-content');
  if (!browseContent) return;

  // Hide all sections
  const sections = browseContent.querySelectorAll('.media-section');
  sections.forEach(section => {
    (section as HTMLElement).style.display = 'none';
  });

  // Remove existing detail view
  const existingDetail = browseContent.querySelector('.detail-view');
  if (existingDetail) {
    existingDetail.remove();
  }

  // Create artist detail view
  const detailView = document.createElement('div');
  detailView.className = 'detail-view';
  
  let artistImageUrl = '';
  if (artist.artistImageUrl) {
    // Remove existing size parameter and add size=300
    artistImageUrl = artist.artistImageUrl.replace(/[?&]size=\d+/g, '');
    artistImageUrl += (artistImageUrl.includes('?') ? '&' : '?') + 'size=300';
  } else if (artist.coverArt) {
    artistImageUrl = openSubsonicClient.getCoverArtUrl(artist.coverArt, 300);
  }

  detailView.innerHTML = `
    <div class="detail-header">
      <button class="back-btn" onclick="showBrowseView()">
        <span class="material-icons">arrow_back</span> Back to Browse
      </button>
    </div>
    <div class="artist-detail">
      <div class="artist-info">
        <div class="artist-image-large">
          ${artistImageUrl 
            ? `<img src="${artistImageUrl}" alt="${artist.name}">`
            : '<span class="material-icons">person</span>'
          }
        </div>
        <div class="artist-meta">
          <h2>${artist.name}</h2>
          ${artist.albumCount ? `<p>${artist.albumCount} albums</p>` : ''}
        </div>
      </div>
      <div class="album-grid">
        <h4>Albums</h4>
        <div class="albums" id="artist-albums">
          <!-- Albums will be loaded via MediaContainer -->
        </div>
      </div>
    </div>
  `;

  browseContent.appendChild(detailView);
  
  // Load albums using MediaContainer
  const mediaItems: MediaItem[] = albums.map((album: OpenSubsonicAlbum) => ({
    id: album.id,
    name: album.name,
    type: 'album' as const,
    coverArt: album.coverArt,
    artist: album.artist,
    year: album.year
  }));

  const container = new MediaContainer({
    containerId: 'artist-albums',
    items: mediaItems,
    displayMode: 'grid',
    itemType: 'album',
    onItemClick: (item) => {
      const album = albums.find((a: OpenSubsonicAlbum) => a.id === item.id);
      if (album) loadAlbumTracks(album);
    }
  });

  container.render();
}

// Unified Library Browser System
interface BrowseContext {
  type: 'home' | 'artist' | 'album' | 'search';
  data?: any;
  breadcrumbs: BreadcrumbItem[];
}

interface BreadcrumbItem {
  label: string;
  type: 'home' | 'artist' | 'album';
  id?: string;
  action: () => void;
}

class LibraryBrowser {
  private currentContext: BrowseContext = {
    type: 'home',
    breadcrumbs: [{ label: 'Library', type: 'home', action: () => this.showHome() }]
  };

  private container: HTMLElement;

  constructor() {
    console.log("🏗️ LibraryBrowser constructor called");
    this.container = document.getElementById('browse-content')!;
    
    if (!this.container) {
      console.error("❌ browse-content container not found in LibraryBrowser constructor!");
      throw new Error("Container 'browse-content' not found");
    }
    
    console.log("📦 Container found:", this.container);
    console.log("🔧 Initializing browser...");
    this.initializeBrowser();
    console.log("✅ LibraryBrowser initialization complete");
  }

  private initializeBrowser() {
    // Create compact navigation header with tilted breadcrumbs and search
    const header = document.createElement('div');
    header.className = 'library-header';
    header.innerHTML = `
      <div class="compact-nav-container">
        <div class="tilted-breadcrumbs" id="breadcrumbs"></div>
        <div class="tilted-search-container">
          <input type="text" id="search-input" placeholder="Search...">
          <button id="search-btn"><span class="material-icons">search</span></button>
        </div>
      </div>
    `;

    // Create content area
    const content = document.createElement('div');
    content.className = 'library-content';
    content.id = 'library-content';

    this.container.innerHTML = '';
    this.container.appendChild(header);
    this.container.appendChild(content);

    this.updateBreadcrumbs();
    
    // Only show home content if we have an authenticated client
    if (openSubsonicClient) {
      this.showHome();
    } else {
      content.innerHTML = '<div class="loading-placeholder">Initializing library...</div>';
    }

    // Setup search
    this.setupSearch();
  }

  private updateBreadcrumbs() {
    const breadcrumbContainer = document.getElementById('breadcrumbs')!;
    breadcrumbContainer.innerHTML = this.currentContext.breadcrumbs
      .map((item, index) => {
        const isLast = index === this.currentContext.breadcrumbs.length - 1;
        return `<div class="tilted-breadcrumb-item ${isLast ? 'active' : 'clickable'}" 
                      ${!isLast ? `onclick="libraryBrowser.navigateToBreadcrumb(${index})"` : ''}>
                  ${item.label}
                </div>`;
      })
      .join('');
  }

  navigateToBreadcrumb(index: number) {
    const breadcrumb = this.currentContext.breadcrumbs[index];
    breadcrumb.action();
  }

  showHome() {
    this.currentContext = {
      type: 'home',
      breadcrumbs: [{ label: 'Library', type: 'home', action: () => this.showHome() }]
    };
    
    this.updateBreadcrumbs();
    this.loadHomeContent();
  }

  showArtist(artist: OpenSubsonicArtist) {
    this.currentContext = {
      type: 'artist',
      data: artist,
      breadcrumbs: [
        { label: 'Library', type: 'home', action: () => this.showHome() },
        { label: artist.name, type: 'artist', id: artist.id, action: () => this.showArtist(artist) }
      ]
    };
    
    this.updateBreadcrumbs();
    this.loadArtistContent(artist);
  }

  showAlbum(album: OpenSubsonicAlbum) {
    // Create album display name with year if available
    const albumDisplayName = album.year ? `${album.name} (${album.year})` : album.name;
    
    this.currentContext = {
      type: 'album',
      data: album,
      breadcrumbs: [
        { label: 'Library', type: 'home', action: () => this.showHome() },
        { label: album.artist, type: 'artist', action: () => this.showArtist({id: album.artistId, name: album.artist} as OpenSubsonicArtist) },
        { label: albumDisplayName, type: 'album', id: album.id, action: () => this.showAlbum(album) }
      ]
    };
    
    this.updateBreadcrumbs();
    this.loadAlbumContent(album);
  }

  private async loadHomeContent() {
    const content = document.getElementById('library-content')!;
    content.innerHTML = `
      <div class="media-section">
        <h3 class="spotify-section-title">Recent Albums</h3>
        <div class="horizontal-scroll" id="recent-albums">
          <div class="loading-placeholder">Loading recent albums...</div>
        </div>
      </div>

      <div class="media-section">
        <h3 class="spotify-section-title">Random Albums</h3>
        <div class="horizontal-scroll" id="random-albums">
          <div class="loading-placeholder">Loading random albums...</div>
        </div>
      </div>

      <div class="media-section">
        <h3 class="spotify-section-title">Random Artists</h3>
        <div class="horizontal-scroll" id="random-artists">
          <div class="loading-placeholder">Loading random artists...</div>
        </div>
      </div>
    `;

    // Load content
    await this.loadBrowseData();
  }

  private async loadArtistContent(artist: OpenSubsonicArtist) {
    const content = document.getElementById('library-content')!;
    content.innerHTML = `
      <div class="artist-header">
        <div class="artist-info">
          <div class="artist-image-large">
            <span class="material-icons">person</span>
          </div>
          <div class="artist-details">
            <h1 class="artist-name">${escapeHtml(artist.name)}</h1>
            <p class="artist-album-count">${artist.albumCount || 0} Albums</p>
          </div>
        </div>
      </div>

      <div class="media-section">
        <h3 class="spotify-section-title">Albums</h3>
        <div class="horizontal-scroll" id="artist-albums">
          <div class="loading-placeholder">Loading albums...</div>
        </div>
      </div>

      <div class="media-section">
        <h3 class="spotify-section-title">Top Songs</h3>
        <div class="spotify-songs-container" id="artist-songs">
          <div class="loading-placeholder">Loading songs...</div>
        </div>
      </div>
    `;

    // Load artist data
    try {
      const [albums, songs] = await Promise.all([
        openSubsonicClient.getArtistAlbums(artist.id),
        openSubsonicClient.getArtistSongs(artist.id)
      ]);

      // Load albums
      const albumsContainer = document.getElementById('artist-albums')!;
      if (albums.length > 0) {
        const albumsHtml = albums.map(album => `
          <div class="spotify-card spotify-album-card clickable" data-album-id="${album.id}">
            <div class="spotify-album-image">
              <img src="${openSubsonicClient.getCoverArtUrl(album.coverArt || '', 300)}" alt="${escapeHtml(album.name)}" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22180%22 height=%22180%22 fill=%22%23333%22%3E%3Crect width=%22180%22 height=%22180%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%2290%22 y=%2290%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2224%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
              <div class="spotify-play-overlay">
                <span class="material-icons">play_arrow</span>
              </div>
            </div>
            <h4 class="spotify-album-title">${escapeHtml(album.name)}</h4>
            <p class="spotify-album-artist">${album.year || 'Unknown Year'}</p>
          </div>
        `).join('');
        
        albumsContainer.className = 'spotify-horizontal-scroll';
        albumsContainer.innerHTML = albumsHtml;
        
        // Add event listeners for album cards
        albumsContainer.querySelectorAll('[data-album-id]').forEach(card => {
          card.addEventListener('click', () => {
            const albumId = card.getAttribute('data-album-id');
            const album = albums.find(a => a.id === albumId);
            if (album) {
              libraryBrowser.showAlbum(album);
            }
          });
        });
      } else {
        albumsContainer.innerHTML = '<p class="no-items">No albums found</p>';
      }

      // Load songs
      const songsContainer = document.getElementById('artist-songs')!;
      if (songs.length > 0) {
        const songsListContainer = createUnifiedSongsContainer(songs, 'album');
        songsContainer.innerHTML = '';
        songsContainer.className = 'spotify-songs-container';
        songsContainer.appendChild(songsListContainer);
        
        // Add click listeners for artist and album links in songs
        addSongClickListeners(songsContainer);
      } else {
        songsContainer.innerHTML = '<p class="no-items">No songs found</p>';
      }

    } catch (error) {
      console.error('Error loading artist content:', error);
    }
  }

  private async loadAlbumContent(album: OpenSubsonicAlbum) {
    const content = document.getElementById('library-content')!;
    content.innerHTML = `
      <div class="album-header">
        <div class="album-info">
          <div class="album-cover-large">
            <img src="${openSubsonicClient.getCoverArtUrl(album.coverArt || '', 300)}" alt="${album.name}">
          </div>
          <div class="album-details">
            <h1 class="album-name">${escapeHtml(album.name)}</h1>
            <p class="album-artist clickable-artist" data-artist-id="${album.artistId}" data-artist-name="${escapeHtml(album.artist)}">${escapeHtml(album.artist)}</p>
            <p class="album-year">${album.year || 'Unknown Year'}</p>
          </div>
        </div>
      </div>

      <div class="media-section">
        <h3 class="spotify-section-title">Tracks</h3>
        <div class="spotify-songs-container" id="album-songs">
          <div class="loading-placeholder">Loading tracks...</div>
        </div>
      </div>
    `;

    // Load album songs
    try {
      const songs = await openSubsonicClient.getAlbumSongs(album.id);
      
      const songsContainer = document.getElementById('album-songs')!;
      if (songs.length > 0) {
        const songsListContainer = createUnifiedSongsContainer(songs, 'album');
        songsContainer.innerHTML = '';
        songsContainer.className = 'spotify-songs-container';
        songsContainer.appendChild(songsListContainer);
        
        // Add click listeners for artist and album links in songs
        addSongClickListeners(songsContainer);
      } else {
        songsContainer.innerHTML = '<p class="no-items">No tracks found</p>';
      }

    } catch (error) {
      console.error('Error loading album content:', error);
    }
  }

  private setupSearch() {
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    const searchBtn = document.getElementById('search-btn');

    const performSearch = async () => {
      const query = searchInput.value.trim();
      if (!query) return;

      this.currentContext = {
        type: 'search',
        data: { query },
        breadcrumbs: [
          { label: 'Library', type: 'home', action: () => this.showHome() },
          { label: `Search: "${query}"`, type: 'home', action: () => {} }
        ]
      };

      this.updateBreadcrumbs();
      await this.loadSearchResults(query);
    };

    searchBtn?.addEventListener('click', performSearch);
    searchInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') performSearch();
    });
  }

  private async loadSearchResults(query: string) {
    const content = document.getElementById('library-content')!;
    content.innerHTML = '<div class="loading-placeholder">Searching...</div>';

    try {
      const results = await openSubsonicClient.search(query, 20, 20, 20);
      
      content.innerHTML = '';

      // Artists
      if (results.artist && results.artist.length > 0) {
        const artistSection = document.createElement('div');
        artistSection.className = 'media-section';
        artistSection.innerHTML = '<h3 class="section-title">Artists</h3>';
        
        const artistsHtml = results.artist.map(artist => `
          <div class="artist-item clickable" data-artist-id="${artist.id}">
            <div class="artist-image">
              <img src="${artist.coverArt ? openSubsonicClient.getCoverArtUrl(artist.coverArt, 300) : 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22 fill=%22%23666%22%3E%3Crect width=%22200%22 height=%22200%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%22100%22 y=%22100%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2224%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'}" 
                   alt="${escapeHtml(artist.name)}" 
                   onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22 fill=%22%23666%22%3E%3Crect width=%22200%22 height=%22200%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%22100%22 y=%22100%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2224%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
            </div>
            <div class="artist-info">
              <h4 class="artist-name">${escapeHtml(artist.name)}</h4>
              <p class="artist-album-count">${artist.albumCount || 0} Albums</p>
            </div>
          </div>
        `).join('');
        
        const artistContainer = document.createElement('div');
        artistContainer.className = 'horizontal-scroll';
        artistContainer.innerHTML = artistsHtml;
        
        // Add event listeners for artist cards
        artistContainer.querySelectorAll('[data-artist-id]').forEach(card => {
          card.addEventListener('click', () => {
            const artistId = card.getAttribute('data-artist-id');
            const artist = results.artist?.find(a => a.id === artistId);
            if (artist) {
              libraryBrowser.showArtist(artist);
            }
          });
        });
        
        artistSection.appendChild(artistContainer);
        content.appendChild(artistSection);
      }

      // Albums
      if (results.album && results.album.length > 0) {
        const albumSection = document.createElement('div');
        albumSection.className = 'media-section';
        albumSection.innerHTML = '<h3 class="section-title">Albums</h3>';
        
        const albumsHtml = results.album.map(album => `
          <div class="album-item clickable" data-album-id="${album.id}">
            <div class="album-cover">
              <img src="${openSubsonicClient.getCoverArtUrl(album.coverArt || '', 300)}" alt="${escapeHtml(album.name)}" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22 fill=%22%23666%22%3E%3Crect width=%22200%22 height=%22200%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%22100%22 y=%22100%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2224%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
            </div>
            <div class="album-info">
              <h4 class="album-title">${escapeHtml(album.name)}</h4>
              <p class="album-artist">${escapeHtml(album.artist)}</p>
            </div>
          </div>
        `).join('');
        
        const albumContainer = document.createElement('div');
        albumContainer.className = 'horizontal-scroll';
        albumContainer.innerHTML = albumsHtml;
        
        // Add event listeners for album cards
        albumContainer.querySelectorAll('[data-album-id]').forEach(card => {
          card.addEventListener('click', () => {
            const albumId = card.getAttribute('data-album-id');
            const album = results.album?.find(a => a.id === albumId);
            if (album) {
              libraryBrowser.showAlbum(album);
            }
          });
        });
        
        albumSection.appendChild(albumContainer);
        content.appendChild(albumSection);
      }

      // Songs
      if (results.song && results.song.length > 0) {
        const songSection = document.createElement('div');
        songSection.className = 'media-section';
        songSection.innerHTML = '<h3 class="section-title">Songs</h3>';
        
        const songsContainer = createUnifiedSongsContainer(results.song, 'search');
        songSection.appendChild(songsContainer);
        content.appendChild(songSection);
        
        // Add click listeners for artist and album links in search results
        addSongClickListeners(songSection);
      }

      if (!results.artist?.length && !results.album?.length && !results.song?.length) {
        content.innerHTML = '<p class="no-items">No results found</p>';
      }

    } catch (error) {
      console.error('Search error:', error);
      content.innerHTML = '<p class="error-message">Search failed. Please try again.</p>';
    }
  }

  private async loadBrowseData() {
    // Same as existing loadBrowseData function but integrated
    if (!openSubsonicClient) return;

    try {
      const [recentAlbums, randomAlbums, randomArtists] = await Promise.all([
        openSubsonicClient.getAlbums(20, 0),
        openSubsonicClient.getAlbums(20, 20), // Use offset to get different albums
        openSubsonicClient.getRandomArtists(20)
      ]);

      // Recent Albums
      const recentContainer = document.getElementById('recent-albums');
      if (recentContainer && recentAlbums.length > 0) {
        const albumsHtml = recentAlbums.map(album => `
          <div class="spotify-card spotify-album-card clickable" data-album-id="${album.id}">
            <div class="spotify-album-cover">
              <img src="${openSubsonicClient.getCoverArtUrl(album.coverArt || '', 300)}" alt="${escapeHtml(album.name)}" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22180%22 height=%22180%22 fill=%22%23333%22%3E%3Crect width=%22180%22 height=%22180%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%2290%22 y=%2290%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2220%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
              <div class="spotify-play-overlay">
                <span class="material-icons">play_arrow</span>
              </div>
            </div>
            <h4 class="spotify-album-title">${escapeHtml(album.name)}</h4>
            <p class="spotify-album-artist">${escapeHtml(album.artist)}</p>
          </div>
        `).join('');
        
        recentContainer.className = 'spotify-horizontal-scroll';
        recentContainer.innerHTML = albumsHtml;
        
        // Add event listeners for recent album cards
        recentContainer.querySelectorAll('[data-album-id]').forEach(card => {
          card.addEventListener('click', () => {
            const albumId = card.getAttribute('data-album-id');
            const album = recentAlbums.find(a => a.id === albumId);
            if (album) {
              libraryBrowser.showAlbum(album);
            }
          });
        });
      }

      // Random Albums
      const randomContainer = document.getElementById('random-albums');
      if (randomContainer && randomAlbums.length > 0) {
        const albumsHtml = randomAlbums.map(album => `
          <div class="spotify-card spotify-album-card clickable" data-album-id="${album.id}">
            <div class="spotify-album-cover">
              <img src="${openSubsonicClient.getCoverArtUrl(album.coverArt || '', 300)}" alt="${escapeHtml(album.name)}" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22180%22 height=%22180%22 fill=%22%23333%22%3E%3Crect width=%22180%22 height=%22180%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%2290%22 y=%2290%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2220%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
              <div class="spotify-play-overlay">
                <span class="material-icons">play_arrow</span>
              </div>
            </div>
            <h4 class="spotify-album-title">${escapeHtml(album.name)}</h4>
            <p class="spotify-album-artist">${escapeHtml(album.artist)}</p>
          </div>
        `).join('');
        
        randomContainer.className = 'spotify-horizontal-scroll';
        randomContainer.innerHTML = albumsHtml;
        
        // Add event listeners for random album cards
        randomContainer.querySelectorAll('[data-album-id]').forEach(card => {
          card.addEventListener('click', () => {
            const albumId = card.getAttribute('data-album-id');
            const album = randomAlbums.find(a => a.id === albumId);
            if (album) {
              libraryBrowser.showAlbum(album);
            }
          });
        });
      }

      // Random Artists
      const artistsContainer = document.getElementById('random-artists');
      if (artistsContainer && randomArtists.length > 0) {
        const artistsHtml = randomArtists.map(artist => `
          <div class="spotify-card spotify-artist-card clickable" data-artist-id="${artist.id}">
            <div class="spotify-artist-image">
              <img src="${artist.coverArt ? openSubsonicClient.getCoverArtUrl(artist.coverArt, 300) : 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22180%22 height=%22180%22 fill=%22%23333%22%3E%3Ccircle cx=%2290%22 cy=%2290%22 r=%2280%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%2290%22 y=%2295%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2224%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'}" 
                   alt="${escapeHtml(artist.name)}" 
                   onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22180%22 height=%22180%22 fill=%22%23333%22%3E%3Ccircle cx=%2290%22 cy=%2290%22 r=%2280%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%2290%22 y=%2295%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2224%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
              <div class="spotify-play-overlay">
                <span class="material-icons">play_arrow</span>
              </div>
            </div>
            <h4 class="spotify-artist-name">${escapeHtml(artist.name)}</h4>
            <p class="spotify-artist-type">Artist</p>
          </div>
        `).join('');
        
        artistsContainer.className = 'spotify-horizontal-scroll';
        artistsContainer.innerHTML = artistsHtml;
        
        // Add event listeners for random artist cards
        artistsContainer.querySelectorAll('[data-artist-id]').forEach(card => {
          card.addEventListener('click', () => {
            const artistId = card.getAttribute('data-artist-id');
            const artist = randomArtists.find(a => a.id === artistId);
            if (artist) {
              libraryBrowser.showArtist(artist);
            }
          });
        });
      }

    } catch (error) {
      console.error('Error loading browse content:', error);
    }
  }
}

// Global instance
let libraryBrowser: LibraryBrowser;

// Replace old showBrowseView with new browser system
function showBrowseView() {
  if (!libraryBrowser) {
    libraryBrowser = new LibraryBrowser();
  } else {
    libraryBrowser.showHome();
  }
}

// Make navigation functions globally available
(window as any).libraryBrowser = {
  showHome: () => libraryBrowser?.showHome(),
  showArtist: (artist: OpenSubsonicArtist) => libraryBrowser?.showArtist(artist),
  showAlbum: (album: OpenSubsonicAlbum) => libraryBrowser?.showAlbum(album),
  navigateToBreadcrumb: (index: number) => libraryBrowser?.navigateToBreadcrumb(index)
};
(window as any).showBrowseView = showBrowseView;

// Wiederverwendbarer Media Container
interface MediaItem {
  id: string;
  name: string;
  type: 'album' | 'artist' | 'song' | 'playlist';
  coverArt?: string;
  artistImageUrl?: string;
  artist?: string;
  albumCount?: number;
  songCount?: number;
  duration?: number;
  year?: number;
  [key: string]: any; // Für zusätzliche Eigenschaften
}

interface MediaContainerConfig {
  containerId: string;
  items: MediaItem[];
  displayMode: 'grid' | 'list';
  itemType: 'album' | 'artist' | 'song' | 'playlist';
  showInfo?: boolean;
  onItemClick?: (item: MediaItem) => void;
}

class MediaContainer {
  private config: MediaContainerConfig;
  private container: HTMLElement;

  constructor(config: MediaContainerConfig) {
    this.config = config;
    this.container = document.getElementById(config.containerId) as HTMLElement;
    if (!this.container) {
      throw new Error(`Container with id '${config.containerId}' not found`);
    }
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = '';
    this.container.className = `media-container ${this.config.displayMode}-mode ${this.config.itemType}-type`;

    this.config.items.forEach(item => {
      const element = this.createMediaElement(item);
      this.container.appendChild(element);
    });

    // Enable drag scrolling after rendering
    this.enableSmartDragScrolling();
    
    // Add rating handlers for songs
    this.setupSongRatingHandlers();
  }
  
  private setupSongRatingHandlers() {
    if (!this.container) return;
    
    const ratingContainers = this.container.querySelectorAll('.song-rating');
    ratingContainers.forEach(container => {
      const songId = container.getAttribute('data-song-id');
      const stars = container.querySelectorAll('.star');
      
      stars.forEach((star, index) => {
        const starElement = star as HTMLElement;
        
        // Hover effects
        starElement.addEventListener('mouseenter', () => {
          stars.forEach((s, i) => {
            s.classList.toggle('hover', i <= index);
          });
        });
        
        starElement.addEventListener('mouseleave', () => {
          stars.forEach(s => s.classList.remove('hover'));
        });
        
        // Click to rate
        starElement.addEventListener('click', (e) => {
          e.stopPropagation();
          const rating = parseInt(starElement.getAttribute('data-rating') || '0');
          if (songId) {
            updateTrackRating(songId, rating);
            
            // Update visual state
            stars.forEach((s, i) => {
              s.classList.toggle('filled', i < rating);
            });
          }
        });
      });
    });
  }

  private createMediaElement(item: MediaItem): HTMLElement {
    // For search results, use simplified single-element structure
    if (document.getElementById('search-content')) {
      const element = document.createElement('div');
      element.className = `media-item ${item.type}-item`;
      element.dataset.id = item.id;
      element.dataset.type = item.type;

      // Create content based on type
      switch (item.type) {
        case 'album':
          this.createAlbumElement(element, item);
          break;
        case 'artist':
          this.createArtistElement(element, item);
          break;
        case 'song':
          this.createSongElement(element, item);
          break;
        case 'playlist':
          this.createPlaylistElement(element, item);
          break;
      }

      // Add click handler directly to element
      element.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.config.onItemClick) {
          this.config.onItemClick(item);
        }
      });

      return element;
    }

    // For browse content, keep wrapper structure for info display
    const wrapper = document.createElement('div');
    wrapper.className = `media-item-wrapper ${item.type}-wrapper`;
    
    const element = document.createElement('div');
    element.className = `media-item ${item.type}-item`;
    element.dataset.id = item.id;
    element.dataset.type = item.type;

    // Create content based on type
    switch (item.type) {
      case 'album':
        this.createAlbumElement(element, item);
        break;
      case 'artist':
        this.createArtistElement(element, item);
        break;
      case 'song':
        this.createSongElement(element, item);
        break;
      case 'playlist':
        this.createPlaylistElement(element, item);
        break;
    }

    // Add info section if enabled
    if (this.config.showInfo !== false) {
      const info = this.createInfoElement(item);
      wrapper.appendChild(element);
      wrapper.appendChild(info);
    } else {
      wrapper.appendChild(element);
    }

    // Add click handler
    wrapper.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.config.onItemClick) {
        this.config.onItemClick(item);
      }
    });

    return wrapper;
  }

  private createAlbumElement(element: HTMLElement, item: MediaItem) {
    const coverUrl = item.coverArt && openSubsonicClient 
      ? openSubsonicClient.getCoverArtUrl(item.coverArt, 300)
      : '';

    element.className += ' album-card';
    element.innerHTML = `
      <div class="album-cover">
        ${coverUrl 
          ? `<img src="${coverUrl}" alt="${item.name}" loading="lazy">`
          : '<span class="material-icons">album</span>'
        }
        <div class="play-overlay">
          <span class="material-icons">play_arrow</span>
        </div>
      </div>
    `;
  }

  private createArtistElement(element: HTMLElement, item: MediaItem) {
    // Always show fallback icon - no image loading
    let imageHtml = '<span class="material-icons artist-placeholder">artist</span>';
    
    // For search results, use simplified structure with all styling on main element
    if (element.closest('#search-content') || document.getElementById('search-content')) {
      element.className = 'artist-wrapper';
      element.innerHTML = `
        ${imageHtml}
        <div class="artist-content">
          <div class="artist-name">${escapeHtml(item.name)}</div>
          <div class="artist-album-count">${item.albumCount || 0} Albums</div>
        </div>
      `;
    } else {
      // For browse content, use card layout
      element.className += ' artist-card';
      element.innerHTML = `
        <div class="artist-avatar">
          ${imageHtml}
        </div>
        <div class="artist-name">${escapeHtml(item.name)}</div>
      `;
    }
  }

  private createSongElement(element: HTMLElement, item: MediaItem) {
    // Use unified song design for consistency
    const song: OpenSubsonicSong = {
      id: item.id,
      title: item.name,
      artist: item.artist || 'Unknown Artist',
      album: item.album || '',
      albumId: item.albumId,
      duration: item.duration || 0,
      size: 0,
      suffix: 'mp3',
      bitRate: 320,
      coverArt: item.coverArt,
      year: item.year || 0,
      genre: item.genre || '',
      userRating: item.userRating || 0
    };
    
    // Create unified song element
    const unifiedElement = createUnifiedSongElement(song, 'search');
    
    // Copy classes and properties to provided element
    element.className = unifiedElement.className;
    element.innerHTML = unifiedElement.innerHTML;
    element.draggable = unifiedElement.draggable;
    
    // Copy event listeners
    const dragHandler = (e: DragEvent) => {
      if (e.dataTransfer) {
        e.dataTransfer.setData('application/json', JSON.stringify({
          type: 'song',
          song: song,
          sourceUrl: openSubsonicClient?.getStreamUrl(item.id)
        }));
        e.dataTransfer.effectAllowed = 'copy';
      }
    };
    element.addEventListener('dragstart', dragHandler);
  }

  private createPlaylistElement(element: HTMLElement, item: MediaItem) {
    element.className += ' playlist-item';
    element.innerHTML = `
      <div class="playlist-cover">
        <span class="material-icons">queue_music</span>
      </div>
    `;
  }

  private createInfoElement(item: MediaItem): HTMLElement {
    const info = document.createElement('div');
    info.className = 'media-info-external';

    switch (item.type) {
      case 'album':
        info.innerHTML = `
          <div class="media-title">${item.name}</div>
          <div class="media-artist">${item.artist || 'Unknown Artist'}</div>
          ${item.year ? `<div class="media-year">${item.year}</div>` : ''}
        `;
        break;
      case 'artist':
        info.innerHTML = `
          <div class="media-title">${item.name}</div>
          ${item.albumCount ? `<div class="media-subtitle">${item.albumCount} Albums</div>` : ''}
        `;
        break;
      case 'song':
        info.innerHTML = `
          <div class="media-title">${item.name}</div>
          <div class="media-artist">${item.artist || 'Unknown Artist'}</div>
        `;
        break;
      case 'playlist':
        info.innerHTML = `
          <div class="media-title">${item.name}</div>
          ${item.songCount ? `<div class="media-subtitle">${item.songCount} Songs</div>` : ''}
        `;
        break;
    }

    return info;
  }

  private formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  private enableSmartDragScrolling() {
    if (!this.container) return;

    let isDown = false;
    let startX: number;
    let scrollLeft: number;
    let hasDragged = false;

    this.container.addEventListener('mousedown', (e) => {
      // Nur auf dem Container selbst, nicht auf Items
      if ((e.target as HTMLElement).closest('.media-item-wrapper')) return;
      
      isDown = true;
      hasDragged = false;
      this.container.classList.add('active-drag');
      startX = (e as MouseEvent).pageX - this.container.getBoundingClientRect().left;
      scrollLeft = this.container.scrollLeft;
    });

    this.container.addEventListener('mouseleave', () => {
      isDown = false;
      this.container.classList.remove('active-drag');
    });

    this.container.addEventListener('mouseup', () => {
      isDown = false;
      this.container.classList.remove('active-drag');
    });

    this.container.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      e.preventDefault();
      hasDragged = true;
      
      const x = (e as MouseEvent).pageX - this.container.getBoundingClientRect().left;
      const walk = (x - startX) * 2;
      this.container.scrollLeft = scrollLeft - walk;
    });
  }
}

// Legacy functions converted to use MediaContainer
async function loadRecentAlbums() {
  console.log('🔍 Loading recent albums...');
  if (!openSubsonicClient) {
    console.warn('OpenSubsonic client not available for recent albums');
    return;
  }

  try {
    console.log('📡 Calling getNewestAlbums API...');
    const albums = await openSubsonicClient.getNewestAlbums(20);
    console.log('✅ Recent albums API response:', albums.slice(0, 3)); // Show first 3 for debugging
    console.log(`📊 Total albums returned: ${albums.length}`);
    
    // Check if albums have creation/modification dates
    if (albums.length > 0) {
      console.log('🗓️ First album details:', {
        name: albums[0].name,
        artist: albums[0].artist,
        year: albums[0].year,
        id: albums[0].id,
        songCount: albums[0].songCount,
        duration: albums[0].duration,
        created: albums[0].created || 'no created field'
      });
      
      // Test: Sortierung analysieren
      console.log('🔍 Recent Albums Sortierung Test:');
      if (albums.length > 1) {
        const sortedByName = [...albums].sort((a, b) => a.name.localeCompare(b.name));
        const isAlphabetical = albums.every((album, index) => album.name === sortedByName[index]?.name);
        console.log('❌ Alphabetical sorting detected:', isAlphabetical);
        
        console.log('📝 First 5 album names in order received:');
        albums.slice(0, 5).forEach((album, index) => {
          console.log(`  ${index + 1}. ${album.name} (Year: ${album.year || 'unknown'})`);
        });
        
        // Datum-basierte Analyse falls verfügbar
        if (albums[0].created) {
          console.log('📅 First 3 albums with creation dates:');
          albums.slice(0, 3).forEach(album => {
            console.log(`  - ${album.name} (${album.created})`);
          });
        }
      }
    }
    
    const mediaItems: MediaItem[] = albums.map((album: OpenSubsonicAlbum) => ({
      id: album.id,
      name: album.name,
      type: 'album' as const,
      coverArt: album.coverArt,
      artist: album.artist,
      year: album.year
    }));

    const container = new MediaContainer({
      containerId: 'recent-albums',
      items: mediaItems,
      displayMode: 'grid',
      itemType: 'album',
      onItemClick: (item) => {
        const album = albums.find((a: OpenSubsonicAlbum) => a.id === item.id);
        if (album) loadAlbumTracks(album);
      }
    });

    container.render();
    console.log('✅ Recent albums loaded successfully');
  } catch (error) {
    console.error('Failed to load recent albums:', error);
    const container = document.getElementById('recent-albums');
    if (container) {
      container.innerHTML = '<div class="loading-placeholder">Failed to load recent albums</div>';
    }
  }
}

async function loadRandomAlbums() {
  console.log('🎲 Loading random albums...');
  if (!openSubsonicClient) {
    console.warn('OpenSubsonic client not available for random albums');
    return;
  }

  try {
    console.log('📡 Calling getRandomAlbums API...');
    const albums = await openSubsonicClient.getRandomAlbums(20);
    console.log('✅ Random albums API response:', albums.slice(0, 3)); // Show first 3 for debugging
    console.log(`📊 Total albums returned: ${albums.length}`);
    
    // Check if truly random by looking at first few names
    if (albums.length > 0) {
      console.log('🎲 Random album sample:', albums.slice(0, 5).map(a => `${a.artist} - ${a.name}`));
      
      // Test: Randomness-Test
      console.log('🔍 Random Albums Randomness Test:');
      if (albums.length > 1) {
        const sortedByName = [...albums].sort((a, b) => a.name.localeCompare(b.name));
        const isAlphabetical = albums.every((album, index) => album.name === sortedByName[index]?.name);
        console.log('❌ Alphabetical sorting detected (should be false for random):', isAlphabetical);
        
        const sortedByArtist = [...albums].sort((a, b) => a.artist.localeCompare(b.artist));
        const isArtistSorted = albums.every((album, index) => album.artist === sortedByArtist[index]?.artist);
        console.log('❌ Artist sorting detected (should be false for random):', isArtistSorted);
        
        console.log('📝 First 5 albums in order received:');
        albums.slice(0, 5).forEach((album, index) => {
          console.log(`  ${index + 1}. ${album.artist} - ${album.name}`);
        });
      }
    }
    const mediaItems: MediaItem[] = albums.map((album: OpenSubsonicAlbum) => ({
      id: album.id,
      name: album.name,
      type: 'album' as const,
      coverArt: album.coverArt,
      artist: album.artist,
      year: album.year
    }));

    const container = new MediaContainer({
      containerId: 'random-albums',
      items: mediaItems,
      displayMode: 'grid',
      itemType: 'album',
      onItemClick: (item) => {
        const album = albums.find((a: OpenSubsonicAlbum) => a.id === item.id);
        if (album) loadAlbumTracks(album);
      }
    });

    container.render();
    console.log('✅ Random albums loaded successfully');
  } catch (error) {
    console.error('Failed to load random albums:', error);
    const container = document.getElementById('random-albums');
    if (container) {
      container.innerHTML = '<div class="loading-placeholder">Failed to load random albums</div>';
    }
  }
}

async function loadRandomArtists() {
  console.log('Loading random artists...');
  if (!openSubsonicClient) {
    console.warn('OpenSubsonic client not available for random artists');
    return;
  }

  try {
    const artists = await openSubsonicClient.getRandomArtists(20);
    const mediaItems: MediaItem[] = artists.map((artist: OpenSubsonicArtist) => ({
      id: artist.id,
      name: artist.name,
      type: 'artist' as const,
      coverArt: artist.coverArt,
      artistImageUrl: artist.artistImageUrl,
      albumCount: artist.albumCount
    }));

    const container = new MediaContainer({
      containerId: 'random-artists',
      items: mediaItems,
      displayMode: 'grid',
      itemType: 'artist',
      onItemClick: (item) => {
        const artist = artists.find((a: OpenSubsonicArtist) => a.id === item.id);
        if (artist) loadArtistAlbums(artist);
      }
    });

    container.render();
    console.log('✅ Random artists loaded successfully');
  } catch (error) {
    console.error('Failed to load random artists:', error);
    const container = document.getElementById('random-artists');
    if (container) {
      container.innerHTML = '<div class="loading-placeholder">Failed to load random artists</div>';
    }
  }
}
