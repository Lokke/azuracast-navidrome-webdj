import "./style.css";
import { SubsonicApiClient, type OpenSubsonicSong, type OpenSubsonicAlbum, type OpenSubsonicArtist } from "./navidrome";
import WaveSurfer from 'wavesurfer.js';

console.log("SubCaster loaded!");

// Forward declarations for functions used before definition
declare function startVolumeMeter(side: 'a' | 'b' | 'c' | 'd' | 'mic'): void;
declare function updateVolumeMeter(meterId: string, level: number): void;
declare function setupAudioPlayer(side: 'a' | 'b' | 'c' | 'd', audio: HTMLAudioElement): void;
declare function loadTrackToPlayer(side: 'a' | 'b' | 'c' | 'd', song: OpenSubsonicSong, autoPlay?: boolean): void;
declare function initializeCrossfader(): void;
declare function initializePlayerDropZones(): void;
declare function setupQueueDropZone(): void;
declare function setupAutoQueueControls(): void;
declare function clearWaveformInfo(side: 'a' | 'b' | 'c' | 'd'): void;
declare function clearWaveformBlinking(side: 'a' | 'b' | 'c' | 'd'): void;

// Global variables
declare let libraryBrowser: any;
declare let volumeMeterIntervals: { [key: string]: NodeJS.Timeout };

// Global state for search results
let lastSearchResults: any = null;
let lastSearchQuery: string = '';

// Track storage for each deck to enable drag & drop between decks
const deckSongs: {
  a: OpenSubsonicSong | null;
  b: OpenSubsonicSong | null;
  c: OpenSubsonicSong | null;
  d: OpenSubsonicSong | null;
} = {
  a: null,
  b: null,
  c: null,
  d: null
};

// Audio Mixing und Streaming Infrastruktur
let audioContext: AudioContext | null = null;
let masterGainNode: GainNode | null = null;
let streamGainNode: GainNode | null = null; // Separate Ausgabe für Stream
let aPlayerGain: GainNode | null = null;
let bPlayerGain: GainNode | null = null;
let cPlayerGain: GainNode | null = null;
let dPlayerGain: GainNode | null = null;
let microphoneGain: GainNode | null = null;
let crossfaderGain: { a: GainNode; b: GainNode; c: GainNode; d: GainNode } | null = null;
let streamCrossfaderGain: { a: GainNode; b: GainNode; c: GainNode; d: GainNode } | null = null; // Separate Crossfader für Stream
let microphoneStream: MediaStream | null = null;
let mediaRecorder: MediaRecorder | null = null;
let isStreaming: boolean = false;
let streamChunks: Blob[] = [];

// SMART METADATA PRIORITY SYSTEM
interface PlayerState {
  song: OpenSubsonicSong | null;
  isPlaying: boolean;
  startTime: number; // Timestamp when track started playing
  side: 'a' | 'b' | 'c' | 'd';
}

let playerStates: Record<'a' | 'b' | 'c' | 'd', PlayerState> = {
  a: { song: null, isPlaying: false, startTime: 0, side: 'a' },
  b: { song: null, isPlaying: false, startTime: 0, side: 'b' },
  c: { song: null, isPlaying: false, startTime: 0, side: 'c' },
  d: { song: null, isPlaying: false, startTime: 0, side: 'd' }
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
function setPlayerState(side: 'a' | 'b' | 'c' | 'd', song: OpenSubsonicSong | null, isPlaying: boolean) {
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
function getCurrentLoadedSong(side: 'a' | 'b' | 'c' | 'd'): OpenSubsonicSong | null {
  const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
  if (!audio || !audio.dataset.songId) return null;
  
  // Find song by ID in current songs or player state
  return playerStates[side].song || 
         currentSongs.find(song => song.id === audio.dataset.songId) || 
         null;
}

// Complete deck reset when track ends or eject is pressed
function clearPlayerDeck(side: 'a' | 'b' | 'c' | 'd') {
  console.log(`🔄 Clearing Player ${side.toUpperCase()} deck completely`);
  
  const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
  const titleElement = document.getElementById(`track-title-${side}`);
  const artistElement = document.getElementById(`track-artist-${side}`);
  const albumCover = document.getElementById(`album-cover-${side}`) as HTMLElement;
  const playerRating = document.getElementById(`player-rating-${side}`);
  const timeDisplay = document.getElementById(`time-display-${side}`);
  const progressBar = document.getElementById(`progress-bar-${side}`);
  const volumeMeter = document.getElementById(`volume-meter-${side}`);
  const playerDeck = document.getElementById(`player-deck-${side}`);
  
  // Clear audio
  if (audio) {
    audio.pause();
    audio.src = '';
    audio.currentTime = 0;
    audio.removeAttribute('data-song-id');
    
    // Note: We don't need to clone the audio element since we want to keep the basic event listeners
    // The audio element will be properly reinitialized when a new track is loaded
  }
  
  // Clear stored song data for drag & drop
  deckSongs[side] = null;
  
  // Clear metadata display
  if (titleElement) titleElement.textContent = 'No Track Loaded';
  if (artistElement) artistElement.textContent = '';

  // Clear waveform info overlay
  clearWaveformInfo(side);
  
  // Clear album cover
  if (albumCover) {
    albumCover.innerHTML = `
      <div class="no-cover">
        <span class="material-icons">music_note</span>
      </div>
    `;
  }
  
  // Clear rating but keep placeholder structure
  if (playerRating) {
    // Create placeholder stars to reserve space
    playerRating.innerHTML = `
      <div class="rating-stars placeholder">
        <span class="star empty">☆</span>
        <span class="star empty">☆</span>
        <span class="star empty">☆</span>
        <span class="star empty">☆</span>
        <span class="star empty">☆</span>
      </div>
    `;
  }
  
  // Clear time display
  if (timeDisplay) {
    timeDisplay.textContent = '00:00 / 00:00';
  }
  
  // Reset progress bar visual state
  if (progressBar) {
    const progressFill = progressBar.querySelector('.progress-fill');
    if (progressFill) {
      (progressFill as HTMLElement).style.width = '0%';
    }
  }
  
  // Clear volume meter
  if (volumeMeter) {
    const meterBars = volumeMeter.querySelectorAll('.meter-bar');
    meterBars.forEach(bar => {
      (bar as HTMLElement).classList.remove('active');
    });
  }
  
  // Remove player deck status classes
  if (playerDeck) {
    playerDeck.classList.remove('playing', 'loaded', 'has-track');
  }
  
  // Reset waveform completely
  clearWaveform(side);
  
  // Clear waveform blinking effects
  clearWaveformBlinking(side);
  
  // Clear player state
  setPlayerState(side, null, false);
  
  // Reset any loading indicators
  const loadingIndicator = document.getElementById(`waveform-loading-${side}`);
  if (loadingIndicator) {
    loadingIndicator.remove();
  }
  
  console.log(`✅ Player ${side.toUpperCase()} deck cleared completely`);
}

// Debug function to show current player states and metadata priority
function debugPlayerStates() {
  console.log('?? CURRENT PLAYER STATES DEBUG:');
  console.log('Player A:', playerStates.a);
  console.log('Player B:', playerStates.b);
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
    return import.meta.env.VITE_STREAM_SERVER || '';
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
    
    // Master Gain Node f�r Monitor-Ausgabe (Kopfh�rer/Lautsprecher) - NUR PLAYER DECKS
    masterGainNode = audioContext.createGain();
    masterGainNode.gain.value = 0.99; // 99% Monitor-Volume
    masterGainNode.connect(audioContext.destination);
    
    // Stream Gain Node f�r Live-Stream (separate Ausgabe) - PLAYER DECKS + MIKROFON
    streamGainNode = audioContext.createGain();
    streamGainNode.gain.value = 0.99; // 99% Stream-Volume
    
    // Separate Gain Nodes für alle 4 Player
    aPlayerGain = audioContext.createGain();
    aPlayerGain.gain.value = 1.0; // 100% Initial volume
    bPlayerGain = audioContext.createGain();
    bPlayerGain.gain.value = 1.0; // 100% Initial volume
    cPlayerGain = audioContext.createGain();
    cPlayerGain.gain.value = 1.0; // 100% Initial volume
    dPlayerGain = audioContext.createGain();
    dPlayerGain.gain.value = 1.0; // 100% Initial volume
    
    // Crossfader Gain Nodes für Monitor-Ausgabe (Kopfhörer) - alle 4 Player
    crossfaderGain = {
      a: audioContext.createGain(),
      b: audioContext.createGain(),
      c: audioContext.createGain(),
      d: audioContext.createGain()
    };
    
    // Crossfader Gain Nodes für Stream-Ausgabe (separate Kontrolle) - alle 4 Player
    streamCrossfaderGain = {
      a: audioContext.createGain(),
      b: audioContext.createGain(),
      c: audioContext.createGain(),
      d: audioContext.createGain()
    };
    
    // Initial Crossfader in der Mitte (alle Kanäle gleichlaut)
    const initialGain = Math.cos(0.5 * Math.PI / 2); // ~0.707 für 50% Position
    if (crossfaderGain && streamCrossfaderGain) {
      crossfaderGain.a.gain.value = initialGain;
      crossfaderGain.b.gain.value = initialGain;
      crossfaderGain.c.gain.value = initialGain;
      crossfaderGain.d.gain.value = initialGain;
      streamCrossfaderGain.a.gain.value = initialGain;
      streamCrossfaderGain.b.gain.value = initialGain;
      streamCrossfaderGain.c.gain.value = initialGain;
      streamCrossfaderGain.d.gain.value = initialGain;
    }
    
    // Mikrofon Gain Nodes
    microphoneGain = audioContext.createGain();
    microphoneGain.gain.value = 0; // Standardm��ig stumm (wird �ber Button aktiviert)
    
    // Mikrofon Monitor Gain (separater Schalter f�r Selbstabh�rung)
    const microphoneMonitorGain = audioContext.createGain();
    microphoneMonitorGain.gain.value = 0; // Standardm��ig aus (kein Selbsth�ren)
    
    // MONITOR-ROUTING (Kopfhörer): Alle 4 Player Decks, KEIN Mikrofon standardmäßig
    if (crossfaderGain && masterGainNode) {
      crossfaderGain.a.connect(masterGainNode);
      crossfaderGain.b.connect(masterGainNode);
      crossfaderGain.c.connect(masterGainNode);
      crossfaderGain.d.connect(masterGainNode);
    }
    
    // STREAM-ROUTING: Alle 4 Player Decks + Mikrofon (wenn Button an)
    if (streamCrossfaderGain && streamGainNode) {
      streamCrossfaderGain.a.connect(streamGainNode);
      streamCrossfaderGain.b.connect(streamGainNode);
      streamCrossfaderGain.c.connect(streamGainNode);
      streamCrossfaderGain.d.connect(streamGainNode);
      microphoneGain.connect(streamGainNode); // Mikrofon nur zum Stream
    }
    
    // Alle 4 Player Gains mit beiden Crossfadern verbinden
    if (crossfaderGain && streamCrossfaderGain) {
      aPlayerGain.connect(crossfaderGain.a);
      aPlayerGain.connect(streamCrossfaderGain.a);
      bPlayerGain.connect(crossfaderGain.b);
      bPlayerGain.connect(streamCrossfaderGain.b);
      cPlayerGain.connect(crossfaderGain.c);
      cPlayerGain.connect(streamCrossfaderGain.c);
      dPlayerGain.connect(crossfaderGain.d);
      dPlayerGain.connect(streamCrossfaderGain.d);
    }
    
    // Mikrofon Monitor (separater Schalter f�r Selbstabh�rung)
    // Wird sp�ter mit separatem Button gesteuert
    
    console.log('??? Audio mixing system initialized with separated monitor and stream routing');
    console.log('?? MONITOR (Kopfh�rer): Nur Player Decks');
    console.log('?? STREAM (AzuraCast): Player Decks + Mikrofon (wenn Button an)');
    
    // Speichere microphoneMonitorGain global f�r sp�tere Kontrolle
    (window as any).microphoneMonitorGain = microphoneMonitorGain;
    
    // Volume Meter sofort nach Audio-Initialisierung starten
    setTimeout(() => {
      console.log('?? Starting volume meters...');
      startVolumeMeter('a');
      startVolumeMeter('b');
      startVolumeMeter('mic');
    }, 500); // Kurze Verz�gerung f�r Audio-Kontext Stabilit�t
    
    return true;
  } catch (error) {
    console.error('Failed to initialize audio mixing:', error);
    return false;
  }
}

// Audio-Quellen zu Mixing-System hinzuf�gen
function connectAudioToMixer(audioElement: HTMLAudioElement, side: 'a' | 'b' | 'c' | 'd') {
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
    
    // ENTSCHEIDENDE L�SUNG: Nur Web Audio API verwenden wenn wirklich gestreamt wird
    // Ansonsten l�uft das Audio ganz normal �ber Browser-Audio
    
    if (!isStreaming) {
      console.log(`??? ${side} player: NO STREAMING - Audio plays normally through browser (headphones work)`);
      // Audio Element l�uft ganz normal - kein Web Audio API Hijacking
      return true;
    }
    
    console.log(`??? ${side} player: STREAMING ACTIVE - connecting to Web Audio API`);
    
    // NUR BEIM STREAMING: Web Audio API verwenden
    // WICHTIG: Audio Element Eigenschaften f�r bessere Browser-Kompatibilit�t setzen
    audioElement.crossOrigin = 'anonymous';
    audioElement.preservesPitch = false; // Weniger CPU-intensiv
    
    // MediaElementAudioSourceNode erstellen
    const sourceNode = audioContext.createMediaElementSource(audioElement);
    (audioElement as any)._audioSourceNode = sourceNode;
    
    // Mit entsprechendem Player Gain verbinden
    if (side === 'a' && aPlayerGain) {
      sourceNode.connect(aPlayerGain);
      console.log(`🎵 ${side} player connected to aPlayerGain for streaming`);
      
    } else if (side === 'b' && bPlayerGain) {
      sourceNode.connect(bPlayerGain);
      console.log(`🎵 ${side} player connected to bPlayerGain for streaming`);
      
    } else if (side === 'c' && cPlayerGain) {
      sourceNode.connect(cPlayerGain);
      console.log(`🎵 ${side} player connected to cPlayerGain for streaming`);
      
    } else if (side === 'd' && dPlayerGain) {
      sourceNode.connect(dPlayerGain);
      console.log(`🎵 ${side} player connected to dPlayerGain for streaming`);
      
    } else {
      console.error(`❌ Failed to connect ${side} player: gain node not available`);
      return false;
    }
    
    console.log(`??? Audio Flow when STREAMING: ${side} Player ? Web Audio API ? [Monitor + Stream]`);
    console.log(`??? Audio Flow when NOT streaming: ${side} Player ? Browser Audio ? Headphones`);
    
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
function createPlayerDeckHTML(side: 'a' | 'b' | 'c' | 'd'): string {
  const playerLetter = side.toUpperCase();
  const labelClass = side;
  
  return `
    <div class="player-label ${labelClass}">
      <div class="player-label-dot"></div>
      <span class="player-label-text">Player ${playerLetter}</span>
      <audio id="audio-${side}" preload="metadata"></audio>
      <!-- Hidden track info elements for JavaScript -->
      <div style="display: none;">
        <div class="track-title" id="track-title-${side}">No Track Loaded</div>
        <div class="track-artist" id="track-artist-${side}">-</div>
      </div>
    </div>
    
    <!-- Player Main Content (Album + Waveform) -->
    <div class="player-main">
      <!-- Top Section: Album Cover Only -->
      <div class="player-top-section">
        <div class="album-section">
          <div class="album-cover" id="album-cover-${side}">
            <div class="no-cover">
              <span class="material-icons">music_note</span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Waveform Section (Full Width) -->
      <div class="waveform-container">
        <div class="waveform" id="waveform-${side}"></div>
        <div class="waveform-loading" id="waveform-loading-${side}">Loading...</div>
        <!-- Glass overlay with gradient -->
        <div class="waveform-glass-overlay"></div>
        <div class="waveform-track-info" id="waveform-info-${side}">
          <!-- Large centered title -->
          <div class="track-title-large">
            <span class="track-title"></span>
          </div>
          <!-- Bottom left: artist and album stacked -->
          <div class="track-details-bottom-left">
            <div class="track-artist-line">
              <span class="track-artist"></span>
            </div>
            <div class="track-album-line">
              <span class="track-album"></span>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Controls Bar (Outside player-main, spans full width) -->
    <div class="controls-bar">
      <div class="controls-line-breadcrumb">
        <!-- Transport Controls -->
        <button class="breadcrumb-btn play-pause-btn" id="play-pause-${side}" title="Play/Pause">
          <span class="material-icons">play_arrow</span>
        </button>
        <button class="breadcrumb-btn restart-btn" id="restart-${side}" title="Restart">
          <span class="material-icons">skip_previous</span>
        </button>
        <button class="breadcrumb-btn eject-btn" id="eject-${side}" title="Eject">
          <span class="material-icons">eject</span>
        </button>
        
        <!-- Time Display -->
        <div class="breadcrumb-element time-display" id="time-display-${side}">0:00 / 0:00</div>
        
        <!-- Rating Stars -->
        <div class="breadcrumb-element rating-display" id="player-rating-${side}">
          <span class="rating-star">★</span>
          <span class="rating-star">★</span>
          <span class="rating-star">★</span>
          <span class="rating-star">★</span>
          <span class="rating-star">★</span>
        </div>
        
        <!-- Volume Control -->
        <div class="breadcrumb-element volume-control">
          <span class="volume-label">Vol</span>
          <input type="range" class="volume-slider-breadcrumb" id="volume-${side}" min="0" max="100" step="1" value="80">
        </div>
        
        <!-- Spacer to push volume meter to the right -->
        <div class="controls-spacer"></div>
        
        <!-- Volume Meter (Right-aligned) -->
        <div class="breadcrumb-element volume-meter" id="volume-meter-${side}">
          <div class="meter-bars">
            <div class="meter-bar"></div>
            <div class="meter-bar"></div>
            <div class="meter-bar"></div>
            <div class="meter-bar"></div>
            <div class="meter-bar"></div>
            <div class="meter-bar"></div>
            <div class="meter-bar"></div>
            <div class="meter-bar"></div>
          </div>
        </div>
        
        <!-- Wizard Button -->
        <div class="breadcrumb-element wizard-control" id="wizard-control-${side}" title="Ähnliche Songs finden">
          <i class="material-icons wizard-icon">casino</i>
          <i class="material-icons wizard-dice-animation" style="display: none;">casino</i>
          <i class="material-icons wizard-loading" style="display: none;">hourglass_empty</i>
        </div>
      </div>
    </div>
  `;
}

// Initialize Player Decks
function initializePlayerDecks() {
  // Initialize all 4 player decks
  const playerA = document.getElementById('player-a');
  const playerB = document.getElementById('player-b');
  const playerC = document.getElementById('player-c');
  const playerD = document.getElementById('player-d');
  
  if (playerA) {
    playerA.innerHTML = createPlayerDeckHTML('a');
  }
  
  if (playerB) {
    playerB.innerHTML = createPlayerDeckHTML('b');
  }
  
  if (playerC) {
    playerC.innerHTML = createPlayerDeckHTML('c');
  }
  
  if (playerD) {
    playerD.innerHTML = createPlayerDeckHTML('d');
  }
  
  // Setup volume controls after HTML is created
  setupVolumeControls();
  
  // Setup Wizard labels for similar songs
  setupWizardLabels();
  
  console.log('All 4 player decks initialized with professional layout');
}

// Setup Wizard controls for similar songs
function setupWizardLabels() {
  const players = ['a', 'b', 'c', 'd'];
  
  players.forEach(playerLetter => {
    const wizardControl = document.getElementById(`wizard-control-${playerLetter}`);
    console.log(`Looking for wizard-control-${playerLetter}:`, !!wizardControl);
    if (wizardControl) {
      wizardControl.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log(`🧙‍♂️ Wizard clicked for player ${playerLetter.toUpperCase()}`);
        await handleWizardClick(playerLetter);
      });
      console.log(`✅ Wizard control for player ${playerLetter.toUpperCase()} connected`);
    } else {
      console.error(`❌ Wizard control for player ${playerLetter.toUpperCase()} NOT FOUND`);
    }
  });
}

// Display similar songs directly in browse content (replacing current content)
function displaySimilarSongsInBrowser(songs: OpenSubsonicSong[], songTitle: string, artist: string) {
  // Get browse content container
  const browseContent = document.getElementById('browse-content');
  if (!browseContent) {
    console.error('Browse content container not found');
    return;
  }
  
  // Switch to browse tab to show the results
  const searchTabBtn = document.querySelector('.tab-btn[data-tab="search"]') as HTMLElement;
  const browseTabBtn = document.querySelector('.tab-btn[data-tab="browse"]') as HTMLElement;
  const searchContent = document.getElementById('search-content');
  
  if (searchTabBtn && browseTabBtn && searchContent) {
    // Switch to browse tab
    searchTabBtn.classList.remove('active');
    browseTabBtn.classList.add('active');
    searchContent.classList.remove('active');
    browseContent.classList.add('active');
  }
  
  // Use the LibraryBrowser system to show wizard results with proper breadcrumbs
  if (libraryBrowser) {
    libraryBrowser.showWizardResults(songs, songTitle, artist);
  } else {
    console.error('LibraryBrowser not available');
  }
  
  console.log(`✅ Displayed ${songs.length} similar songs using LibraryBrowser system`);
}

// Handle Wizard label click to get similar songs
async function handleWizardClick(playerLetter: string) {
  try {
    // Get the currently loaded song from player state
    const currentSong = getCurrentLoadedSong(playerLetter as 'a' | 'b' | 'c' | 'd');
    if (!currentSong) {
      console.log(`No song loaded in player ${playerLetter.toUpperCase()}`);
      return;
    }
    
    const artist = currentSong.artist;
    if (!artist) {
      console.log(`No artist found for loaded song in player ${playerLetter.toUpperCase()}`);
      return;
    }
    
    const songId = currentSong.id;
    if (!songId) {
      console.log(`No song ID found for loaded song in player ${playerLetter.toUpperCase()}`);
      return;
    }
    
    console.log(`Wizard! Getting similar songs for song: "${currentSong.title}" (ID: ${songId}) by ${artist} in player ${playerLetter.toUpperCase()}`);
    
    // Add loading state to control
    const wizardControl = document.getElementById(`wizard-control-${playerLetter}`);
    if (wizardControl) {
      wizardControl.classList.add('loading');
      const wizardIcon = wizardControl.querySelector('.wizard-icon') as HTMLElement;
      const diceAnimation = wizardControl.querySelector('.wizard-dice-animation') as HTMLElement;
      const loadingIcon = wizardControl.querySelector('.wizard-loading') as HTMLElement;
      
      if (wizardIcon && diceAnimation && loadingIcon) {
        // Start with dice animation
        wizardIcon.style.display = 'none';
        diceAnimation.style.display = 'block';
        
        // After dice animation (600ms), switch to loading spinner
        setTimeout(() => {
          diceAnimation.style.display = 'none';
          loadingIcon.style.display = 'block';
        }, 600);
      }
    }
    
    // Get similar songs from API using song ID
    const similarSongs = await openSubsonicClient.getSimilarSongs2(songId, 20);
    
    if (similarSongs && similarSongs.length > 0) {
      console.log(`Found ${similarSongs.length} similar songs for ${currentSong.title}`);
      
      // Display similar songs directly in browse content (replacing current content)
      displaySimilarSongsInBrowser(similarSongs, currentSong.title, artist);
      
    } else {
      console.log(`No similar songs found for song: ${currentSong.title}`);
    }
    
  } catch (error) {
    console.error('Error getting similar songs:', error);
  } finally {
    // Remove loading state from control
    const wizardControl = document.getElementById(`wizard-control-${playerLetter}`);
    if (wizardControl) {
      wizardControl.classList.remove('loading');
      const wizardIcon = wizardControl.querySelector('.wizard-icon') as HTMLElement;
      const diceAnimation = wizardControl.querySelector('.wizard-dice-animation') as HTMLElement;
      const loadingIcon = wizardControl.querySelector('.wizard-loading') as HTMLElement;
      
      if (wizardIcon && diceAnimation && loadingIcon) {
        wizardIcon.style.display = 'block';
        diceAnimation.style.display = 'none';
        loadingIcon.style.display = 'none';
      }
    }
  }
}

// Display similar songs in the universal container
function displaySimilarSongs(songs: OpenSubsonicSong[], songTitle: string, artist: string) {
  const universalContainer = document.getElementById('universal-container');
  if (!universalContainer) return;
  
  // Clear existing content
  universalContainer.innerHTML = '';
  
  // Add header
  const header = document.createElement('div');
  header.className = 'similar-songs-header';
  header.innerHTML = `
    <h3>🎵 Ähnliche Songs wie "${songTitle}"</h3>
    <p>Von ${artist} • Gefunden: ${songs.length} Tracks</p>
  `;
  universalContainer.appendChild(header);
  
  // Add songs
  songs.forEach(song => {
    const songElement = document.createElement('div');
    songElement.className = 'song';
    songElement.innerHTML = `
      <div class="song-title">${song.title}</div>
      <div class="song-artist">${song.artist}</div>
      <div class="song-album">${song.album || 'Unknown Album'}</div>
      <div class="song-duration">${formatTime(song.duration || 0)}</div>
    `;
    
    // Add double-click handler for loading into players
    songElement.addEventListener('dblclick', () => {
      // Find first available player (not playing)
      let targetPlayer: 'a' | 'b' | 'c' | 'd' | null = null;
      for (const side of ['a', 'b', 'c', 'd'] as const) {
        if (!playerStates[side].isPlaying) {
          targetPlayer = side;
          break;
        }
      }
      
      // If all players are playing, use player A
      if (!targetPlayer) {
        targetPlayer = 'a';
        console.log('All players busy, loading to player A');
      }
      
      console.log(`Loading similar song "${song.title}" to player ${targetPlayer.toUpperCase()}`);
      loadTrackToPlayer(targetPlayer, song, false);
    });
    
    universalContainer.appendChild(songElement);
  });
  
  console.log(`Displayed ${songs.length} similar songs for ${artist} in universal container`);
}

// Setup Volume Controls and Meters
function setupVolumeControls() {
  ['a', 'b', 'c', 'd'].forEach(side => {
    const volumeSlider = document.getElementById(`volume-${side}`) as HTMLInputElement;
    const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
    
    if (volumeSlider && audio) {
      // Volume slider event
      volumeSlider.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        const volume = parseFloat(target.value);
        audio.volume = volume;
        // Use existing updateVolumeMeter function with correct meter ID
        updateVolumeMeter(`volume-meter-${side}`, volume);
      });
      
      // Audio level monitoring for volume meter
      if (audio) {
        audio.addEventListener('play', () => {
          startVolumeMeterAnimation(side);
        });
        
        audio.addEventListener('pause', () => {
          stopVolumeMeterAnimation(side);
        });
        
        audio.addEventListener('ended', () => {
          stopVolumeMeterAnimation(side);
        });
      }
    }
  });
}

// Animate Volume Meter Based on Audio
function startVolumeMeterAnimation(side: string) {
  const meterId = `volume-meter-${side}`;
  if (volumeMeterIntervals[meterId]) {
    clearInterval(volumeMeterIntervals[meterId]);
  }
  
  const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
  if (!audio) return;
  
  volumeMeterIntervals[meterId] = setInterval(() => {
    if (audio.paused) {
      stopVolumeMeterAnimation(side);
      return;
    }
    
    // Simulate audio level animation
    const baseLevel = audio.volume;
    const randomVariation = Math.random() * 0.3;
    const currentLevel = Math.min(1, baseLevel + randomVariation);
    
    updateVolumeMeter(meterId, currentLevel);
  }, 100);
}

function stopVolumeMeterAnimation(side: string) {
  const meterId = `volume-meter-${side}`;
  if (volumeMeterIntervals[meterId]) {
    clearInterval(volumeMeterIntervals[meterId]);
    delete volumeMeterIntervals[meterId];
  }
  
  // Reset meter to show only volume level
  const volumeSlider = document.getElementById(`volume-${side}`) as HTMLInputElement;
  if (volumeSlider) {
    updateVolumeMeter(meterId, parseFloat(volumeSlider.value));
  }
}

// Consolidated Player System Initialization
function initializePlayerSystem() {
  // 1. Initialize deck HTML first
  initializePlayerDecks();
  
  // 2. Setup audio elements for all 4 players
  const audioA = document.getElementById('audio-a') as HTMLAudioElement;
  const audioB = document.getElementById('audio-b') as HTMLAudioElement;
  const audioC = document.getElementById('audio-c') as HTMLAudioElement;
  const audioD = document.getElementById('audio-d') as HTMLAudioElement;
  
  if (audioA) {
    setupAudioPlayer('a', audioA);
  }
  
  if (audioB) {
    setupAudioPlayer('b', audioB);
  }
  
  if (audioC) {
    setupAudioPlayer('c', audioC);
  }
  
  if (audioD) {
    setupAudioPlayer('d', audioD);
  }
  
  // 3. Initialize crossfader functionality
  initializeCrossfader();
  
  // 4. Setup drop zones for drag & drop
  initializePlayerDropZones();
  
  // 5. Setup album cover drag & drop
  setupAlbumCoverDragDrop();
  
  // 6. Setup queue drop zone
  setupQueueDropZone();
  
  // 7. Setup auto-queue controls
  setupAutoQueueControls();
  
  console.log('Complete player system initialized');
}

// Update Album Cover Function
function updateAlbumCover(side: 'a' | 'b' | 'c' | 'd', song: OpenSubsonicSong) {
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

// Drag & Drop functionality for album covers
function setupAlbumCoverDragDrop() {
  const sides: ('a' | 'b' | 'c' | 'd')[] = ['a', 'b', 'c', 'd'];
  
  sides.forEach(side => {
    const albumCover = document.getElementById(`album-cover-${side}`);
    if (!albumCover) return;
    
    // Make album cover draggable when it has content
    function updateDragability() {
      const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
      const hasTrack = audio && audio.src && !audio.paused;
      const hasLoadedTrack = audio && audio.src && audio.readyState >= 1;
      
      if (!albumCover) return;
      
      if (hasLoadedTrack) {
        albumCover.draggable = true;
        albumCover.style.cursor = hasTrack ? 'not-allowed' : 'grab';
      } else {
        albumCover.draggable = false;
        albumCover.style.cursor = 'default';
      }
    }
    
    // Update dragability when track state changes
    const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
    if (audio) {
      audio.addEventListener('loadstart', updateDragability);
      audio.addEventListener('play', updateDragability);
      audio.addEventListener('pause', updateDragability);
      audio.addEventListener('ended', updateDragability);
    }
    
    albumCover.addEventListener('dragstart', (e) => {
      const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
      
      // Prevent drag if track is playing
      if (audio && !audio.paused) {
        e.preventDefault();
        albumCover.style.cursor = 'not-allowed';
        return;
      }
      
      // Check if there's actually a track loaded
      if (!audio || !audio.src || audio.readyState < 1) {
        e.preventDefault();
        return;
      }
      
      albumCover.style.cursor = 'grabbing';
      if (e.dataTransfer) {
        // Get the song data for this deck
        const song = deckSongs[side];
        console.log(`🎵 Drag start from deck ${side.toUpperCase()}, song data:`, song);
        if (song) {
          // Set JSON data with song object
          const dragData = {
            type: 'deck-song',
            song: song,
            sourceDeck: side
          };
          e.dataTransfer.setData('application/json', JSON.stringify(dragData));
          console.log(`🎵 Dragging track from deck ${side.toUpperCase()}: "${song.title}"`);
        } else {
          console.warn(`❌ No song data found for deck ${side.toUpperCase()}`);
        }
        
        // Fallback text data for backwards compatibility
        e.dataTransfer.setData('text/plain', side);
        e.dataTransfer.effectAllowed = 'move';
      }
      
      // Add visual feedback
      albumCover.style.opacity = '0.5';
    });
    
    albumCover.addEventListener('dragend', () => {
      albumCover.style.opacity = '1';
      updateDragability();
    });
    
    // Set up drop zones
    albumCover.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
      }
      albumCover.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    });
    
    albumCover.addEventListener('dragleave', () => {
      albumCover.style.backgroundColor = '';
    });
    
    albumCover.addEventListener('drop', (e) => {
      e.preventDefault();
      albumCover.style.backgroundColor = '';
      
      if (!e.dataTransfer) return;
      
      const sourceSide = e.dataTransfer.getData('text/plain') as 'a' | 'b' | 'c' | 'd';
      const targetSide = side;
      
      if (sourceSide === targetSide) return; // Same deck
      
      // Check if source track is playing
      const sourceAudio = document.getElementById(`audio-${sourceSide}`) as HTMLAudioElement;
      if (sourceAudio && !sourceAudio.paused) {
        console.log('Cannot move playing track');
        return;
      }
      
      // Check if target has a playing track
      const targetAudio = document.getElementById(`audio-${targetSide}`) as HTMLAudioElement;
      if (targetAudio && !targetAudio.paused) {
        console.log('Cannot drop on deck with playing track');
        return;
      }
      
      console.log(`🔄 Moving track from deck ${sourceSide.toUpperCase()} to deck ${targetSide.toUpperCase()}`);
      
      // Get source track data from stored songs
      const song = deckSongs[sourceSide];
      if (!song) {
        console.error('No song data found on source deck');
        return;
      }
      
      console.log(`📀 Found song: "${song.title}" by ${song.artist}`);
      
      // Load track on target deck using the same method as drag from search
      loadTrackToPlayer(targetSide, song, false);
      console.log(`✅ Track "${song.title}" moved from deck ${sourceSide.toUpperCase()} to deck ${targetSide.toUpperCase()}`);
      
      // Clear source deck
      setTimeout(() => {
        clearPlayerDeck(sourceSide);
      }, 100);
    });
    
    // Initial dragability check
    updateDragability();
  });
}

// Update Time Display Function
function updateTimeDisplay(side: 'a' | 'b' | 'c' | 'd', currentTime: number, duration: number) {
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
const waveSurfers: { [key in 'a' | 'b' | 'c' | 'd']?: WaveSurfer } = {};

// Initialize WaveSurfer for a player with adaptive settings
function initializeWaveSurfer(side: 'a' | 'b' | 'c' | 'd', trackDuration?: number): WaveSurfer {
  const container = document.getElementById(`waveform-${side}`);
  if (!container) {
    throw new Error(`Waveform container not found for ${side} player`);
  }

  // Destroy existing wavesurfer if it exists
  if (waveSurfers[side]) {
    waveSurfers[side]!.destroy();
  }

  // Adaptive settings based on track duration
  let barWidth = 2;
  let barGap = 1;
  
  // For very long tracks (>10 minutes), reduce detail for better performance
  if (trackDuration && trackDuration > 600) {
    barWidth = 1;
    barGap = 0;
    console.log(`🎵 Long track detected (${Math.round(trackDuration/60)}min), using optimized waveform settings`);
  }

  // Deck-specific colors using CSS variables
  const getPlayerColor = (playerSide: string, variant: 'main' | 'dark' = 'main'): string => {
    const colorMap = {
      'a': variant === 'main' ? '#ff4444' : '#cc0000',
      'b': variant === 'main' ? '#4488ff' : '#2266dd', 
      'c': variant === 'main' ? '#ffdd44' : '#ddbb00',
      'd': variant === 'main' ? '#44ff88' : '#22dd66'
    };
    return colorMap[playerSide as keyof typeof colorMap] || '#666666';
  };
  
  const waveColor = getPlayerColor(side);
  const progressColor = getPlayerColor(side, 'dark');

  // Create new WaveSurfer instance with performance optimizations
  const wavesurfer = WaveSurfer.create({
    container: container,
    waveColor: waveColor,
    progressColor: progressColor,
    cursorColor: '#ffffff',
    barWidth: barWidth,
    barGap: barGap,
    height: 104, // 80px + 30% = 104px for bottom overflow
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
function resetWaveform(side: 'a' | 'b' | 'c' | 'd') {
  const wavesurfer = waveSurfers[side];
  if (wavesurfer) {
    // Stop playback and reset to beginning
    wavesurfer.stop();
    wavesurfer.seekTo(0);
    console.log(`Waveform reset for ${side} player`);
  }
}

// Completely clear WaveSurfer (for eject)
function clearWaveform(side: 'a' | 'b' | 'c' | 'd') {
  const wavesurfer = waveSurfers[side];
  if (wavesurfer) {
    // Destroy the waveform completely
    wavesurfer.destroy();
    delete waveSurfers[side];
    
    // Clear the container visually
    const container = document.getElementById(`waveform-${side}`);
    if (container) {
      container.innerHTML = '';
      container.style.opacity = '1';
      
      // Remove any lingering error indicators
      const errorIndicator = document.getElementById(`waveform-error-${side}`);
      if (errorIndicator && errorIndicator.parentNode) {
        errorIndicator.remove();
      }
    }
    
    console.log(`🗑️ Waveform completely cleared for ${side} player`);
  }
}

// Load audio file into WaveSurfer for a player
function loadWaveform(side: 'a' | 'b' | 'c' | 'd', audioUrl: string, trackDuration?: number) {
  console.log(`Loading new waveform for ${side} player from: ${audioUrl}`);
  
  // Reset existing waveform first
  resetWaveform(side);
  
  // Initialize WaveSurfer if not exists (with adaptive settings)
  if (!waveSurfers[side]) {
    initializeWaveSurfer(side, trackDuration);
  }

  const wavesurfer = waveSurfers[side]!;
  const container = document.getElementById(`waveform-${side}`);
  
  // Add loading indicator
  if (container) {
    container.style.position = 'relative';
    const loadingIndicator = document.createElement('div');
    loadingIndicator.id = `waveform-loading-${side}`;
    loadingIndicator.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: #00ff88;
      font-size: 12px;
      z-index: 10;
      pointer-events: none;
    `;
    loadingIndicator.textContent = 'Loading waveform...';
    container.appendChild(loadingIndicator);
  }

  // Progressive loading events
  let loadingProgress = 0;
  
  wavesurfer.on('loading', (percent: number) => {
    loadingProgress = percent;
    console.log(`🌊 Waveform loading for ${side}: ${percent}%`);
    
    const loadingElement = document.getElementById(`waveform-loading-${side}`);
    if (loadingElement) {
      loadingElement.textContent = `Loading waveform... ${Math.round(percent)}%`;
    }
    
    // Show partial waveform as it loads (visual feedback)
    if (percent > 10) {
      const container = document.getElementById(`waveform-${side}`);
      if (container) {
        container.style.opacity = `${Math.min(percent / 100 + 0.3, 1)}`;
      }
    }
  });

  wavesurfer.on('ready', () => {
    console.log(`✅ Waveform ready for ${side} player - progress reset to 0`);
    
    // Remove loading indicator
    const loadingElement = document.getElementById(`waveform-loading-${side}`);
    if (loadingElement) {
      loadingElement.remove();
    }
    
    // Ensure full opacity
    const container = document.getElementById(`waveform-${side}`);
    if (container) {
      container.style.opacity = '1';
    }
    
    // Ensure we're at the beginning
    wavesurfer.seekTo(0);
  });

  wavesurfer.on('error', (error) => {
    console.error(`❌ Waveform error for ${side} player:`, error);
    
    // Remove loading indicator on error
    const loadingElement = document.getElementById(`waveform-loading-${side}`);
    if (loadingElement) {
      loadingElement.remove();
    }
    
    // Show temporary error state (2 seconds)
    const container = document.getElementById(`waveform-${side}`);
    if (container) {
      container.style.opacity = '0.5';
      const errorIndicator = document.createElement('div');
      errorIndicator.id = `waveform-error-${side}`;
      errorIndicator.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        color: #ff4444;
        font-size: 12px;
        z-index: 10;
        font-weight: bold;
      `;
      errorIndicator.textContent = 'Waveform load failed - retrying...';
      container.appendChild(errorIndicator);
      
      // Remove error message after 2 seconds and retry
      setTimeout(() => {
        if (errorIndicator && errorIndicator.parentNode) {
          errorIndicator.remove();
        }
        container.style.opacity = '1';
        
        // Retry loading the waveform
        console.log(`🔄 Retrying waveform load for ${side} player`);
        setTimeout(() => {
          try {
            wavesurfer.load(audioUrl);
          } catch (retryError) {
            console.error(`❌ Retry failed for ${side} waveform:`, retryError);
          }
        }, 500); // Small delay before retry
      }, 2000);
    }
  });

  // Load the new audio file - this will trigger the loading events
  wavesurfer.load(audioUrl);
}

// Sync WaveSurfer with HTML audio element
// WaveSurfer Synchronisation (currently unused, but kept for future enhancement)
function syncWaveSurferWithAudio(side: 'a' | 'b' | 'c' | 'd', audio: HTMLAudioElement) {
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
function cleanupWaveSurferSync(side: 'a' | 'b' | 'c' | 'd') {
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

// Enhanced Queue System with Deck Tracking
interface QueueItem {
  song: OpenSubsonicSong;
  assignedToDeck?: 'a' | 'b' | 'c' | 'd' | null; // null = available, deck = loaded to that deck
  loadedAt?: Date; // When it was loaded to a deck
}

let queue: QueueItem[] = [];
let autoQueueEnabled = true; // Auto-Queue standardmäßig aktiviert

// Auto-Queue System State
let autoQueueConfig = {
  deckPairAB: true,    // A+B Deck-Pair aktiv
  deckPairCD: false,   // C+D Deck-Pair aktiv
  lastPlayedDeck: null as 'a' | 'b' | 'c' | 'd' | null,  // Letztes gespieltes Deck für Rotation
  playbackOrder: ['a', 'b', 'c', 'd'] as ('a' | 'b' | 'c' | 'd')[],  // Playback-Reihenfolge
  isAutoPlaying: false  // Verhindert mehrfache Auto-Plays
};

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
  
  // Monitor-Crossfader (für Speaker/Kopfhörer)
  crossfaderGain.a.gain.value = leftGain;
  crossfaderGain.b.gain.value = rightGain;
  
  // Stream-Crossfader (für Live-Stream) - gleiche Werte
  streamCrossfaderGain.a.gain.value = leftGain;
  streamCrossfaderGain.b.gain.value = rightGain;
  
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
      // Don't show error message if no credentials are set - this is expected on first run
      console.log('⚠️ Stream credentials not configured - streaming will not be available');
      return false;
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
  
  // Panel schließen
  cancelBtn?.addEventListener('click', () => {
    loadStreamConfig(); // Änderungen verwerfen
    if (configPanel) {
      configPanel.style.display = 'none';
    }
  });
  
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
  const usernameInput = document.getElementById('stream-username') as HTMLInputElement;
  const passwordInput = document.getElementById('stream-password') as HTMLInputElement;
  const bitrateSelect = document.getElementById('stream-bitrate') as HTMLSelectElement;
  
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
  const originalServerUrl = envStreamServer || '';
  const useProxy = import.meta.env.VITE_USE_PROXY === 'true';
  
  if (urlInput) {
    urlInput.value = originalServerUrl;
    // Hinweis anzeigen wenn Proxy verwendet wird
    if (useProxy) {
      urlInput.title = `Using CORS Proxy: ${streamConfig.serverUrl}`;
      urlInput.style.borderColor = '#4CAF50';
    }
  }
  if (usernameInput) usernameInput.value = finalUsername || '';
  if (passwordInput) passwordInput.value = finalPassword || '';
  if (bitrateSelect) bitrateSelect.value = streamConfig.bitrate.toString();
  
  // Server-Konfiguration verstecken wenn in .env definiert
  if (envStreamServer) {
    const serverGroup = document.querySelector('.config-group:has(#stream-server-url)') as HTMLElement;
    if (serverGroup) serverGroup.style.display = 'none';
  }
  
  // Credential-Felder verstecken wenn bereits über .env gefüllt
  if (finalUsername) {
    const usernameGroup = document.querySelector('.config-group:has(#stream-username)') as HTMLElement;
    if (usernameGroup) usernameGroup.style.display = 'none';
  }
  
  if (finalPassword) {
    const passwordGroup = document.querySelector('.config-group:has(#stream-password)') as HTMLElement;
    if (passwordGroup) passwordGroup.style.display = 'none';
  }
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
  const usernameInput = document.getElementById('stream-username') as HTMLInputElement;
  const passwordInput = document.getElementById('stream-password') as HTMLInputElement;
  const bitrateSelect = document.getElementById('stream-bitrate') as HTMLSelectElement;
  
  // Neue Konfiguration sammeln (nur relevante Parameter)
  const newConfig: Partial<StreamConfig> = {
    bitrate: parseInt(bitrateSelect?.value) || streamConfig.bitrate,
  };
  
  // Server URL nur übernehmen wenn nicht über .env gesetzt
  if (urlInput?.value && !import.meta.env.VITE_STREAM_SERVER) {
    // Hier würde normalerweise die Server URL gesetzt werden
    // Aber da wir getStreamServerUrl() verwenden, überlassen wir das der Funktion
  }
  
  // Username/Password nur übernehmen wenn nicht über .env gesetzt
  if (usernameInput?.value && !import.meta.env.VITE_STREAM_USERNAME) {
    newConfig.username = usernameInput.value;
  }
  
  if (passwordInput?.value && !import.meta.env.VITE_STREAM_PASSWORD) {
    newConfig.password = passwordInput.value;
  }
  
  // Validierung
  if (!streamConfig.password && !newConfig.password) {
    alert('Please fill in password');
    return;
  }
  
  // Konfiguration aktualisieren
  streamConfig = { ...streamConfig, ...newConfig };
  
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

// Library Initialization
function initializeLibrary() {
  console.log('🎵 Initializing Music Library...');
  
  // Tab Navigation
  initializeTabs();
  
  // Search Funktionalität
  initializeSearch();
  
  // Queue Drag & Drop (permanent initialisieren)
  initializeQueuePermanent();
  
  // Complete Player System initialisieren
  initializePlayerSystem();
  
  // Rating-Event-Listeners initialisieren
  initializeRatingListeners();
}

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
      ).join('<span class="artist-separator"> • </span>');
      
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
  trackItem.className = 'music-card song-row';
  trackItem.dataset.songId = song.id;
  trackItem.dataset.coverArt = song.coverArt || '';
  trackItem.dataset.type = 'song';
  
  const duration = formatDuration(song.duration);
  const coverUrl = song.coverArt && openSubsonicClient ? openSubsonicClient.getCoverArtUrl(song.coverArt, 40) : '';
  
  // Modern row layout für Song-Listen
  trackItem.innerHTML = `
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
  `;
  
  // Drag and Drop aktivieren
  trackItem.draggable = true;
  trackItem.addEventListener('dragstart', (e) => {
    if (e.dataTransfer) {
      // Set JSON data (preferred)
      e.dataTransfer.setData('application/json', JSON.stringify({
        type: 'song',
        song: song,
        sourceUrl: openSubsonicClient?.getStreamUrl(song.id)
      }));
      // Set song ID as text/plain for fallback compatibility
      e.dataTransfer.setData('text/plain', song.id);
      e.dataTransfer.effectAllowed = 'copy';
    }
  });
  
  return trackItem;
}

// Container function for song lists
function createUnifiedSongsContainer(songs: OpenSubsonicSong[], context: 'search' | 'album' | 'queue' = 'album'): HTMLElement {
  const container = document.createElement('div');
  container.className = 'songs-container';
  
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
    <div class="music-card song-row" draggable="true" data-song-id="${song.id}" data-cover-art="${song.coverArt || ''}" data-type="song">
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
  updatePlayerRating('a', songId, rating);
  updatePlayerRating('b', songId, rating);
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
  const trackItems = container.querySelectorAll('.track-item, .track-item-oneline, .song-row, .unified-song-item');
  const albumItems = container.querySelectorAll('.album-item-modern[draggable="true"]');
  
  console.log(`Adding drag listeners to ${trackItems.length} track items and ${albumItems.length} album items`);
  
  trackItems.forEach((item, index) => {
    item.addEventListener('dragstart', (e: Event) => {
      const dragEvent = e as DragEvent;
      const target = e.target as HTMLElement;
      target.classList.add('dragging');
      console.log(`Drag started for track item ${index}, song ID: ${target.dataset.songId}`);
      
      if (dragEvent.dataTransfer) {
        // Set song ID as both text/plain and as JSON data for compatibility
        dragEvent.dataTransfer.setData('text/plain', target.dataset.songId || '');
        dragEvent.dataTransfer.effectAllowed = 'copy';
        
        // Also set JSON data if we have the song info
        const songId = target.dataset.songId;
        if (songId) {
          dragEvent.dataTransfer.setData('application/json', JSON.stringify({
            type: 'song',
            songId: songId
          }));
        }
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
    
    // Debug-Event für Mousedown
    element.addEventListener('mousedown', () => {
      console.log(`Album mousedown: ${albumName}`);
    });
  });
  
  // Direct Song Click Listeners (double-click to load to player)
  const songElements = container.querySelectorAll('.track-item, .track-item-oneline, .song-row, .unified-song-item');
  console.log(`Found ${songElements.length} clickable songs`);
  
  songElements.forEach((element, index) => {
    const songId = (element as HTMLElement).dataset.songId;
    const songTitle = (element as HTMLElement).dataset.songTitle || 
                     (element as HTMLElement).querySelector('.track-title')?.textContent || 
                     'Unknown Song';
    
    console.log(`Setting up song click ${index}: ${songTitle} (ID: ${songId})`);
    
    // Double-click to load song to available player
    element.addEventListener('dblclick', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (!songId) {
        console.error('No song ID found for clicked song');
        return;
      }
      
      console.log(`Song double-clicked: ${songTitle} (ID: ${songId})`);
      
      try {
        // Find song in current songs list
        const song = findSongById(songId);
        if (!song) {
          console.error('Could not find song in current songs');
          return;
        }
        
        // Find first available player (not playing)
        let targetPlayer: 'a' | 'b' | 'c' | 'd' | null = null;
        for (const side of ['a', 'b', 'c', 'd'] as const) {
          if (!playerStates[side].isPlaying) {
            targetPlayer = side;
            break;
          }
        }
        
        // If all players are playing, use player A
        if (!targetPlayer) {
          targetPlayer = 'a';
          console.log('All players busy, loading to player A');
        }
        
        console.log(`Loading song to player ${targetPlayer.toUpperCase()}`);
        loadTrackToPlayer(targetPlayer, song, false);
        
      } catch (error) {
        console.error('Error loading song to player:', error);
      }
    });
    
    // Single click for selection feedback
    element.addEventListener('click', (e) => {
      // Only handle if not clicking on artist/album links
      const target = e.target as HTMLElement;
      if (target.classList.contains('clickable-artist') || target.classList.contains('clickable-album')) {
        return; // Let artist/album clicks handle normally
      }
      
      // Visual feedback for song selection
      const allSongs = container.querySelectorAll('.track-item, .track-item-oneline, .song-row, .unified-song-item');
      allSongs.forEach(song => song.classList.remove('selected'));
      element.classList.add('selected');
      
      console.log(`Song selected: ${songTitle} (Double-click to load to player)`);
    });
  });
}

// Album Click Listeners hinzuf�gen
function addAlbumClickListeners(container: Element) {
  // Support both modern library and legacy album items
  const albumItems = container.querySelectorAll('.album-item, .album-item-modern, .album-card.clickable');
  console.log(`Adding album click listeners to ${albumItems.length} albums in container:`, container);
  
  albumItems.forEach((item, index) => {
    const albumId = (item as HTMLElement).dataset.albumId;
    console.log(`Setting up album ${index}: ID=${albumId}`);
    
    // Check if the container is being dragged to prevent conflicts
    const scrollContainer = item.closest('.horizontal-scroll');
    
    // Entferne vorherige Listener falls vorhanden
    const clonedItem = item.cloneNode(true);
    item.parentNode?.replaceChild(clonedItem, item);
    
    clonedItem.addEventListener('click', async (e) => {
      // Don't handle click if we're in drag mode
      if (scrollContainer && scrollContainer.classList.contains('dragging')) {
        return;
      }
      
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
async function addToQueue(songId: string): Promise<void>;
async function addToQueue(song: OpenSubsonicSong): Promise<void>;
async function addToQueue(songOrId: string | OpenSubsonicSong): Promise<void> {
  let song: OpenSubsonicSong | undefined;
  
  if (typeof songOrId === 'string') {
    const songId = songOrId;
    console.log('Adding song to queue:', songId);
    
    // Finde Song in aktuellen Listen
    song = currentSongs.find(s => s.id === songId);
    
    if (!song) {
      // Wenn nicht gefunden, versuche �ber Search Results zu finden
      const searchResults = document.querySelectorAll('.track-item, .song-row, .unified-song-item');
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
  } else {
    song = songOrId;
    console.log(`Adding song object to queue: "${song.title}"`);
  }
  
  if (song) {
    // Check if song already exists in queue
    const existingIndex = queue.findIndex(item => item.song.id === song.id);
    if (existingIndex !== -1) {
      console.log(`🔄 Song "${song.title}" already in queue, moving to end`);
      // Remove existing and add to end
      queue.splice(existingIndex, 1);
    }
    
    // Create new queue item (not assigned to any deck yet)
    const queueItem: QueueItem = {
      song: song,
      assignedToDeck: null,
      loadedAt: undefined
    };
    
    queue.push(queueItem);
    updateQueueDisplay();
    console.log(`➕ Song "${song.title}" added to queue. Queue length: ${queue.length}`);
  }
}

// Queue Anzeige aktualisieren
function updateQueueDisplay() {
  // Alle Queue-Container aktualisieren
  const queueContainers = document.querySelectorAll('.queue-items');
  
  queueContainers.forEach(queueContainer => {
    if (queue.length === 0) {
      queueContainer.innerHTML = `
        <div class="queue-empty">
          <span class="material-icons">queue_music</span>
          <p>Drop songs here to queue them</p>
        </div>
      `;
      return;
    }
    
    // Clear container and add unified song elements
    queueContainer.innerHTML = '';
    
    queue.forEach((queueItem, index) => {
      // Create unified song element from the song within the queue item
      const songElement = createUnifiedSongElement(queueItem.song, 'queue');
      
      // Add queue-specific wrapper
      const queueWrapper = document.createElement('div');
      queueWrapper.className = 'queue-item-wrapper';
      queueWrapper.dataset.queueIndex = index.toString();
      
      // Add deck indicator if assigned
      if (queueItem.assignedToDeck) {
        queueWrapper.classList.add('assigned-to-deck');
        queueWrapper.dataset.assignedDeck = queueItem.assignedToDeck;
      }
      
      // Add queue number
      const queueNumber = document.createElement('div');
      queueNumber.className = 'queue-number';
      queueNumber.textContent = (index + 1).toString();
      
      // Add remove button
      const removeButton = document.createElement('button');
      removeButton.className = 'queue-remove';
      removeButton.innerHTML = '<span class="material-icons">close</span>';
      removeButton.title = 'Remove from queue';
      removeButton.onclick = () => removeFromQueue(index);
      
      // Assemble wrapper
      queueWrapper.appendChild(queueNumber);
      queueWrapper.appendChild(songElement);
      queueWrapper.appendChild(removeButton);
      
      // Setup drag for queue item
      setupQueueItemDrag(queueWrapper, index);
      
      queueContainer.appendChild(queueWrapper);
    });
  });
  
  // Auto-prepare decks when queue gets new songs
  checkAndPrepareDecksAfterQueueUpdate();
}

// Check and prepare decks automatically when queue is updated
function checkAndPrepareDecksAfterQueueUpdate() {
  // Only proceed if queue has songs
  if (queue.length === 0) {
    return;
  }
  
  // Check all decks for opportunities to prepare
  const allDecks: ('a' | 'b' | 'c' | 'd')[] = ['a', 'b', 'c', 'd'];
  
  for (const deck of allDecks) {
    // Skip if auto-queue is not active for this deck
    if (!isAutoQueueActiveForDeck(deck)) {
      continue;
    }
    
    // Note: Preparation now happens automatically in handleAutoQueue
    // No need for manual preparation here
  }
}

function setupQueueItemDrag(wrapper: HTMLElement, index: number) {
  // Make the wrapper draggable
  wrapper.draggable = true;
  
  wrapper.addEventListener('dragstart', (e) => {
    const song = queue[index];
    if (!song) return;
    
    wrapper.style.opacity = '0.5';
    if (e.dataTransfer) {
      // Store both song data and queue index for removal after successful drop
      e.dataTransfer.setData('application/json', JSON.stringify({
        type: 'queue-song',
        song: song,
        queueIndex: index
      }));
      e.dataTransfer.effectAllowed = 'move';
    }
  });
  
  wrapper.addEventListener('dragend', () => {
    wrapper.style.opacity = '1';
  });
}

// Setup Queue as Drop Zone
function setupQueueDropZone() {
  const queuePanel = document.querySelector('.queue-panel');
  const queueList = document.getElementById('queue-list');
  
  if (!queuePanel || !queueList) {
    console.warn('Queue panel or list not found');
    return;
  }
  
  // Make queue panel a drop zone
  queuePanel.addEventListener('dragover', (e) => {
    const dragEvent = e as DragEvent;
    dragEvent.preventDefault();
    queuePanel.classList.add('drag-over');
    if (dragEvent.dataTransfer) {
      dragEvent.dataTransfer.dropEffect = 'copy';
    }
  });
  
  queuePanel.addEventListener('dragleave', (e) => {
    const dragEvent = e as DragEvent;
    // Only remove highlight if we're leaving the queue panel completely
    if (!queuePanel.contains(dragEvent.relatedTarget as Node)) {
      queuePanel.classList.remove('drag-over');
    }
  });
  
  queuePanel.addEventListener('drop', async (e) => {
    const dragEvent = e as DragEvent;
    dragEvent.preventDefault();
    queuePanel.classList.remove('drag-over');
    
    if (!dragEvent.dataTransfer) return;
    
    try {
      // Try to get JSON data first (from search results or queue items)
      const jsonData = dragEvent.dataTransfer.getData('application/json');
      if (jsonData) {
        const dragData = JSON.parse(jsonData);
        console.log('Dropped on queue:', dragData);
        
        if (dragData.type === 'song' && dragData.song) {
          await addToQueue(dragData.song);
        } else if (dragData.type === 'track' && dragData.track) {
          await addToQueue(dragData.track);
        } else if (dragData.type === 'queue-song' && dragData.song) {
          // Moving within queue - just add to end and remove from original position
          await addToQueue(dragData.song);
          // Don't remove original as addToQueue handles duplicates
        } else if (dragData.type === 'deck-song' && dragData.song) {
          // Dragging from deck to queue
          console.log(`🎵 Adding track from deck ${dragData.sourceDeck?.toUpperCase()} to queue: "${dragData.song.title}"`);
          await addToQueue(dragData.song);
        }
        return;
      }
      
      // Fallback to deck data (from album cover drag)
      const deckSide = dragEvent.dataTransfer.getData('text/plain') as 'a' | 'b' | 'c' | 'd';
      if (deckSide && ['a', 'b', 'c', 'd'].includes(deckSide)) {
        const song = deckSongs[deckSide];
        if (song) {
          console.log(`🎵 Adding track from deck ${deckSide.toUpperCase()} to queue: "${song.title}"`);
          await addToQueue(song);
        } else {
          console.warn(`No song found on deck ${deckSide}`);
        }
        return;
      }
      
      // Fallback to song ID
      const songId = dragEvent.dataTransfer.getData('text/plain');
      if (songId) {
        await addToQueue(songId);
      }
      
    } catch (error) {
      console.error('Error processing queue drop:', error);
    }
  });
}

// Setup Auto-Queue Controls
function setupAutoQueueControls() {
  const abButton = document.getElementById('auto-queue-ab') as HTMLButtonElement;
  const cdButton = document.getElementById('auto-queue-cd') as HTMLButtonElement;
  
  if (!abButton || !cdButton) {
    console.warn('Auto-queue buttons not found');
    return;
  }
  
  // Update button states based on current config
  const updateButtonStates = () => {
    abButton.classList.toggle('active', autoQueueConfig.deckPairAB);
    cdButton.classList.toggle('active', autoQueueConfig.deckPairCD);
    
    // Icons bleiben konstant - nur CSS-Klassen ändern sich für Styling
    // Kein Text-Update nötig, da A+B und C+D konstant bleiben sollen
    
    console.log(`Auto-Queue Config: A+B=${autoQueueConfig.deckPairAB}, C+D=${autoQueueConfig.deckPairCD}`);
  };
  
  // A+B Button Click Handler
  abButton.addEventListener('click', () => {
    autoQueueConfig.deckPairAB = !autoQueueConfig.deckPairAB;
    updateButtonStates();
    
    if (autoQueueConfig.deckPairAB) {
      console.log('🎵 Auto-Queue enabled for Deck A+B');
      // Immediate preparation: check if A or B is playing and prepare the other
      prepareDecksOnActivation(['a', 'b']);
    } else {
      console.log('⏸️ Auto-Queue disabled for Deck A+B');
    }
  });
  
  // C+D Button Click Handler  
  cdButton.addEventListener('click', () => {
    autoQueueConfig.deckPairCD = !autoQueueConfig.deckPairCD;
    updateButtonStates();
    
    if (autoQueueConfig.deckPairCD) {
      console.log('🎵 Auto-Queue enabled for Deck C+D');
      // Immediate preparation: check if C or D is playing and prepare the other
      prepareDecksOnActivation(['c', 'd']);
    } else {
      console.log('⏸️ Auto-Queue disabled for Deck C+D');
    }
  });
  
  // Initial state update
  updateButtonStates();
}

// Prepare decks immediately when auto-queue is activated
function prepareDecksOnActivation(deckPair: ('a' | 'b' | 'c' | 'd')[]) {
  // Check if any deck in the pair is currently playing
  for (const deck of deckPair) {
    const audio = document.getElementById(`audio-${deck}`) as HTMLAudioElement;
    
    if (audio && !audio.paused && !audio.ended) {
      // This deck is playing - preparation handled automatically in Auto-Queue
      console.log(`🎵 Deck ${deck.toUpperCase()} is playing`);
      return; // Only prepare one deck
    }
  }
  
  // If no deck is playing, check if any deck has a loaded track
  for (const deck of deckPair) {
    const audio = document.getElementById(`audio-${deck}`) as HTMLAudioElement;
    
    if (audio && audio.src && audio.readyState >= 1) {
      // This deck has a track loaded - preparation handled automatically
      console.log(`🎵 Deck ${deck.toUpperCase()} has a track loaded`);
      return; // Only prepare one deck
    }
  }
  
  console.log(`📋 No active tracks in deck pair [${deckPair.join(', ').toUpperCase()}], waiting for manual start`);
}

// Handle Auto-Queue Logic when a track ends
function handleAutoQueue(finishedDeck: 'a' | 'b' | 'c' | 'd') {
  console.log(`🎯 Auto-Queue triggered: Deck ${finishedDeck.toUpperCase()} finished`);
  
  // IMPORTANT: Remove the finished track from queue first
  const finishedSong = getCurrentLoadedSong(finishedDeck);
  if (finishedSong) {
    removeQueueItemBySong(finishedSong);
  }
  
  // Prevent multiple simultaneous auto-plays
  if (autoQueueConfig.isAutoPlaying) {
    console.log('🔄 Auto-play already in progress, skipping');
    return;
  }
  
  // Check if queue has available songs for next track
  const availableItem = getNextAvailableQueueItem();
  if (!availableItem) {
    console.log('📭 No available songs in queue, no auto-play possible');
    return;
  }
  
  autoQueueConfig.isAutoPlaying = true;
  autoQueueConfig.lastPlayedDeck = finishedDeck;
  
  // STEP 1: Stop all other playing tracks immediately
  console.log('⏹️ Stopping all other decks...');
  stopAllOtherDecks(finishedDeck);
  
  // STEP 2: Wait a moment for stops to complete, then start next deck
  setTimeout(() => {
    try {
      // Determine next deck based on configuration
      const nextDeck = getNextDeck(finishedDeck);
      
      if (!nextDeck) {
        console.log('⏸️ No valid next deck found (all deck pairs disabled)');
        autoQueueConfig.isAutoPlaying = false;
        return;
      }
      
      // Start the next deck (load and play)
      console.log(`🎯 Auto-Queue: ${finishedDeck.toUpperCase()} → ${nextDeck.toUpperCase()}`);
      startNextDeckWithNewTrack(nextDeck);
      
      // STEP 3: Wait 2 seconds before preparing next deck to avoid race conditions
      setTimeout(() => {
        // Verify only one deck is playing before preparing next
        if (countPlayingDecks() <= 1) {
          prepareNextDeckInSequence(nextDeck);
        } else {
          console.log('⚠️ Multiple decks playing, skipping preparation');
        }
        
        // Reset auto-playing flag after everything is done
        autoQueueConfig.isAutoPlaying = false;
      }, 2000); // 2 second delay
      
    } catch (error) {
      console.error('❌ Error in Auto-Queue:', error);
      autoQueueConfig.isAutoPlaying = false;
    }
  }, 500); // 0.5 second delay for stop operations to complete
}

// Stop all decks except the specified one
function stopAllOtherDecks(exceptDeck: 'a' | 'b' | 'c' | 'd') {
  const allDecks: ('a' | 'b' | 'c' | 'd')[] = ['a', 'b', 'c', 'd'];
  
  allDecks.forEach(deck => {
    if (deck === exceptDeck) return; // Skip the finished deck
    
    const audio = document.getElementById(`audio-${deck}`) as HTMLAudioElement;
    if (audio && !audio.paused) {
      console.log(`⏹️ Stopping deck ${deck.toUpperCase()} for Auto-Queue`);
      audio.pause();
      
      // Update UI
      const playPauseBtn = document.getElementById(`play-pause-${deck}`) as HTMLButtonElement;
      if (playPauseBtn) {
        const icon = playPauseBtn.querySelector('.material-icons');
        if (icon) icon.textContent = 'play_arrow';
        playPauseBtn.classList.remove('playing');
      }
    }
  });
}

// Count how many decks are currently playing
function countPlayingDecks(): number {
  const allDecks: ('a' | 'b' | 'c' | 'd')[] = ['a', 'b', 'c', 'd'];
  let playingCount = 0;
  
  allDecks.forEach(deck => {
    const audio = document.getElementById(`audio-${deck}`) as HTMLAudioElement;
    if (audio && !audio.paused && !audio.ended) {
      playingCount++;
      console.log(`🎵 Deck ${deck.toUpperCase()} is playing`);
    }
  });
  
  console.log(`🔢 Total playing decks: ${playingCount}`);
  return playingCount;
}

// Get next available song from queue (not assigned to any deck)
function getNextAvailableQueueItem(): QueueItem | null {
  return queue.find(item => item.assignedToDeck === null) || null;
}

// Mark queue item as assigned to a deck
function assignQueueItemToDeck(queueItem: QueueItem, deck: 'a' | 'b' | 'c' | 'd') {
  queueItem.assignedToDeck = deck;
  queueItem.loadedAt = new Date();
  console.log(`📌 Assigned "${queueItem.song.title}" to deck ${deck.toUpperCase()}`);
  updateQueueDisplay();
}

// Remove queue item by song (when track finishes or gets ejected)
function removeQueueItemBySong(song: OpenSubsonicSong) {
  const index = queue.findIndex(item => item.song.id === song.id);
  if (index !== -1) {
    const removedItem = queue.splice(index, 1)[0];
    console.log(`🗑️ Removed "${removedItem.song.title}" from queue`);
    updateQueueDisplay();
    return removedItem;
  }
  return null;
}

// Start next deck with a new track from queue
function startNextDeckWithNewTrack(targetDeck: 'a' | 'b' | 'c' | 'd') {
  // Get next available queue item (not assigned to any deck)
  const nextQueueItem = getNextAvailableQueueItem();
  if (!nextQueueItem) {
    console.log(`📭 No available songs in queue to load onto deck ${targetDeck.toUpperCase()}`);
    return;
  }
  
  // Double-check that no other deck is playing before starting
  const playingCount = countPlayingDecks();
  if (playingCount > 0) {
    console.log(`⚠️ ${playingCount} deck(s) still playing, waiting before starting ${targetDeck.toUpperCase()}`);
    
    // Try again after a short delay
    setTimeout(() => {
      startNextDeckWithNewTrack(targetDeck);
    }, 1000);
    return;
  }
  
  console.log(`🔄 Loading and starting "${nextQueueItem.song.title}" on deck ${targetDeck.toUpperCase()}`);
  
  // Mark queue item as assigned to this deck
  assignQueueItemToDeck(nextQueueItem, targetDeck);
  
  // Load track with auto-play
  loadTrackToPlayer(targetDeck, nextQueueItem.song, true);
  
  console.log(`✅ Successfully started deck ${targetDeck.toUpperCase()}`);
}

// Prepare the next deck in sequence for seamless transitions
function prepareNextDeckInSequence(currentDeck: 'a' | 'b' | 'c' | 'd') {
  // Only prepare if we have available songs in queue
  const availableItem = getNextAvailableQueueItem();
  if (!availableItem) {
    console.log('📭 No available songs in queue to prepare');
    return;
  }
  
  // Determine what the next deck would be after current
  const nextDeck = getNextDeck(currentDeck);
  if (!nextDeck) return;
  
  // Check if the next deck is empty
  const audio = document.getElementById(`audio-${nextDeck}`) as HTMLAudioElement;
  if (audio && audio.src) {
    console.log(`🎵 Deck ${nextDeck.toUpperCase()} already has a track, no preparation needed`);
    return;
  }
  
  console.log(`🔄 Preparing "${availableItem.song.title}" on deck ${nextDeck.toUpperCase()}`);
  
  // Mark queue item as assigned to the next deck
  assignQueueItemToDeck(availableItem, nextDeck);
  
  // Load track without playing
  loadTrackToPlayer(nextDeck, availableItem.song, false);
}

// Determine the next deck based on configuration and rotation
function getNextDeck(finishedDeck: 'a' | 'b' | 'c' | 'd'): 'a' | 'b' | 'c' | 'd' | null {
  // Check which deck pairs are active
  const isABActive = autoQueueConfig.deckPairAB;
  const isCDActive = autoQueueConfig.deckPairCD;
  
  // If no deck pairs are active, return null
  if (!isABActive && !isCDActive) {
    return null;
  }
  
  // If only one deck pair is active, alternate within that pair
  if (isABActive && !isCDActive) {
    return finishedDeck === 'a' ? 'b' : 'a';
  }
  
  if (isCDActive && !isABActive) {
    return finishedDeck === 'c' ? 'd' : 'c';
  }
  
  // Both deck pairs are active - use full rotation A→B→C→D→A
  const rotationMap: Record<'a' | 'b' | 'c' | 'd', 'a' | 'b' | 'c' | 'd'> = {
    'a': 'b',
    'b': 'c', 
    'c': 'd',
    'd': 'a'
  };
  
  return rotationMap[finishedDeck];
}

// Check if auto-queue is active for a specific deck
function isAutoQueueActiveForDeck(deck: 'a' | 'b' | 'c' | 'd'): boolean {
  switch (deck) {
    case 'a':
    case 'b':
      return autoQueueConfig.deckPairAB;
    case 'c':
    case 'd':
      return autoQueueConfig.deckPairCD;
    default:
      return false;
  }
}

// Song aus Queue entfernen (manual removal by user)
function removeFromQueue(index: number) {
  if (index >= 0 && index < queue.length) {
    const removedItem = queue.splice(index, 1)[0];
    updateQueueDisplay();
    console.log(`Song "${removedItem.song.title}" removed from queue`);
  }
}

// Globale Funktion f�r HTML onclick
(window as any).removeFromQueue = removeFromQueue;

// OpenSubsonic Login initialisieren - Dynamic field visibility
function initializeOpenSubsonicLogin() {
  console.log('🔐 Initializing dynamic login form...');
  
  const loginBtn = document.getElementById('OpenSubsonic-login-btn') as HTMLButtonElement;
  const loginForm = document.getElementById('OpenSubsonic-login') as HTMLElement;
  const djControls = document.getElementById('dj-controls') as HTMLElement;
  
  // OpenSubsonic fields
  const usernameInput = document.getElementById('OpenSubsonic-username') as HTMLInputElement;
  const passwordInput = document.getElementById('OpenSubsonic-password') as HTMLInputElement;
  const serverInput = document.getElementById('OpenSubsonic-server') as HTMLInputElement;
  
  // Stream fields
  const streamServerInput = document.getElementById('stream-server-url') as HTMLInputElement;
  const streamUsernameInput = document.getElementById('stream-username') as HTMLInputElement;
  const streamPasswordInput = document.getElementById('stream-password') as HTMLInputElement;
  
  // Get all possible credentials from environment
  const envUrl = import.meta.env.VITE_OPENSUBSONIC_URL;
  const envUsername = import.meta.env.VITE_OPENSUBSONIC_USERNAME;
  const envPassword = import.meta.env.VITE_OPENSUBSONIC_PASSWORD;
  
  // Unified Login Configuration
  const useUnifiedLogin = import.meta.env.VITE_USE_UNIFIED_LOGIN === 'true';
  const unifiedUsername = import.meta.env.VITE_UNIFIED_USERNAME;
  const unifiedPassword = import.meta.env.VITE_UNIFIED_PASSWORD;
  
  // Streaming credentials
  const streamUsername = import.meta.env.VITE_STREAM_USERNAME;
  const streamPassword = import.meta.env.VITE_STREAM_PASSWORD;
  const streamServer = import.meta.env.VITE_STREAM_SERVER;
  
  // Determine final credentials (Unified has priority)
  const finalUsername = useUnifiedLogin ? unifiedUsername : envUsername;
  const finalPassword = useUnifiedLogin ? unifiedPassword : envPassword;
  const finalStreamUsername = useUnifiedLogin ? unifiedUsername : streamUsername;
  const finalStreamPassword = useUnifiedLogin ? unifiedPassword : streamPassword;
  
  // Pre-fill available values
  if (serverInput && envUrl) serverInput.value = envUrl;
  if (usernameInput && finalUsername) usernameInput.value = finalUsername;
  if (passwordInput && finalPassword) passwordInput.value = finalPassword;
  if (streamServerInput && streamServer) streamServerInput.value = streamServer;
  if (streamUsernameInput && finalStreamUsername) streamUsernameInput.value = finalStreamUsername;
  if (streamPasswordInput && finalStreamPassword) streamPasswordInput.value = finalStreamPassword;
  
  // Dynamic form visibility
  const openSubsonicSection = document.getElementById('opensubsonic-section') as HTMLElement;
  const streamSection = document.getElementById('stream-section') as HTMLElement;
  
  // Check what credentials are missing
  const missingFields: string[] = [];
  const availableFields: string[] = [];
  
  // OpenSubsonic status
  const openSubsonicComplete = envUrl && finalUsername && finalPassword;
  if (!openSubsonicComplete) {
    if (!envUrl) missingFields.push('OpenSubsonic Server');
    if (!finalUsername) missingFields.push('OpenSubsonic Username');
    if (!finalPassword) missingFields.push('OpenSubsonic Password');
  } else {
    availableFields.push('OpenSubsonic Complete');
  }
  
  // Stream status
  const streamComplete = streamServer && finalStreamUsername && finalStreamPassword;
  if (!streamComplete) {
    if (!streamServer) missingFields.push('Stream Server');
    if (!finalStreamUsername) missingFields.push('Stream Username');
    if (!finalStreamPassword) missingFields.push('Stream Password');
  } else {
    availableFields.push('Stream Complete');
  }
  
  // Hide sections that are completely configured
  if (openSubsonicComplete) {
    openSubsonicSection.style.display = 'none';
  }
  
  if (streamComplete) {
    streamSection.style.display = 'none';
  }
  
  // If unified login is used and credentials are shared, show info
  if (useUnifiedLogin && unifiedUsername) {
    const unifiedInfo = document.createElement('div');
    unifiedInfo.style.cssText = `
      background: rgba(76, 175, 80, 0.1);
      border: 1px solid #4CAF50;
      border-radius: 4px;
      padding: 8px;
      margin-bottom: 12px;
      color: #4CAF50;
      font-size: 11px;
      text-align: center;
    `;
    unifiedInfo.innerHTML = `🔐 Unified Login: ${unifiedUsername} (shared credentials)`;
    loginForm.querySelector('.login-form')?.prepend(unifiedInfo);
  }
  
  // Internal login function
  const performLogin = async (serverUrl: string, username: string, password: string) => {
    if (!username || !password) {
      console.log('❌ Please enter username and password');
      return;
    }
    
    try {
      console.log('🔄 Connecting to OpenSubsonic...');
      if (loginBtn) {
        loginBtn.disabled = true;
        loginBtn.textContent = 'Connecting...';
      }
      
      // Create OpenSubsonic Client with credentials
      openSubsonicClient = new SubsonicApiClient({
        serverUrl: serverUrl,
        username: username,
        password: password
      });
      
      const authenticated = await openSubsonicClient.authenticate();
      
      if (authenticated) {
        console.log("✅ OpenSubsonic connected successfully!");
        
        // Update stream configuration with stream credentials
        const streamUrl = streamServerInput.value.trim() || streamServer;
        const streamUser = streamUsernameInput.value.trim() || finalStreamUsername;
        const streamPass = streamPasswordInput.value.trim() || finalStreamPassword;
        
        if (streamUrl && streamUser && streamPass) {
          console.log('🔄 Configuring stream settings...');
          streamConfig.serverUrl = streamUrl;
          streamConfig.username = streamUser;
          streamConfig.password = streamPass;
          console.log('✅ Stream configuration updated');
        } else {
          console.log('⚠️ Stream credentials incomplete - streaming will not be available');
        }
        
        // Hide login form, show DJ controls
        loginForm.style.display = 'none';
        djControls.style.display = 'flex';
        
        // Initialize music library
        console.log("🎵 About to call initializeMusicLibrary...");
        await initializeMusicLibrary();
        console.log("🎵 Finished calling initializeMusicLibrary");
        
        console.log("📊 Final state check:");
        console.log("  - libraryBrowser exists:", !!libraryBrowser);
        console.log("  - browse-content element:", !!document.getElementById('browse-content'));
        console.log("  - openSubsonicClient exists:", !!openSubsonicClient);
        console.log("  - streamConfig:", streamConfig);
        
      } else {
        console.log('❌ Login failed - Wrong username or password');
        if (loginBtn) {
          loginBtn.textContent = 'Login Failed';
          setTimeout(() => {
            loginBtn.textContent = 'Connect';
            loginBtn.disabled = false;
          }, 2000);
        }
      }
      
    } catch (error) {
      console.error("❌ OpenSubsonic connection error:", error);
      if (loginBtn) {
        loginBtn.textContent = 'Connection Error';
        setTimeout(() => {
          loginBtn.textContent = 'Connect';
          loginBtn.disabled = false;
        }, 2000);
      }
    }
  };
  
  // Auto-login if all OpenSubsonic credentials are available
  if (envUrl && finalUsername && finalPassword) {
    console.log(`🔄 Auto-login with ${useUnifiedLogin ? 'unified' : 'individual'} credentials...`);
    performLogin(envUrl, finalUsername, finalPassword);
    return;
  }
  
  const performLoginFromForm = async () => {
    const username = usernameInput.value.trim() || finalUsername;
    const password = passwordInput.value.trim() || finalPassword;
    const serverUrl = serverInput.value.trim() || envUrl;
    
    if (!serverUrl) {
      console.log('❌ Please enter server URL');
      if (loginBtn) {
        loginBtn.textContent = 'Server URL Required';
        setTimeout(() => {
          loginBtn.textContent = 'Connect';
          loginBtn.disabled = false;
        }, 2000);
      }
      return;
    }
    
    await performLogin(serverUrl, username, password);
  };
  
  loginBtn?.addEventListener('click', performLoginFromForm);
  
  // Enter key in password fields
  passwordInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      performLoginFromForm();
    }
  });
  
  streamPasswordInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      performLoginFromForm();
    }
  });
}

// Audio Player Setup
function setupAudioPlayer(side: 'a' | 'b' | 'c' | 'd', audio: HTMLAudioElement) {
  const playPauseBtn = document.getElementById(`play-pause-${side}`) as HTMLButtonElement;
  const ejectBtn = document.getElementById(`eject-${side}`) as HTMLButtonElement;
  const restartBtn = document.getElementById(`restart-${side}`) as HTMLButtonElement;
  const volumeSlider = document.getElementById(`volume-${side}`) as HTMLInputElement;
  const progressContainer = document.getElementById(`waveform-${side}`) as HTMLElement;
  const playerDeck = document.getElementById(`player-${side}`) as HTMLElement;
  
  // Audio Event Listeners
  audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
      // Zeit-Anzeige aktualisieren
      updateTimeDisplay(side, audio.currentTime, audio.duration);
      
      // ⭐ EXPLOSION SYSTEM: Check for track ending (last 15 seconds)
      const timeRemaining = audio.duration - audio.currentTime;
      if (timeRemaining <= 15 && timeRemaining > 0) {
        handleTrackEnding(side, timeRemaining);
      }
      
      // WaveSurfer progress is automatically synced
    }
  });
  
  audio.addEventListener('play', () => {
    console.log(`▶️ Player ${side.toUpperCase()} started playing`);
    if (playerDeck) {
      playerDeck.classList.add('playing');
    }
    
    // PLAYER STATE: Track is now playing
    const song = getCurrentLoadedSong(side);
    if (song) {
      setPlayerState(side, song, true);
    }
    
    // Auto-Queue preparation now handled in handleAutoQueue
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
    console.log(`🏁 Player ${side} finished playing`);
    
    // PLAYER STATE: Track finished - clear player
    setPlayerState(side, null, false);
    
    // Auto-Queue Logic: Handle automatic playback
    handleAutoQueue(side);
    
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
    
    // Auto-Queue functionality (legacy - new system uses handleAutoQueue)
    if (autoQueueEnabled) {
      const availableItem = getNextAvailableQueueItem();
      if (availableItem) {
        console.log(`?? Auto-Queue enabled: Loading next track to Player ${side.toUpperCase()}`);
        assignQueueItemToDeck(availableItem, side);
        loadTrackToPlayer(side, availableItem.song, true); // Auto-play next track
      } else {
        console.log(`? Auto-Queue: No available tracks in queue for Player ${side.toUpperCase()}`);
      }
    } else {
      console.log(`? Auto-Queue disabled on Player ${side.toUpperCase()}`);
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
    
    // Remove the ejected track from queue first
    const ejectedSong = getCurrentLoadedSong(side);
    if (ejectedSong) {
      removeQueueItemBySong(ejectedSong);
    }
    
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
  
  // Volume Control - steuert Web Audio API GainNodes UND HTML Audio Element
  volumeSlider?.addEventListener('input', () => {
    const volume = parseInt(volumeSlider.value) / 100;
    
    // Web Audio API Gain steuern (für Streaming)
    if (side === 'a' && aPlayerGain) {
      aPlayerGain.gain.value = volume;
    } else if (side === 'b' && bPlayerGain) {
      bPlayerGain.gain.value = volume;
    } else if (side === 'c' && cPlayerGain) {
      cPlayerGain.gain.value = volume;
    } else if (side === 'd' && dPlayerGain) {
      dPlayerGain.gain.value = volume;
    }
    
    // HTML Audio Element auch setzen (f�r direkte Abh�rung ohne Web Audio)
    audio.volume = volume;
    
    // NUR EINMAL loggen
    console.log(`??? ${side} player volume: ${Math.round(volume * 100)}%`);
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
  
  // Initial volume setting - sowohl f�r HTML Audio als auch Web Audio API
  if (volumeSlider) {
    const initialVolume = parseInt(volumeSlider.value) / 100;
    audio.volume = initialVolume;
    
    // Auch Web Audio API Gain setzen
    if (side === 'a' && aPlayerGain) {
      aPlayerGain.gain.value = initialVolume;
    } else if (side === 'b' && bPlayerGain) {
      bPlayerGain.gain.value = initialVolume;
    } else if (side === 'c' && cPlayerGain) {
      cPlayerGain.gain.value = initialVolume;
    } else if (side === 'd' && dPlayerGain) {
      dPlayerGain.gain.value = initialVolume;
    }
    
    console.log(`??? ${side} player initial volume: ${Math.round(initialVolume * 100)}%`);
  }
  
  // Setup CRT disturbances for this player
  setupCRTDisturbances(side);
}

// CRT Disturbance Effects for Waveforms
function setupCRTDisturbances(side: 'a' | 'b' | 'c' | 'd') {
  const waveformContainer = document.getElementById(`waveform-${side}`)?.parentElement;
  if (!waveformContainer) return;
  
  // Random CRT glitches every 15-45 seconds
  const scheduleNextGlitch = () => {
    const randomDelay = 15000 + Math.random() * 30000; // 15-45 seconds
    setTimeout(() => {
      triggerRandomCRTEffect(waveformContainer, side);
      scheduleNextGlitch(); // Schedule next glitch
    }, randomDelay);
  };
  
  // Random neon jitter effects every 20-60 seconds (rarer than CRT glitches)
  const scheduleNextJitter = () => {
    const randomDelay = 20000 + Math.random() * 40000; // 20-60 seconds
    setTimeout(() => {
      triggerNeonJitter(side);
      scheduleNextJitter(); // Schedule next jitter
    }, randomDelay);
  };
  
  scheduleNextGlitch();
  scheduleNextJitter();
}

function triggerRandomCRTEffect(container: HTMLElement, side: 'a' | 'b' | 'c' | 'd') {
  // Only trigger if player is actually playing
  const playerDeck = document.getElementById(`player-${side}`);
  if (!playerDeck?.classList.contains('playing')) return;
  
  // Random selection of different CRT effects
  const effects = ['crt-glitch', 'crt-scanline-jump', 'crt-horizontal-hold', 'crt-signal-loss'];
  const randomEffect = effects[Math.floor(Math.random() * effects.length)];
  
  // Add intensive effect class
  container.classList.add(randomEffect);
  
  // Different durations for different effects
  let effectDuration;
  switch (randomEffect) {
    case 'crt-scanline-jump':
      effectDuration = 150 + Math.random() * 100; // Very short
      break;
    case 'crt-horizontal-hold':
      effectDuration = 300 + Math.random() * 200; // Medium
      break;
    case 'crt-signal-loss':
      effectDuration = 100 + Math.random() * 150; // Very short
      break;
    default: // crt-glitch
      effectDuration = 200 + Math.random() * 600; // Original duration
  }
  
  setTimeout(() => {
    container.classList.remove(randomEffect);
  }, effectDuration);
  
  console.log(`📺 CRT ${randomEffect} on Player ${side.toUpperCase()} for ${Math.round(effectDuration)}ms`);
}

function triggerNeonJitter(side: 'a' | 'b' | 'c' | 'd') {
  // Only trigger if player is actually playing
  const playerDeck = document.getElementById(`player-${side}`);
  if (!playerDeck?.classList.contains('playing')) return;
  
  // Add neon jitter class
  playerDeck.classList.add('neon-jitter');
  
  // Remove after short duration (100-300ms)
  const jitterDuration = 100 + Math.random() * 200;
  setTimeout(() => {
    playerDeck.classList.remove('neon-jitter');
  }, jitterDuration);
  
  console.log(`✨ Neon jitter on Player ${side.toUpperCase()} for ${Math.round(jitterDuration)}ms`);
}

// Track in Player laden
// Update waveform info overlay with track information
function updateWaveformInfo(side: 'a' | 'b' | 'c' | 'd', song: OpenSubsonicSong) {
  const waveformInfo = document.getElementById(`waveform-info-${side}`);
  if (!waveformInfo) return;

  const titleElement = waveformInfo.querySelector('.track-title') as HTMLElement;
  const artistElement = waveformInfo.querySelector('.track-artist') as HTMLElement;
  const albumElement = waveformInfo.querySelector('.track-album') as HTMLElement;

  if (titleElement) titleElement.textContent = song.title;
  if (artistElement) artistElement.textContent = song.artist;
  if (albumElement) albumElement.textContent = song.album;
}

// Clear waveform info overlay
function clearWaveformInfo(side: 'a' | 'b' | 'c' | 'd') {
  const waveformInfo = document.getElementById(`waveform-info-${side}`);
  if (!waveformInfo) return;

  const titleElement = waveformInfo.querySelector('.track-title') as HTMLElement;
  const artistElement = waveformInfo.querySelector('.track-artist') as HTMLElement;
  const albumElement = waveformInfo.querySelector('.track-album') as HTMLElement;

  if (titleElement) titleElement.textContent = '';
  if (artistElement) artistElement.textContent = '';
  if (albumElement) albumElement.textContent = '';
}

function loadTrackToPlayer(side: 'a' | 'b' | 'c' | 'd', song: OpenSubsonicSong, autoPlay: boolean = false) {
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
  
  // Store song data for drag & drop functionality
  deckSongs[side] = song;
  
  // Neuen Track laden
  audio.src = streamUrl;
  
  // Track Info anzeigen
  if (titleElement) {
    titleElement.textContent = song.title;
  }
  if (artistElement) {
    artistElement.textContent = `${song.artist} - ${song.album}`;
  }

  // Waveform Info Overlay aktualisieren
  updateWaveformInfo(side, song);
  
  // Album Cover aktualisieren
  updateAlbumCover(side, song);
  
  // Play-Button zur�cksetzen (Track ist gestoppt)
  const playPauseBtn = document.getElementById(`play-pause-${side}`) as HTMLButtonElement;
  const icon = playPauseBtn?.querySelector('.material-icons');
  if (icon) icon.textContent = 'play_arrow';
  
  // Load new waveform using WaveSurfer (lädt automatisch neue Waveform)
  loadWaveform(side, audio.src, song.duration);
  
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
      crossfaderGain.a.gain.value = leftGain;
      crossfaderGain.b.gain.value = rightGain;
      
      // Stream-Crossfader (synchron)
      streamCrossfaderGain.a.gain.value = leftGain;
      streamCrossfaderGain.b.gain.value = rightGain;
      
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
  initializePlayerDropZone('a');
  initializePlayerDropZone('b');
  initializePlayerDropZone('c');
  initializePlayerDropZone('d');
}

function initializePlayerDropZone(side: 'a' | 'b' | 'c' | 'd') {
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
    
    // Try to get JSON data first (preferred format)
    let songData: any = null;
    let songId: string | null = null;
    let song: OpenSubsonicSong | null = null;
    
    try {
      const jsonData = dragEvent.dataTransfer?.getData('application/json');
      if (jsonData) {
        songData = JSON.parse(jsonData);
        console.log('Parsed drag data:', songData);
        
        if (songData.type === 'song' && songData.song) {
          song = songData.song;
          songId = song?.id || null;
        } else if (songData.type === 'track' && songData.track) {
          song = songData.track;
          songId = song?.id || null;
        } else if (songData.type === 'queue-song' && songData.song) {
          song = songData.song;
          songId = song?.id || null;
          if (song) {
            console.log(`Queue song: "${song.title}" by ${song.artist}`);
          }
        } else if (songData.type === 'deck-song' && songData.song) {
          song = songData.song;
          songId = song?.id || null;
          if (song) {
            console.log(`Deck song: "${song.title}" by ${song.artist}`);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to parse JSON drag data');
    }
    
    // Fallback to text/plain and search for the song
    if (!song && !songId) {
      songId = dragEvent.dataTransfer?.getData('text/plain') || null;
      if (songId) {
        song = findSongById(songId);
      }
    }
    
    if (song && songId) {
      console.log(`⬇️ Dropping song ${songId} on Player ${side.toUpperCase()}`);
      
      // Load track WITHOUT auto-play
      loadTrackToPlayer(side, song, false);
      console.log(`✅ Track "${song.title}" loaded on Player ${side.toUpperCase()} (ready to play)`);
    } else {
      console.error(`❌ Song with ID ${songId || 'unknown'} not found`);
      showError(`Track not found. Please try searching or reloading the library.`);
    }
  });
}

// Song nach ID in allen verf�gbaren Listen finden
function findSongById(songId: string): OpenSubsonicSong | null {
  // Suche in aktuellen Songs
  let song = currentSongs.find(s => s.id === songId);
  if (song) return song;
  
  // Suche in Search Results (DOM) - sowohl alte als auch neue Track-Items
  const searchResults = document.querySelectorAll('.track-item, .track-item-oneline, .song-row, .unified-song-item');
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

function startVolumeMeter(side: 'a' | 'b' | 'c' | 'd' | 'mic') {
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
  
  if (side === 'a') {
    gainNode = aPlayerGain;
  } else if (side === 'b') {
    gainNode = bPlayerGain;
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
      
      // Berechne RMS (Root Mean Square) für bessere Level-Anzeige
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / bufferLength);
      
      // Verbesserte Empfindlichkeit - direktere Umrechnung
      // Normalisiere von 0-255 zu 0-8 Balken mit mehr Empfindlichkeit
      const normalizedLevel = Math.floor((rms / 255) * 12); // Erhöht auf 12 für mehr Empfindlichkeit
      const clampedLevel = Math.max(0, Math.min(8, normalizedLevel)); // Begrenze auf 8 Balken
      
      updateVolumeMeter(meterId, clampedLevel);
    }, 50); // 20 FPS Update-Rate
    
    console.log(`?? Volume meter started for ${side}`);
  } catch (error) {
    console.error(`Failed to start volume meter for ${side}:`, error);
  }
}

function updateVolumeMeter(meterId: string, level: number) {
  const meterElement = document.getElementById(meterId);
  if (!meterElement) return;
  
  // Support für beide Meter-Typen: kompakt und regular
  const bars = meterElement.querySelectorAll('.meter-bar-compact, .meter-bar');
  bars.forEach((bar, index) => {
    // Entferne alle aktiven Klassen
    bar.classList.remove('active', 'active-1', 'active-2', 'active-3', 'active-4', 'active-5', 'active-6', 'active-7', 'active-8');
    
    if (index < level) {
      // Setze die entsprechende aktive Klasse basierend auf dem Index
      bar.classList.add(`active-${index + 1}`);
    }
  });
}

function stopVolumeMeter(side: 'a' | 'b' | 'mic') {
  if (volumeMeterIntervals[side]) {
    clearInterval(volumeMeterIntervals[side]);
    delete volumeMeterIntervals[side];
    console.log(`?? Volume meter stopped for ${side}`);
  }
}

// Audio Event Listeners Setup
function setupAudioEventListeners(audio: HTMLAudioElement, side: 'a' | 'b' | 'c' | 'd') {
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
    // Verbindung nochmals prüfen/herstellen bei Wiedergabe
    if (audioContext && (aPlayerGain || bPlayerGain || cPlayerGain || dPlayerGain)) {
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
  // Auto-start volume meters when audio mixing is initialized
  setTimeout(() => {
    if (audioContext) {
      startVolumeMeter('a');
      startVolumeMeter('b');
      startVolumeMeter('c');
      startVolumeMeter('d');
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

// Legacy function wrappers - delegate to MediaContainer for consistency
function createAlbumCard(album: OpenSubsonicAlbum): HTMLElement {
  // Create temporary container for legacy compatibility
  const tempContainer = document.createElement('div');
  tempContainer.id = 'temp-album-container-' + Date.now();
  document.body.appendChild(tempContainer);
  
  const mediaContainer = new MediaContainer({
    containerId: tempContainer.id,
    items: [{
      id: album.id,
      name: album.name,
      type: 'album' as const,
      coverArt: album.coverArt,
      artist: album.artist,
      year: album.year
    }],
    displayMode: 'grid',
    itemType: 'album',
    onItemClick: () => loadAlbumTracks(album)
  });
  
  mediaContainer.render();
  const element = tempContainer.firstElementChild as HTMLElement;
  document.body.removeChild(tempContainer);
  return element || document.createElement('div');
}

function createArtistCard(artist: OpenSubsonicArtist): HTMLElement {
  // Create temporary container for legacy compatibility  
  const tempContainer = document.createElement('div');
  tempContainer.id = 'temp-artist-container-' + Date.now();
  document.body.appendChild(tempContainer);
  
  const mediaContainer = new MediaContainer({
    containerId: tempContainer.id,
    items: [{
      id: artist.id,
      name: artist.name,
      type: 'artist' as const,
      coverArt: artist.coverArt
    }],
    displayMode: 'grid', 
    itemType: 'artist',
    onItemClick: () => loadArtistAlbums(artist)
  });
  
  mediaContainer.render();
  const element = tempContainer.firstElementChild as HTMLElement;
  document.body.removeChild(tempContainer);
  return element || document.createElement('div');
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
async function updateTrackRating(trackId: string, rating: number) {
  if (!openSubsonicClient) return;
  
  try {
    // Update rating via OpenSubsonic API
    await openSubsonicClient.setRating(trackId, rating);
    console.log(`Rated track ${trackId}: ${rating} stars`);
    
    // Update all star rating displays for this track
    updateAllStarDisplays(trackId, rating);
  } catch (error) {
    console.error('Failed to update track rating:', error);
  }
}

// Update all star rating displays for a track
function updateAllStarDisplays(trackId: string, rating: number) {
  // Find all star rating containers for this track (handles both data-song-id and data-track-id)
  const starContainers = document.querySelectorAll(`[data-track-id="${trackId}"] .star-rating, [data-song-id="${trackId}"] .star-rating, [data-song-id="${trackId}"] .rating-stars`);
  
  starContainers.forEach(container => {
    const stars = container.querySelectorAll('.star');
    stars.forEach((star, index) => {
      star.classList.toggle('filled', index < rating);
    });
  });
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
                ${generateStarRating(track.userRating || 0)}
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
        // Set JSON data (preferred)
        e.dataTransfer.setData('application/json', JSON.stringify({
          type: 'track',
          track: track,
          sourceUrl: openSubsonicClient?.getStreamUrl(track.id)
        }));
        // Set track ID as text/plain for fallback compatibility
        e.dataTransfer.setData('text/plain', track.id);
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
      starElement.addEventListener('click', async (e) => {
        e.stopPropagation();
        const rating = parseInt(starElement.getAttribute('data-rating') || '0');
        await updateTrackRating(trackId!, rating);
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
  type: 'home' | 'artist' | 'album' | 'search' | 'wizard';
  data?: any;
  breadcrumbs: BreadcrumbItem[];
}

interface BreadcrumbItem {
  label: string;
  type: 'home' | 'artist' | 'album' | 'wizard';
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

  showWizardResults(songs: OpenSubsonicSong[], songTitle: string, artist: string) {
    this.currentContext = {
      type: 'wizard',
      data: { songs, songTitle, artist },
      breadcrumbs: [
        { label: 'Library', type: 'home', action: () => this.showHome() },
        { label: 'Wizard', type: 'wizard', action: () => this.showWizardResults(songs, songTitle, artist) }
      ]
    };
    
    this.updateBreadcrumbs();
    this.loadWizardContent(songs);
  }

  private loadWizardContent(songs: OpenSubsonicSong[]) {
    const content = document.getElementById('library-content')!;
    
    // Use the existing unified songs container
    const songsContainer = createUnifiedSongsContainer(songs, 'album');
    content.innerHTML = '';
    content.appendChild(songsContainer);
    
    // Add all the standard click listeners
    addSongClickListeners(content);
    addAlbumClickListeners(content);
    addArtistClickListeners(content);
    
    console.log(`✅ Displayed ${songs.length} wizard songs in library-content`);
  }

  private async loadHomeContent() {
    const content = document.getElementById('library-content')!;
    content.innerHTML = `
      <div class="media-section">
        <h3 class="section-title">recently added albums</h3>
        <div class="horizontal-scroll" id="recent-albums">
          <div class="loading-placeholder">Loading recently added albums...</div>
        </div>
      </div>

      <div class="media-section">
        <h3 class="section-title">most played albums</h3>
        <div class="horizontal-scroll" id="most-played-albums">
          <div class="loading-placeholder">Loading most played albums...</div>
        </div>
      </div>

      <div class="media-section">
        <h3 class="section-title">random albums</h3>
        <div class="horizontal-scroll" id="random-albums">
          <div class="loading-placeholder">Loading random albums...</div>
        </div>
      </div>

      <div class="media-section">
        <h3 class="section-title">Random Artists</h3>
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
        <h3 class="section-title">Albums</h3>
        <div class="horizontal-scroll" id="artist-albums">
          <div class="loading-placeholder">Loading albums...</div>
        </div>
      </div>

      <div class="media-section">
        <h3 class="section-title">Top Songs</h3>
        <div class="songs-container" id="artist-songs">
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
          <div class="album-card clickable" data-album-id="${album.id}">
            <div class="album-image">
              <img src="${openSubsonicClient.getCoverArtUrl(album.coverArt || '', 300)}" alt="${escapeHtml(album.name)}" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22180%22 height=%22180%22 fill=%22%23333%22%3E%3Crect width=%22180%22 height=%22180%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%2290%22 y=%2290%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2224%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
            </div>
            <h4 class="album-title">${escapeHtml(album.name)}</h4>
            <p class="album-year">${album.year || 'Unknown Year'}</p>
          </div>
        `).join('');
        
        albumsContainer.className = 'horizontal-scroll';
        albumsContainer.innerHTML = albumsHtml;
        
        // Add drag scrolling to container
        this.addDragScrolling(albumsContainer as HTMLElement);
        
        // Add event listeners for album cards
        albumsContainer.querySelectorAll('[data-album-id]').forEach(card => {
          card.addEventListener('click', (e) => {
            // Nur klicken wenn nicht gedraggt wird
            if (!albumsContainer.classList.contains('dragging')) {
              const albumId = card.getAttribute('data-album-id');
              const album = albums.find(a => a.id === albumId);
              if (album) {
                libraryBrowser.showAlbum(album);
              }
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
        songsContainer.className = 'songs-container';
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
        <h3 class="section-title">Tracks</h3>
        <div class="songs-container" id="album-songs">
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
        songsContainer.className = 'songs-container';
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
              <img src="${artist.coverArt ? openSubsonicClient.getCoverArtUrl(artist.coverArt, 300) : 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22 viewBox=%220 0 200 200%22%3E%3Ccircle cx=%22100%22 cy=%22100%22 r=%22100%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%22100%22 y=%22110%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2240%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'}" 
                   alt="${escapeHtml(artist.name)}" 
                   onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22 viewBox=%220 0 200 200%22%3E%3Ccircle cx=%22100%22 cy=%22100%22 r=%22100%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%22100%22 y=%22110%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2240%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
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
        
        // Add drag scrolling to container
        this.addDragScrolling(artistContainer as HTMLElement);
        
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
            <div class="library-album-cover">
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
        
        // Add drag scrolling to container
        this.addDragScrolling(albumContainer as HTMLElement);
        
        // Add event listeners for album cards
        albumContainer.querySelectorAll('[data-album-id]').forEach(card => {
          card.addEventListener('click', (e) => {
            // Nur klicken wenn nicht gedraggt wird
            if (!albumContainer.classList.contains('dragging')) {
              const albumId = card.getAttribute('data-album-id');
              const album = results.album?.find(a => a.id === albumId);
              if (album) {
                libraryBrowser.showAlbum(album);
              }
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
    // Load content using getAlbumList2 API with proper types
    if (!openSubsonicClient) return;

    try {
      const [recentAlbums, mostPlayedAlbums, randomAlbums, randomArtists] = await Promise.all([
        openSubsonicClient.getNewestAlbums(20), // Uses getAlbumList2 with type=newest
        openSubsonicClient.getAlbumList2('frequent', 20), // Uses getAlbumList2 with type=frequent
        openSubsonicClient.getRandomAlbums(20), // Uses getAlbumList2 with type=random
        openSubsonicClient.getRandomArtists(20)
      ]);

      // Recent Albums (Recently Added)
      const recentContainer = document.getElementById('recent-albums');
      if (recentContainer && recentAlbums.length > 0) {
        const albumsHtml = recentAlbums.map(album => `
          <div class="album-card clickable" data-album-id="${album.id}">
            <div class="library-album-cover">
              <img src="${openSubsonicClient.getCoverArtUrl(album.coverArt || '', 300)}" alt="${escapeHtml(album.name)}" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22180%22 height=%22180%22 fill=%22%23333%22%3E%3Crect width=%22180%22 height=%22180%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%2290%22 y=%2290%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2220%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
            </div>
            <h4 class="album-title">${escapeHtml(album.name)}</h4>
            <p class="album-artist clickable-artist" data-artist-name="${escapeHtml(album.artist)}" data-artist-id="${album.artistId || ''}">${escapeHtml(album.artist)}</p>
          </div>
        `).join('');
        
        recentContainer.className = 'horizontal-scroll';
        recentContainer.innerHTML = albumsHtml;
        
        // Add drag scrolling to container
        this.addDragScrolling(recentContainer as HTMLElement);
        
        // Add event listeners for recent album cards
        recentContainer.querySelectorAll('[data-album-id]').forEach(card => {
          card.addEventListener('click', (e) => {
            // Nur klicken wenn nicht gedraggt wird
            if (!recentContainer.classList.contains('dragging')) {
              const albumId = card.getAttribute('data-album-id');
              const album = recentAlbums.find(a => a.id === albumId);
              if (album) {
                libraryBrowser.showAlbum(album);
              }
            }
          });
        });
      }

      // Most Played Albums
      const mostPlayedContainer = document.getElementById('most-played-albums');
      if (mostPlayedContainer && mostPlayedAlbums.length > 0) {
        const albumsHtml = mostPlayedAlbums.map(album => `
          <div class="album-card clickable" data-album-id="${album.id}">
            <div class="library-album-cover">
              <img src="${openSubsonicClient.getCoverArtUrl(album.coverArt || '', 300)}" alt="${escapeHtml(album.name)}" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22180%22 height=%22180%22 fill=%22%23333%22%3E%3Crect width=%22180%22 height=%22180%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%2290%22 y=%2290%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2220%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
            </div>
            <h4 class="album-title">${escapeHtml(album.name)}</h4>
            <p class="album-artist clickable-artist" data-artist-name="${escapeHtml(album.artist)}" data-artist-id="${album.artistId || ''}">${escapeHtml(album.artist)}</p>
          </div>
        `).join('');
        
        mostPlayedContainer.className = 'horizontal-scroll';
        mostPlayedContainer.innerHTML = albumsHtml;
        
        // Add drag scrolling to container
        this.addDragScrolling(mostPlayedContainer as HTMLElement);
        
        // Add event listeners for most played album cards
        mostPlayedContainer.querySelectorAll('[data-album-id]').forEach(card => {
          card.addEventListener('click', (e) => {
            // Nur klicken wenn nicht gedraggt wird
            if (!mostPlayedContainer.classList.contains('dragging')) {
              const albumId = card.getAttribute('data-album-id');
              const album = mostPlayedAlbums.find(a => a.id === albumId);
              if (album) {
                libraryBrowser.showAlbum(album);
              }
            }
          });
        });
      }

      // Random Albums
      const randomContainer = document.getElementById('random-albums');
      if (randomContainer && randomAlbums.length > 0) {
        const albumsHtml = randomAlbums.map(album => `
          <div class="album-card clickable" data-album-id="${album.id}">
            <div class="library-album-cover">
              <img src="${openSubsonicClient.getCoverArtUrl(album.coverArt || '', 300)}" alt="${escapeHtml(album.name)}" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22180%22 height=%22180%22 fill=%22%23333%22%3E%3Crect width=%22180%22 height=%22180%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%2290%22 y=%2290%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2220%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
            </div>
            <h4 class="album-title">${escapeHtml(album.name)}</h4>
            <p class="album-artist clickable-artist" data-artist-name="${escapeHtml(album.artist)}" data-artist-id="${album.artistId || ''}">${escapeHtml(album.artist)}</p>
          </div>
        `).join('');
        
        randomContainer.className = 'horizontal-scroll';
        randomContainer.innerHTML = albumsHtml;
        
        // Add drag scrolling to container
        this.addDragScrolling(randomContainer as HTMLElement);
        
        // Add event listeners for random album cards
        randomContainer.querySelectorAll('[data-album-id]').forEach(card => {
          card.addEventListener('click', (e) => {
            // Nur klicken wenn nicht gedraggt wird
            if (!randomContainer.classList.contains('dragging')) {
              const albumId = card.getAttribute('data-album-id');
              const album = randomAlbums.find(a => a.id === albumId);
              if (album) {
                libraryBrowser.showAlbum(album);
              }
            }
          });
        });
      }

      // Random Artists
      const artistsContainer = document.getElementById('random-artists');
      if (artistsContainer && randomArtists.length > 0) {
        const artistsHtml = randomArtists.map(artist => `
          <div class="artist-card clickable" data-artist-id="${artist.id}">
            <div class="artist-image">
              <img src="${artist.coverArt ? openSubsonicClient.getCoverArtUrl(artist.coverArt, 300) : 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22180%22 height=%22180%22 fill=%22%23333%22%3E%3Ccircle cx=%2290%22 cy=%2290%22 r=%2280%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%2290%22 y=%2295%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2224%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'}" 
                   alt="${escapeHtml(artist.name)}" 
                   onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22180%22 height=%22180%22 fill=%22%23333%22%3E%3Ccircle cx=%2290%22 cy=%2290%22 r=%2280%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%2290%22 y=%2295%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2224%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
            </div>
            <h4 class="artist-name">${escapeHtml(artist.name)}</h4>
            <p class="artist-type">Artist</p>
          </div>
        `).join('');
        
        artistsContainer.className = 'horizontal-scroll';
        artistsContainer.innerHTML = artistsHtml;
        
        // Add drag scrolling to container
        this.addDragScrolling(artistsContainer as HTMLElement);
        
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
    
    // Nach dem Laden der Inhalte: Drag-Scroll-Funktionalität zu allen horizontalen Containern hinzufügen
    this.initializeHorizontalScrollDragging();
    
    // Artist-Namen klickbar machen
    this.initializeArtistClickListeners();
  }

  // Drag-Scroll-Funktionalität für horizontale Container
  private initializeHorizontalScrollDragging() {
    // Finde alle horizontalen Scroll-Container
    const scrollContainers = document.querySelectorAll('.horizontal-scroll');
    console.log(`Initializing drag scrolling for ${scrollContainers.length} containers`);
    
    scrollContainers.forEach((container, index) => {
      console.log(`Adding drag scrolling to container ${index}:`, container);
      this.addDragScrolling(container as HTMLElement);
    });

    // Observer für dynamisch hinzugefügte Container
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            // Prüfe ob das Element selbst ein horizontal-scroll Container ist
            if (element.classList.contains('horizontal-scroll')) {
              console.log('Adding drag scrolling to dynamically added container:', element);
              this.addDragScrolling(element as HTMLElement);
            }
            // Prüfe auch alle Kinder des Elements
            const childContainers = element.querySelectorAll('.horizontal-scroll');
            childContainers.forEach(child => {
              console.log('Adding drag scrolling to dynamically added child container:', child);
              this.addDragScrolling(child as HTMLElement);
            });
          }
        });
      });
    });

    // Beobachte Änderungen im Library Content
    const libraryContent = document.getElementById('library-content');
    if (libraryContent) {
      observer.observe(libraryContent, { childList: true, subtree: true });
    }
  }

  private addDragScrolling(container: HTMLElement) {
    // Verwende die globale Funktion
    addDragScrollingToContainer(container);
  }

  private initializeArtistClickListeners() {
    // Finde alle klickbaren Artist-Namen
    const clickableArtists = document.querySelectorAll('.clickable-artist');
    console.log(`Initializing artist click listeners for ${clickableArtists.length} artists`);
    
    clickableArtists.forEach(artistElement => {
      artistElement.addEventListener('click', (e) => {
        e.stopPropagation(); // Verhindert Album-Click
        
        const artistName = artistElement.getAttribute('data-artist-name');
        const artistId = artistElement.getAttribute('data-artist-id');
        
        if (artistName) {
          // Erstelle ein Artist-Objekt für den LibraryBrowser
          const artist = {
            id: artistId || artistName, // Fallback auf Name falls keine ID
            name: artistName,
            albumCount: 0 // Wird vom Server aktualisiert
          };
          
          console.log(`🎤 Artist clicked: "${artistName}"`);
          libraryBrowser.showArtist(artist);
        }
      });
    });
  }
}

// Global instance
let libraryBrowser: LibraryBrowser;

// Globale Drag-Scroll-Funktionalität für horizontale Container
function addDragScrollingToContainer(container: HTMLElement) {
  console.log('Setting up drag scrolling for container:', container);
  
  // Prüfe ob bereits initialisiert
  if (container.dataset.dragScrollInitialized === 'true') {
    console.log('Drag scrolling already initialized for this container');
    return;
  }
  
  let isDown = false;
  let startX = 0;
  let scrollLeft = 0;
  let hasMoved = false; // Tracks if actual dragging occurred

  // Markiere als initialisiert
  container.dataset.dragScrollInitialized = 'true';

  container.addEventListener('mousedown', (e: MouseEvent) => {
    isDown = true;
    hasMoved = false;
    // NICHT sofort dragging-Klasse setzen - erst bei tatsächlicher Bewegung
    startX = e.pageX - container.offsetLeft;
    scrollLeft = container.scrollLeft;
    // e.preventDefault() NICHT hier - sonst werden Click-Events blockiert
  });

  container.addEventListener('mouseleave', () => {
    isDown = false;
    hasMoved = false;
    container.classList.remove('dragging');
  });

  container.addEventListener('mouseup', () => {
    isDown = false;
    // Nur verzögertes Entfernen wenn tatsächlich gedraggt wurde
    if (hasMoved) {
      setTimeout(() => {
        container.classList.remove('dragging');
        hasMoved = false;
      }, 50); // Längere Verzögerung für bessere Erkennung
    } else {
      // Sofort entfernen wenn nicht gedraggt wurde
      container.classList.remove('dragging');
      hasMoved = false;
    }
  });

  container.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isDown) return;
    
    const x = e.pageX - container.offsetLeft;
    const walk = (x - startX) * 2; // Scroll-Geschwindigkeit (2x)
    
    // Nur bei tatsächlicher Bewegung als Drag behandeln
    if (Math.abs(walk) > 8) { // Erhöhte Schwelle für bessere Unterscheidung
      if (!hasMoved) {
        // Erst jetzt als Drag kennzeichnen
        hasMoved = true;
        container.classList.add('dragging');
        e.preventDefault();
      }
      container.scrollLeft = scrollLeft - walk;
    }
  });

  // Touch-Support für mobile Geräte
  container.addEventListener('touchstart', (e: TouchEvent) => {
    isDown = true;
    hasMoved = false;
    startX = e.touches[0].pageX - container.offsetLeft;
    scrollLeft = container.scrollLeft;
  });

  container.addEventListener('touchend', () => {
    isDown = false;
    if (hasMoved) {
      setTimeout(() => {
        container.classList.remove('dragging');
        hasMoved = false;
      }, 50);
    } else {
      container.classList.remove('dragging');
      hasMoved = false;
    }
  });

  container.addEventListener('touchmove', (e: TouchEvent) => {
    if (!isDown) return;
    const x = e.touches[0].pageX - container.offsetLeft;
    const walk = (x - startX) * 2;
    
    if (Math.abs(walk) > 8) {
      if (!hasMoved) {
        hasMoved = true;
        container.classList.add('dragging');
      }
      container.scrollLeft = scrollLeft - walk;
    }
  });
}

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
    
    // Behalte wichtige CSS-Klassen bei (wie horizontal-scroll)
    const existingClasses = this.container.className.split(' ');
    const preservedClasses = existingClasses.filter(cls => 
      cls === 'horizontal-scroll' || cls.startsWith('horizontal-')
    );
    
    this.container.className = [
      ...preservedClasses,
      'media-container', 
      `${this.config.displayMode}-mode`, 
      `${this.config.itemType}-type`
    ].join(' ');

    this.config.items.forEach(item => {
      const element = this.createMediaElement(item);
      this.container.appendChild(element);
    });

    // Verwende die globale Drag-Scrolling Funktion für horizontale Container
    if (this.container.classList.contains('horizontal-scroll')) {
      console.log('Adding global drag scrolling to horizontal scroll container:', this.container);
      addDragScrollingToContainer(this.container);
    } else {
      // Fallback für Grid-Container
      this.enableSmartDragScrolling();
    }
    
    // Add rating handlers for songs
    this.setupSongRatingHandlers();
    
    // Add click handlers for albums and artists
    this.setupAlbumAndArtistClickHandlers();
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
        starElement.addEventListener('click', async (e) => {
          e.stopPropagation();
          const rating = parseInt(starElement.getAttribute('data-rating') || '0');
          if (songId) {
            await updateTrackRating(songId, rating);
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

  private parseArtists(artistString: string): string[] {
    // Parse multiple artists separated by common delimiters
    if (!artistString) return ['Unknown Artist'];
    
    // Split by common separators: comma, semicolon, ampersand, "feat.", "ft.", "featuring"
    const separators = /[,;]|\s+&\s+|\s+feat\.?\s+|\s+ft\.?\s+|\s+featuring\s+/i;
    return artistString
      .split(separators)
      .map(artist => artist.trim())
      .filter(artist => artist.length > 0);
  }

  private createArtistLinks(artists: string[]): string {
    return artists
      .map(artist => `<span class="artist-link" data-artist-name="${escapeHtml(artist)}">${escapeHtml(artist)}</span>`)
      .join(', ');
  }

  private createAlbumElement(element: HTMLElement, item: MediaItem) {
    const coverUrl = item.coverArt && openSubsonicClient 
      ? openSubsonicClient.getCoverArtUrl(item.coverArt, 300)
      : '';

    const artists = this.parseArtists(item.artist || '');
    const artistLinks = this.createArtistLinks(artists);

    // Check if this is for search results
    if (element.closest('#search-content') || document.getElementById('search-content')) {
      element.className = 'album-wrapper';
      element.innerHTML = `
        <div class="album-clickable" data-album-id="${item.id}">
          ${coverUrl             ? `<img class="library-album-cover" src="${coverUrl}" alt="${item.name}" loading="lazy">`
            : '<div class="library-album-cover album-placeholder"><span class="material-icons">album</span></div>'
          }
          <div class="album-title">${escapeHtml(item.name)}</div>
        </div>
        <div class="album-artists">${artistLinks}</div>
      `;
    } else if (element.closest('.album-grid') || element.closest('#artist-albums')) {
      // For artist detail view - minimal design with title and year
      element.className = 'album-wrapper';
      element.innerHTML = `
        <div class="album-clickable" data-album-id="${item.id}">
          ${coverUrl 
            ? `<img class="library-album-cover" src="${coverUrl}" alt="${item.name}" loading="lazy">`
            : '<div class="library-album-cover album-placeholder"><span class="material-icons">album</span></div>'
          }
          <div class="album-title">${escapeHtml(item.name)}</div>
          ${item.year ? `<div class="album-year">${item.year}</div>` : ''}
        </div>
        <div class="album-artists">${artistLinks}</div>
      `;
    } else {
      // For browse content, use card layout with separate clickable areas
      element.className += ' album-card';
      element.innerHTML = `
        <div class="album-clickable" data-album-id="${item.id}">
          <div class="library-album-cover">
            ${coverUrl 
              ? `<img src="${coverUrl}" alt="${item.name}" loading="lazy">`
              : '<span class="material-icons">album</span>'
            }
          </div>
          <div class="album-title">${escapeHtml(item.name)}</div>
          ${item.year ? `<div class="album-year">${item.year}</div>` : ''}
        </div>
        <div class="album-artists">${artistLinks}</div>
      `;
    }
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
        // Set JSON data (preferred)
        e.dataTransfer.setData('application/json', JSON.stringify({
          type: 'song',
          song: song,
          sourceUrl: openSubsonicClient?.getStreamUrl(item.id)
        }));
        // Set song ID as text/plain for fallback compatibility
        e.dataTransfer.setData('text/plain', item.id);
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

  private setupAlbumAndArtistClickHandlers() {
    if (!this.container) return;

    // Album click handlers
    const albumClickables = this.container.querySelectorAll('.album-clickable');
    albumClickables.forEach(clickable => {
      clickable.addEventListener('click', (e) => {
        e.stopPropagation();
        const albumId = clickable.getAttribute('data-album-id');
        if (albumId) {
          // Find the album from config or search for it
          const albumItem = this.config.items.find(item => item.id === albumId);
          if (albumItem && this.config.onItemClick) {
            this.config.onItemClick(albumItem);
          } else {
            // Fallback: navigate to album page
            loadAlbumById(albumId);
          }
        }
      });
    });

    // Artist link click handlers
    const artistLinks = this.container.querySelectorAll('.artist-link');
    artistLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.stopPropagation();
        const artistName = link.getAttribute('data-artist-name');
        if (artistName && openSubsonicClient) {
          // Search for artist and navigate to first result
          searchAndNavigateToArtist(artistName);
        }
      });
    });
  }
}

// Helper functions for album and artist navigation
async function loadAlbumById(albumId: string) {
  if (!openSubsonicClient) return;
  
  try {
    // Search for the album by ID through the albums list
    const albums = await openSubsonicClient.getAlbums(500);
    const album = albums.find((a: OpenSubsonicAlbum) => a.id === albumId);
    if (album) {
      loadAlbumTracks(album);
    }
  } catch (error) {
    console.error('Failed to load album:', error);
  }
}

async function searchAndNavigateToArtist(artistName: string) {
  if (!openSubsonicClient) return;
  
  try {
    const searchResults = await openSubsonicClient.search(artistName);
    
    const artist = searchResults.artist?.find((a: OpenSubsonicArtist) => 
      a.name.toLowerCase() === artistName.toLowerCase()
    ) || searchResults.artist?.[0];
    
    if (artist && libraryBrowser) {
      libraryBrowser.showArtist(artist);
    }
  } catch (error) {
    console.error('Failed to search for artist:', error);
  }
}

// Legacy functions converted to use MediaContainer
async function loadRecentAlbums() {
  console.log('🔍 Loading recently added albums using getAlbumList2...');
  if (!openSubsonicClient) {
    console.warn('OpenSubsonic client not available for recent albums');
    return;
  }

  try {
    const albums = await openSubsonicClient.getNewestAlbums(20);
    console.log(`� Recent albums loaded: ${albums.length} albums`);
    
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
  console.log('🎲 Loading random albums using getAlbumList2...');
  if (!openSubsonicClient) {
    console.warn('OpenSubsonic client not available for random albums');
    return;
  }

  try {
    const albums = await openSubsonicClient.getRandomAlbums(20);
    console.log(`📦 Random albums loaded: ${albums.length} albums`);
    
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

// ===== WAVEFORM BLINKING SYSTEM ===== 

// Handle track ending - progressive waveform blinking
function handleTrackEnding(side: 'a' | 'b' | 'c' | 'd', timeRemaining: number) {
  const waveformContainer = document.getElementById(`waveform-${side}`);
  if (!waveformContainer) return;
  
  // Remove any existing blink classes
  waveformContainer.classList.remove('waveform-blink-slow', 'waveform-blink-medium', 'waveform-blink-fast', 'waveform-blink-rapid', 'waveform-blink-critical');
  
  // Progressive blinking based on time remaining
  if (timeRemaining > 4) {
    waveformContainer.classList.add('waveform-blink-slow');
  } else if (timeRemaining > 3) {
    waveformContainer.classList.add('waveform-blink-medium');
  } else if (timeRemaining > 2) {
    waveformContainer.classList.add('waveform-blink-fast');
  } else if (timeRemaining > 1) {
    waveformContainer.classList.add('waveform-blink-rapid');
  } else {
    waveformContainer.classList.add('waveform-blink-critical');
  }
}

// Clear waveform blinking when track ends or is ejected
function clearWaveformBlinking(side: 'a' | 'b' | 'c' | 'd') {
  const waveformContainer = document.getElementById(`waveform-${side}`);
  if (waveformContainer) {
    waveformContainer.classList.remove('waveform-blink-slow', 'waveform-blink-medium', 'waveform-blink-fast', 'waveform-blink-rapid', 'waveform-blink-critical');
  }
}

});
