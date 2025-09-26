import "./style.css";
import { SubsonicApiClient, type OpenSubsonicSong, type OpenSubsonicAlbum, type OpenSubsonicArtist } from "./opensubsonic";
import { AzuraCastWebcaster, createAzuraCastConfig, fetchAzuraCastStations, fetchAllAzuraCastStations, type AzuraCastMetadata, type AzuraCastStation, type AzuraCastNowPlayingResponse } from "./azuracast";
import { azuraCastWebSocket, type AzuraCastNowPlayingData } from "./azuracast-websocket";
import { SetupWizard } from "./setup-wizard";
import WaveSurfer from 'wavesurfer.js';
import * as THREE from 'three';

console.log("SubCaster loaded!");

// User status update function
function updateUserStatus(service: 'opensubsonic' | 'stream', username: string, connected: boolean) {
  if (service === 'opensubsonic') {
    const indicator = document.getElementById('opensubsonic-user-status');
    const label = document.getElementById('opensubsonic-username');
    
    if (indicator) {
      if (connected) {
        indicator.classList.add('connected');
        indicator.classList.remove('disconnected');
      } else {
        indicator.classList.add('disconnected');
        indicator.classList.remove('connected');
      }
    }
    
    if (label) {
      label.textContent = connected ? username : '-';
    }
  } else if (service === 'stream') {
    const indicator = document.getElementById('stream-live-status');
    const label = document.getElementById('stream-username-display');
    
    if (indicator) {
      if (connected) {
        indicator.classList.add('connected');
        indicator.classList.remove('disconnected');
      } else {
        indicator.classList.add('disconnected');
        indicator.classList.remove('connected');
        indicator.classList.remove('live'); // Remove live state when disconnected
      }
    }
    
    if (label) {
      label.textContent = connected ? username : '-';
    }
  }
  
  console.log(`🔄 Updated ${service} status: ${connected ? `connected as ${username}` : 'disconnected'}`);
}

// Global variables
let libraryBrowser: any; // Wird später als LibraryBrowser initialisiert
// let volumeMeterIntervals: { [key: string]: NodeJS.Timeout }; // Wird später definiert

// Global flag to track if we're in setup-only mode
let isSetupOnlyMode = false;

// Queue for initialization functions that need to wait for class definitions
let pendingInitializations: (() => void)[] = [];

// AzuraCast WebDJ Integration
let azuraCastWebcaster: AzuraCastWebcaster | null = null;
let isStreaming = false;

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

// Audio Mixing Infrastruktur
let audioContext: AudioContext | null = null;
let masterGainNode: GainNode | null = null;
let streamGainNode: GainNode | null = null; // Monitor/Kopfhörer-Ausgabe
let masterAudioDestination: MediaStreamAudioDestinationNode | null = null; // For streaming
let aPlayerGain: GainNode | null = null;
let bPlayerGain: GainNode | null = null;
let cPlayerGain: GainNode | null = null;
let dPlayerGain: GainNode | null = null;
let microphoneGain: GainNode | null = null;
let crossfaderGain: { a: GainNode; b: GainNode; c: GainNode; d: GainNode } | null = null;
let microphoneStream: MediaStream | null = null;

// Audio Cleanup Function - Essential for preventing browser audio conflicts
function cleanupAudioResources(): void {
  console.log('🧹 Cleaning up audio resources...');
  
  try {
    // Stop microphone stream and all tracks
    if (microphoneStream) {
      microphoneStream.getTracks().forEach(track => {
        track.stop();
        console.log('🎤 Microphone track stopped');
      });
      microphoneStream = null;
    }
    
    // Close AudioContext to release audio hardware
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close().then(() => {
        console.log('🔊 AudioContext closed successfully');
      }).catch((error) => {
        console.warn('⚠️ AudioContext close error:', error);
      });
      audioContext = null;
    }
    
    // Reset all gain nodes
    masterGainNode = null;
    streamGainNode = null;
    masterAudioDestination = null;
    aPlayerGain = null;
    bPlayerGain = null;
    cPlayerGain = null;
    dPlayerGain = null;
    microphoneGain = null;
    crossfaderGain = null;
    
    console.log('✅ Audio resources cleaned up successfully');
  } catch (error) {
    console.error('❌ Error during audio cleanup:', error);
  }
}

// Register cleanup handlers
window.addEventListener('beforeunload', (event) => {
  console.log('🔄 Page reload/close detected - cleaning up audio resources');
  cleanupAudioResources();
});

window.addEventListener('unload', () => {
  console.log('🔄 Page unload - final cleanup');
  cleanupAudioResources();
});

// Handle page visibility change more carefully
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    console.log('📱 Page hidden - keeping audio context active for continuous playback');
    // DON'T suspend AudioContext - this would stop all players!
    // Only reduce resource usage if no audio is playing
  } else {
    console.log('📱 Page visible - audio context ready');
    // Ensure AudioContext is resumed if it was suspended
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().then(() => {
        console.log('🔊 AudioContext resumed when page became visible');
      });
    }
  }
});

// AzuraCast Station Selection
let currentStationId: string | null = null;
let currentStationShortcode: string | null = null;
let currentServerUrl: string | null = null;

// Button States
const StreamButtonState = {
  SELECT_STATION: 'select_station',
  START_STREAMING: 'start_streaming', 
  STREAMING_ACTIVE: 'streaming_active'
} as const;
type StreamButtonState = typeof StreamButtonState[keyof typeof StreamButtonState];
let currentButtonState: StreamButtonState = StreamButtonState.SELECT_STATION;

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
    loadingIndicator.classList.remove('visible');
  }
  
  console.log(`✅ Player ${side.toUpperCase()} deck cleared completely`);
}

// Debug function to show current player states
function debugPlayerStates() {
  console.log('?? CURRENT PLAYER STATES DEBUG:');
  console.log('Player A:', playerStates.a);
  console.log('Player B:', playerStates.b);
  console.log('Player C:', playerStates.c);
  console.log('Player D:', playerStates.d);
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
  serverUrl: '', // No longer used for actual streaming
  serverType: 'icecast',
  mountPoint: '/live',
  password: '',
  bitrate: 192,
  format: 'mp3',
  sampleRate: 48000,
  username: ''
};

// Hilfsfunktion f�r Stream-Server-URL mit Proxy-Unterst�tzung


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
    
    // BROWSER AUDIO KOMPATIBILITÄT: AudioContext aktiv lassen für Player
    // AudioContext muss aktiv bleiben, damit die Player funktionieren
    console.log(`🎵 AudioContext active: ${audioContext.state} - Players can now use audio`);
    
    // Ensure AudioContext is running for players to work
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
      console.log('🎵 AudioContext resumed for player functionality');
    }
    
    // Audio Context Policy: Andere Audio-Quellen nicht beeintr�chtigen
    if ('audioWorklet' in audioContext) {
      console.log('?? Audio Context supports advanced features - using isolated mode');
    }
    
    // Master Gain Node f�r Monitor-Ausgabe (Kopfh�rer/Lautsprecher) - NUR PLAYER DECKS
    masterGainNode = audioContext.createGain();
    masterGainNode.gain.value = 0.99; // 99% Monitor-Volume
    masterGainNode.connect(audioContext.destination);
    
    // Stream Gain Node for Live-Stream (separate output) - PLAYER DECKS + MICROPHONE
    streamGainNode = audioContext.createGain();
    streamGainNode.gain.value = 0.99; // 99% Stream-Volume
    
    // Master Audio Destination for streaming (MediaStreamDestination)
    masterAudioDestination = audioContext.createMediaStreamDestination();
    streamGainNode.connect(masterAudioDestination);
    
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
    
    // Initial Crossfader in der Mitte (alle Kanäle gleichlaut)
    const initialGain = Math.cos(0.5 * Math.PI / 2); // ~0.707 für 50% Position
    if (crossfaderGain) {
      crossfaderGain.a.gain.value = initialGain;
      crossfaderGain.b.gain.value = initialGain;
      crossfaderGain.c.gain.value = initialGain;
      crossfaderGain.d.gain.value = initialGain;
    }
    
    // Microphone Gain Nodes
    microphoneGain = audioContext.createGain();
    microphoneGain.gain.value = 0; // Standardm��ig stumm (wird �ber Button aktiviert)
    
    // Microphone Monitor Gain (separate switch for self-monitoring)
    const microphoneMonitorGain = audioContext.createGain();
    microphoneMonitorGain.gain.value = 0; // Standardm��ig aus (kein Selbsth�ren)
    
    // MONITOR-ROUTING (Kopfhörer): Alle 4 Player Decks, KEIN Mikrofon standardmäßig
    if (crossfaderGain && masterGainNode) {
      crossfaderGain.a.connect(masterGainNode);
      crossfaderGain.b.connect(masterGainNode);
      crossfaderGain.c.connect(masterGainNode);
      crossfaderGain.d.connect(masterGainNode);
    }
    
    // MONITOR-ROUTING: Alle 4 Player Decks + Mikrofon (direkt für Kopfhörer/Monitor)
    if (crossfaderGain && streamGainNode) {
      crossfaderGain.a.connect(streamGainNode);
      crossfaderGain.b.connect(streamGainNode);
      crossfaderGain.c.connect(streamGainNode);
      crossfaderGain.d.connect(streamGainNode);
      microphoneGain.connect(streamGainNode); // Mikrofon zum Monitor
    }
    
    // Alle 4 Player Gains mit Crossfader verbinden
    if (crossfaderGain) {
      aPlayerGain.connect(crossfaderGain.a);
      bPlayerGain.connect(crossfaderGain.b);
      cPlayerGain.connect(crossfaderGain.c);
      dPlayerGain.connect(crossfaderGain.d);
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
      console.log('🎵 Starting volume meters...');
      try {
        if (typeof startVolumeMeter === 'function') {
          startVolumeMeter('a');
          startVolumeMeter('b');
          startVolumeMeter('mic');
          console.log('🎵 Volume meters started successfully');
        } else {
          console.warn('🎵 startVolumeMeter function not available yet');
          // Retry later when function is available
          setTimeout(() => {
            if (typeof startVolumeMeter === 'function') {
              startVolumeMeter('a');
              startVolumeMeter('b');
              startVolumeMeter('mic');
              console.log('🎵 Volume meters started on retry');
            }
          }, 2000);
        }
      } catch (error) {
        console.error('🎵 Error starting volume meters:', error);
      }
    }, 500); // Kurze Verzögerung für Audio-Kontext Stabilität
    
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
    
    // Audio routing always through Web Audio API for monitoring and mixing
    console.log(`🎚️ ${side} player: connecting to Web Audio API for monitoring`);
    
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
  
  // Mark that we need to setup audio event listeners later
  setTimeout(() => {
    console.log('🎵 Audio event listeners will be setup in main DOMContentLoaded...');
  }, 100);
  
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
  
  // 4. Setup drop zones for drag & drop (with delay to ensure DOM is ready)
  setTimeout(() => {
    console.log('🎯 Initializing drop zones after DOM is ready...');
    initializePlayerDropZones();
    setupQueueDropZone();
    console.log('🎯 Drop zones initialization complete');
    
    // Setup album cover drag & drop after drop zones are ready
    setupAlbumCoverDragDrop();
    console.log('🎯 Album cover drag & drop initialized');
  }, 500);
  
  // 5. Setup auto-queue controls
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
      if (!albumCover) {
        console.warn(`🎵 Album cover for deck ${side} not found`);
        return;
      }
      
      const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
      const hasTrack = audio && audio.src && !audio.paused;
      const hasLoadedTrack = audio && audio.src; // Simplified: just check if there's a source
      const songData = deckSongs[side];
      
      console.log(`🎵 Deck ${side} dragability check:`, {
        hasAudio: !!audio,
        hasSrc: !!audio?.src,
        hasLoadedTrack,
        isPlaying: hasTrack,
        songData: !!songData
      });
      
      if (hasLoadedTrack) {
        albumCover.draggable = true;
        albumCover.style.cursor = hasTrack ? 'not-allowed' : 'grab';
        albumCover.setAttribute('draggable', 'true'); // Ensure attribute is set
        console.log(`🎵 Deck ${side} album cover: draggable=true, cursor=${hasTrack ? 'not-allowed' : 'grab'}`);
      } else {
        albumCover.draggable = false;
        albumCover.style.cursor = 'default';
        albumCover.removeAttribute('draggable'); // Remove attribute
        console.log(`🎵 Deck ${side} album cover: draggable=false (no track loaded)`);
      }
    }
    
    // Update dragability when track state changes
    const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
    if (audio) {
      audio.addEventListener('loadstart', updateDragability);
      audio.addEventListener('loadeddata', updateDragability); // Add this for better detection
      audio.addEventListener('canplay', updateDragability); // Add this for better detection
      audio.addEventListener('play', updateDragability);
      audio.addEventListener('pause', updateDragability);
      audio.addEventListener('ended', updateDragability);
    }
    
    // Initial dragability check
    updateDragability();
    
    albumCover.addEventListener('dragstart', (e) => {
      const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
      
      // Prevent drag if track is playing
      if (audio && !audio.paused) {
        e.preventDefault();
        albumCover.style.cursor = 'not-allowed';
        console.log(`🎵 Prevented drag from deck ${side} - track is playing`);
        return;
      }
      
      // Check if there's actually a track loaded (relaxed check)
      if (!audio || !audio.src) {
        e.preventDefault();
        console.log(`🎵 Prevented drag from deck ${side} - no track loaded`);
        return;
      }
      
      console.log(`🎵 Starting drag from deck ${side}`);
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
          console.warn(`❌ No song data found for deck ${side.toUpperCase()}, trying fallback`);
          // Fallback: try to get song info from UI elements
          const titleElement = document.querySelector(`#player-${side} .track-title`);
          const artistElement = document.querySelector(`#player-${side} .track-artist`);
          if (titleElement && artistElement) {
            const fallbackSong = {
              id: 'unknown',
              title: titleElement.textContent || 'Unknown Title',
              artist: artistElement.textContent || 'Unknown Artist',
              album: 'Unknown Album'
            };
            const dragData = {
              type: 'deck-song',
              song: fallbackSong,
              sourceDeck: side
            };
            e.dataTransfer.setData('application/json', JSON.stringify(dragData));
            console.log(`🎵 Using fallback song data for deck ${side}`);
          }
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
  
  // Hide loading indicator if it's visible
  const loadingElement = document.getElementById(`waveform-loading-${side}`);
  if (loadingElement) {
    loadingElement.classList.remove('visible');
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
    
    // Hide loading indicator
    const loadingElement = document.getElementById(`waveform-loading-${side}`);
    if (loadingElement) {
      loadingElement.classList.remove('visible');
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
  
  // Show the existing loading indicator and update it
  const loadingIndicator = document.getElementById(`waveform-loading-${side}`);
  if (loadingIndicator) {
    loadingIndicator.classList.add('visible');
    loadingIndicator.textContent = 'Loading waveform...';
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
    
    // Hide loading indicator
    const loadingElement = document.getElementById(`waveform-loading-${side}`);
    if (loadingElement) {
      loadingElement.classList.remove('visible');
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
    
    // Hide loading indicator on error
    const loadingElement = document.getElementById(`waveform-loading-${side}`);
    if (loadingElement) {
      loadingElement.classList.remove('visible');
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
let isOpenSubsonicLoggedIn = false;
let autoLoginInProgress = false;

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

// Check if configuration exists before initializing the app
async function checkConfigurationAndInitialize() {
  console.log("🔍 Checking configuration status...");
  
  // Check if we have any environment variables that indicate configuration exists
  const hasOpenSubsonicUrl = import.meta.env.VITE_OPENSUBSONIC_URL;
  const hasAzuraCastServers = import.meta.env.VITE_AZURACAST_SERVERS;
  const hasStreamConfig = import.meta.env.VITE_STREAM_BITRATE;
  
  console.log('� Environment variables check:', {
    hasOpenSubsonicUrl: !!hasOpenSubsonicUrl,
    hasAzuraCastServers: !!hasAzuraCastServers,
    hasStreamConfig: !!hasStreamConfig,
    openSubsonicUrl: hasOpenSubsonicUrl,
    azuraCastServers: hasAzuraCastServers
  });
  
  // DEBUG: Show all VITE environment variables
  console.log('🔍 ALL VITE environment variables:', import.meta.env);
  
  // Check if .env file was actually loaded by testing specific values
  console.log('🔍 Raw environment variable values:');
  console.log('  VITE_OPENSUBSONIC_URL:', import.meta.env.VITE_OPENSUBSONIC_URL);
  console.log('  VITE_AZURACAST_SERVERS:', import.meta.env.VITE_AZURACAST_SERVERS);
  console.log('  VITE_STREAM_BITRATE:', import.meta.env.VITE_STREAM_BITRATE);
  console.log('  VITE_OPENSUBSONIC_USERNAME:', import.meta.env.VITE_OPENSUBSONIC_USERNAME);
  
  // If we have any configuration in environment variables, assume .env exists
  const hasConfig = hasOpenSubsonicUrl || hasAzuraCastServers || hasStreamConfig;
  
  console.log('🎯 Final configuration decision: hasConfig =', hasConfig);
  
  if (hasConfig) {
    console.log('✅ Configuration found in environment variables - initializing full app');
    console.log('🚀 Calling initializeFullApp()...');
    initializeFullApp();
  } else {
    console.log('❌ No configuration found in environment variables - showing setup wizard only');
    console.log('🔧 Calling showSetupWizardOnly()...');
    showSetupWizardOnly();
  }
}

function showSetupWizardOnly() {
  console.log('🔧 Showing setup wizard only - hiding main app');
  
  // Set global flag to prevent legacy code execution
  isSetupOnlyMode = true;
  
  // Clear any previous setup completion flags since no config file exists
  localStorage.removeItem('subcaster-setup-completed');
  localStorage.removeItem('subcaster-setup-skipped');
  localStorage.removeItem('subcaster-demo-active');
  
  // Hide the main app interface
  const mainApp = document.querySelector('main') || document.body;
  if (mainApp) {
    // Hide all main app elements except setup wizard
    const allElements = mainApp.children;
    for (let i = 0; i < allElements.length; i++) {
      const element = allElements[i] as HTMLElement;
      if (element.id !== 'setup-wizard-overlay') {
        element.style.display = 'none';
      }
    }
  }
  
  // Show setup wizard
  const setupWizard = new SetupWizard();
  setupWizard.show();
  
  // Make setup wizard globally accessible
  (window as any).showSetupWizard = () => {
    console.log('🔧 Setup Wizard already active');
    setupWizard.show();
  };
}

function initializeFullApp() {
  console.log("🚀 Initializing full SubCaster application...");
  
  // 1. Initialize Player Decks first (creates HTML)
  initializePlayerDecks();
  
  // 2. Setup audio event listeners AFTER deck creation
  setTimeout(() => {
    console.log('🎵 Setting up audio event listeners for all players...');
    ['a', 'b', 'c', 'd'].forEach(side => {
      const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
      if (audio) {
        console.log(`🎵 Setting up audio for player ${side.toUpperCase()}`);
        try {
          setupAudioEventListeners(audio, side as 'a' | 'b' | 'c' | 'd');
          setupAudioPlayer(side as 'a' | 'b' | 'c' | 'd', audio);
          console.log(`✅ Audio setup complete for player ${side.toUpperCase()}`);
        } catch (error) {
          console.error(`❌ Audio setup failed for player ${side.toUpperCase()}:`, error);
        }
      } else {
        console.error(`❌ Audio element not found for player ${side.toUpperCase()}`);
      }
    });
  }, 200);
  
  // 3. Initialize other systems
  initializeCrossfader();
  
  // 4. Setup drop zones with delay
  setTimeout(() => {
    initializePlayerDropZones();
    setupQueueDropZone();
    setupAlbumCoverDragDrop();
    setupAutoQueueControls();
    setupRadioStreamSelector();
  }, 500);
  
  // 5. Initialize UI components
  initializeOpenSubsonicLogin();
  initializeMediaLibrary();
  
  // 6. Initialize rating system
  initializeRatingListeners();
  
  // 7. Auto-start volume meters after everything is ready
  setTimeout(() => {
    autoStartVolumeMeters();
  }, 1000);
  
  console.log("✅ Main initialization complete!");
}

// Make initializeFullApp globally available for setup wizard
(window as any).initializeFullApp = initializeFullApp;

document.addEventListener("DOMContentLoaded", async () => {
  console.log("DOM fully loaded and parsed");
  
  // Check configuration and initialize accordingly
  await checkConfigurationAndInitialize();
});

// END OF MAIN APPLICATION INITIALIZATION
// THE CODE BELOW IS LEGACY AND SHOULD BE REFACTORED
// It currently runs regardless of setup status, which causes the problem
// TODO: Move all this code into initializeFullApp() function
  
  // Microphone Toggle Functionality
  const micBtn = document.getElementById("mic-toggle") as HTMLButtonElement;
  const micVolumeSlider = document.getElementById("mic-volume") as HTMLInputElement;
  let micActive = false; // Button state, but microphone is always recording
  
  // Set microphone volume to 100% by default
  if (micVolumeSlider) {
    micVolumeSlider.value = "100";
    console.log("🎤 Microphone volume slider set to 100% by default");
  }
  
  // Microphone Volume Control - always affects gain directly
  micVolumeSlider?.addEventListener("input", (e) => {
    const target = e.target as HTMLInputElement;
    const volume = parseInt(target.value) / 100;
    if (microphoneGain) {
      // Apply volume based on button state
      microphoneGain.gain.value = micActive ? volume : 0;
      console.log(`🎤 Microphone volume: ${Math.round(volume * 100)}% (Button: ${micActive ? 'ON' : 'OFF'})`);
    }
  });

  // Microphone Device Selection
  const micDeviceSelect = document.getElementById("mic-device-select") as HTMLSelectElement;
  const micRefreshBtn = document.getElementById("mic-refresh-btn") as HTMLButtonElement;
  let selectedMicDeviceId: string | null = null;

  // Function to populate microphone devices
  async function populateMicrophoneDevices(): Promise<void> {
    try {
      console.log('🎤 Loading available microphone devices...');
      
      // Request permission first to get device labels
      await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Get all audio input devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      
      // Clear existing options
      micDeviceSelect.innerHTML = '<option value="">Select microphone...</option>';
      
      // Add devices to dropdown
      audioInputs.forEach(device => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Microphone ${audioInputs.indexOf(device) + 1}`;
        micDeviceSelect.appendChild(option);
      });
      
      console.log(`🎤 Found ${audioInputs.length} microphone devices`);
      
      // Auto-select first device if none selected
      if (!selectedMicDeviceId && audioInputs.length > 0) {
        selectedMicDeviceId = audioInputs[0].deviceId;
        micDeviceSelect.value = selectedMicDeviceId;
      }
      
    } catch (error) {
      console.error('❌ Error loading microphone devices:', error);
      micDeviceSelect.innerHTML = '<option value="">Fehler beim Laden der Geräte</option>';
    }
  }

  // Device selection change handler
  micDeviceSelect.addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement;
    selectedMicDeviceId = target.value;
    console.log(`🎤 Selected microphone device: ${target.options[target.selectedIndex].text}`);
    
    // If microphone is currently active, restart with new device
    if (micActive) {
      console.log('🎤 Restarting microphone with new device...');
      setupMicrophone();
    }
  });

  // Refresh button handler
  micRefreshBtn.addEventListener('click', () => {
    console.log('🎤 Refreshing microphone device list...');
    populateMicrophoneDevices();
  });

  // Initialize microphone device list on startup
  populateMicrophoneDevices();

  // AzuraCast Station Dropdown Initialization (Triggered by STREAM button)
  async function initializeStationDropdown(): Promise<void> {
    const streamButton = document.getElementById('stream-live-status') as HTMLButtonElement;
    const dropdownOverlay = document.getElementById('station-dropdown-overlay') as HTMLDivElement;
    const dropdownMenu = document.getElementById('station-dropdown-menu') as HTMLDivElement;
    const streamUsernameDisplay = document.getElementById('stream-username-display') as HTMLSpanElement;
    
    if (!streamButton || !dropdownOverlay || !dropdownMenu || !streamUsernameDisplay) return;

    let isOpen = false;
    let stations: any[] = [];
    let isStreamConnected = false; // Track if stream is connected

    // Handle STREAM button click based on current state
    const handleStreamButtonClick = async () => {
      console.log(`🔘 Stream button clicked - Current state: ${currentButtonState}, Station ID: ${currentStationId}`);
      
      switch (currentButtonState) {
        case StreamButtonState.SELECT_STATION:
          // Check if streaming is active - if so, block station selection
          if (isLiveStreaming) {
            console.log('🚫 Station selection blocked - streaming is active');
            alert('Cannot change station while streaming is active. Please stop the stream first.');
            return;
          }
          
          console.log('📋 Opening station selection dropdown');
          // Open dropdown to select station
          isOpen = !isOpen;
          dropdownOverlay.classList.toggle('show', isOpen);
          break;
          
        case StreamButtonState.START_STREAMING:
          // If streaming is already active, show warning instead of triggering disconnect
          if (isLiveStreaming) {
            console.log('� Stopping current stream to allow new stream');
            showWarningMessage("stream is active!<br>press and hold for 5 seconds to disconnect");
            return;
          }
          
          console.log('🚀 Attempting to start streaming');
          // Start streaming to selected station
          await startStreamingToSelectedStation();
          break;
          
        case StreamButtonState.STREAMING_ACTIVE:
          console.log('⏹️ Stream active - use press and hold to disconnect');
          // Show warning instead of starting countdown via click
          showWarningMessage("stream is active!<br>press and hold for 5 seconds to disconnect");
          break;
          
        default:
          console.warn(`⚠️ Unknown button state: ${currentButtonState}`);
          break;
      }
    };

    // Start streaming to the currently selected station
    const startStreamingToSelectedStation = async () => {
      console.log(`🔍 Checking streaming prerequisites - Station ID: ${currentStationId}, Shortcode: ${currentStationShortcode}, Server URL: ${currentServerUrl}`);
      
      if (!currentStationId || !currentStationShortcode || !currentServerUrl) {
        console.error('❌ No station selected for streaming - missing prerequisites');
        alert('Please select a station first before starting to stream.');
        return;
      }
      
      try {
        console.log(`🚀 Starting stream to station: ${currentStationId} (${currentStationShortcode})`);
        currentButtonState = StreamButtonState.STREAMING_ACTIVE;
        isStreamConnected = true;
        isLiveStreaming = true; // Set this for consistent streaming state
        updateStreamButton();
        
        // Start AzuraCast streaming with selected station
        await startAzuraCastStreaming();
        
      } catch (error) {
        console.error('❌ Failed to start streaming:', error);
        alert(`Failed to start streaming: ${error instanceof Error ? error.message : String(error)}`);
        currentButtonState = StreamButtonState.START_STREAMING;
        isStreamConnected = false;
        updateStreamButton();
      }
    };

    // Close dropdown when clicking outside
    const closeDropdown = (event: Event) => {
      if (!streamButton.contains(event.target as Node) && !dropdownOverlay.contains(event.target as Node)) {
        isOpen = false;
        dropdownOverlay.classList.remove('show');
      }
    };

    // Update STREAM button based on current state and selected station
    const updateStreamButton = (selectedStation?: any) => {
      console.log(`🔄 Updating stream button - State: ${currentButtonState}, Station: ${selectedStation?.name || 'none'}`);
      streamButton.classList.remove('occupied', 'connected', 'disconnected');
      const resetButton = document.getElementById('stream-reset-button') as HTMLButtonElement;
      
      switch (currentButtonState) {
        case StreamButtonState.SELECT_STATION:
          streamButton.classList.add('disconnected');
          streamUsernameDisplay.textContent = 'Select Station';
          if (resetButton) resetButton.style.display = 'none';
          break;
          
        case StreamButtonState.START_STREAMING:
          if (selectedStation?.live?.is_live && selectedStation.live.streamer_name) {
            // Station is occupied by another streamer
            streamButton.classList.add('occupied');
            streamUsernameDisplay.textContent = `${selectedStation.name} - ${selectedStation.live.streamer_name}`;
          } else {
            // Station available for streaming
            streamButton.classList.add('disconnected');
            streamUsernameDisplay.textContent = selectedStation?.name || 'Unknown';
          }
          if (resetButton) resetButton.style.display = 'block';
          break;
          
        case StreamButtonState.STREAMING_ACTIVE:
          streamButton.classList.add('connected');
          streamUsernameDisplay.textContent = selectedStation?.name || 'Streaming';
          if (resetButton) resetButton.style.display = 'block';
          break;
          
        default:
          console.warn(`⚠️ Unknown button state: ${currentButtonState}`);
          streamButton.classList.add('disconnected');
          streamUsernameDisplay.textContent = 'Select Station';
          if (resetButton) resetButton.style.display = 'none';
          break;
      }
      
      console.log(`✅ Button updated - Text: "${streamUsernameDisplay.textContent}", Classes: ${streamButton.className}`);
    };

    // Create station dropdown item
    const createStationItem = (station: any) => {
      const item = document.createElement('div');
      item.className = 'station-dropdown-item';
      item.setAttribute('data-station-id', station.id.toString());
      
      const isLive = station.live?.is_live;
      const streamerName = station.live?.streamer_name;
      
      // Add status classes
      if (isLive && streamerName) {
        item.classList.add('occupied');
      } else if (station.is_online) {
        item.classList.add('online');
      } else {
        item.classList.add('offline');
      }

      // Main station info
      const mainInfo = document.createElement('div');
      mainInfo.className = 'station-item-main';
      
      const statusDot = document.createElement('div');
      statusDot.className = 'station-status-dot';
      if (isLive && streamerName) {
        statusDot.classList.add('occupied');
      } else if (station.is_online) {
        statusDot.classList.add('online');
      }
      
      const stationName = document.createElement('span');
      stationName.textContent = station.name;
      
      mainInfo.appendChild(statusDot);
      mainInfo.appendChild(stationName);
      item.appendChild(mainInfo);

      // Streamer info if occupied
      if (isLive && streamerName) {
        const streamerInfo = document.createElement('div');
        streamerInfo.className = 'station-streamer-info';
        streamerInfo.textContent = `Live: ${streamerName}`;
        item.appendChild(streamerInfo);
      }

      // Click handler
      item.addEventListener('click', () => {
        // Remove previous selection
        dropdownMenu.querySelectorAll('.station-dropdown-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        
        // Find the full station data to get server URL
        const fullStationData = stations.find(s => s.station.id === station.id);
        
        // Update global state
        currentStationId = station.id.toString();
        currentStationShortcode = station.shortcode;
        currentServerUrl = fullStationData?.serverUrl;
        currentButtonState = StreamButtonState.START_STREAMING;
        
        // Update button appearance
        updateStreamButton(station);
        
        // Update AzuraCast configuration
        if (azuraCastWebcaster) {
          azuraCastWebcaster.updateConfig({ 
            stationId: station.id.toString(),
            stationShortcode: station.shortcode 
          });
        }
        
        console.log(`🎯 Selected station: ${station.name} (ID: ${station.id}, shortcode: ${station.shortcode})`);
        console.log(`📡 Station configured: ${station.listen_url}`);
        
        // Close dropdown
        isOpen = false;
        dropdownOverlay.classList.remove('show');
      });

      return item;
    };

    try {
      const config = createAzuraCastConfig();
      console.log('🔍 Loading AzuraCast stations from all servers...');
      
      // Load stations from all configured servers
      const allServersData = await fetchAllAzuraCastStations(config.servers);
      
      // Flatten all stations with server info
      stations = [];
      allServersData.forEach(serverData => {
        serverData.stations.forEach(stationData => {
          stations.push({
            ...stationData,
            serverUrl: serverData.serverUrl // Add server URL to each station
          });
        });
      });
      
      // Clear loading state
      dropdownMenu.innerHTML = '';
      
      // Create station items
      stations.forEach((stationData: any) => {
        // Merge station data with live info
        const stationWithLive = {
          ...stationData.station,
          live: stationData.live
        };
        const item = createStationItem(stationWithLive);
        dropdownMenu.appendChild(item);
      });
      
      // Set default station if configured
      if (config.stationId && config.stationId !== '0') {
        const defaultStationData = stations.find((s: any) => s.station.id.toString() === config.stationId);
        if (defaultStationData) {
          currentStationId = config.stationId;
          currentStationShortcode = defaultStationData.station.shortcode;
          
          const stationWithLive = {
            ...defaultStationData.station,
            live: defaultStationData.live
          };
          updateStreamButton(stationWithLive);
          
          // Mark as selected in dropdown
          const selectedItem = dropdownMenu.querySelector(`[data-station-id="${config.stationId}"]`);
          selectedItem?.classList.add('selected');
        }
      }
      
      console.log(`✅ Loaded ${stations.length} AzuraCast stations`);
      
    } catch (error) {
      console.error('❌ Failed to load AzuraCast stations:', error);
      
      // Show error in dropdown
      dropdownMenu.innerHTML = '<div class="dropdown-loading">Fehler beim Laden der Stationen</div>';
    }

    // Event listeners
    streamButton.addEventListener('click', handleStreamButtonClick);
    document.addEventListener('click', closeDropdown);
    
    // Reset button handler
    const resetButton = document.getElementById('stream-reset-button') as HTMLButtonElement;
    if (resetButton) {
      resetButton.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent triggering stream button click
        
        // Block reset during live streaming
        if (isLiveStreaming) {
          console.log('🚫 Station reset blocked - live streaming is active');
          alert('Cannot reset station selection while live streaming is active. Please stop the stream first.');
          return;
        }
        
        // Reset station selection
        currentStationId = null;
        currentStationShortcode = null;
        currentServerUrl = null;
        currentButtonState = StreamButtonState.SELECT_STATION;
        
        // Clear dropdown selection
        dropdownMenu.querySelectorAll('.station-dropdown-item').forEach(i => i.classList.remove('selected'));
        
        // Update button appearance
        updateStreamButton();
        
        // Hide reset button
        resetButton.style.display = 'none';
        
        console.log('🔄 Station selection reset');
      });
    }
    
    // Initialize button state
    updateStreamButton();
    
    // Make updateStreamButton globally available for reset after streaming
    (window as any).__updateStreamButton = updateStreamButton;
    
    // Make streaming function globally available
    (window as any).__startAzuraCastStreaming = startAzuraCastStreaming;
  }

  // AzuraCast WebDJ Streaming Functions
  async function startAzuraCastStreaming(): Promise<void> {
    try {
      // Initialize audio mixing if not done yet
      if (!audioContext || !masterAudioDestination) {
        console.log('🔧 Initializing audio mixing for streaming...');
        const success = await initializeAudioMixing();
        if (!success || !masterAudioDestination) {
          console.error('❌ Failed to initialize audio system for streaming');
          alert('Audio system initialization failed. Please try again.');
          return;
        }
        console.log('✅ Audio system ready for streaming');
      }

      // Create AzuraCast webcaster with selected station ID, shortcode and server
      const config = createAzuraCastConfig(
        currentStationId || undefined, 
        currentStationShortcode || undefined,
        currentServerUrl || undefined,
        streamConfig.username,
        streamConfig.password
      );
      azuraCastWebcaster = new AzuraCastWebcaster(config);

      // Get master audio stream
      const masterStream = masterAudioDestination.stream;
      
      // Connect to AzuraCast
      const connected = await azuraCastWebcaster.connect(masterStream);
      
      if (connected) {
        isStreaming = true;
        isLiveStreaming = true; // Keep both streaming states in sync
        
        // Update UI
        const streamBtn = document.getElementById('stream-live-status') as HTMLButtonElement;
        const streamLabel = document.getElementById('stream-username-display') as HTMLElement;
        
        if (streamBtn) {
          streamBtn.classList.add('connected', 'live');
          streamBtn.classList.remove('disconnected');
        }
        
        if (streamLabel) {
          streamLabel.textContent = config.username;
        }
        
        updateUserStatus('stream', config.username, true);
        console.log('🔴 LIVE: Streaming to AzuraCast started!');
        
        // Send initial metadata if current track is playing
        const currentTrack = getCurrentTrackMetadata();
        if (currentTrack) {
          azuraCastWebcaster.sendMetadata(currentTrack);
        }
        
      } else {
        throw new Error('Failed to connect to AzuraCast');
      }
      
    } catch (error) {
      console.error('❌ Failed to start AzuraCast streaming:', error);
      alert(`Failed to start streaming: ${error}`);
      isStreaming = false;
      azuraCastWebcaster = null;
    }
  }

  async function stopAzuraCastStreaming(): Promise<void> {
    try {
      if (azuraCastWebcaster) {
        azuraCastWebcaster.disconnect();
        azuraCastWebcaster = null;
      }
      
      isStreaming = false;
      
      // Update UI
      const streamBtn = document.getElementById('stream-live-status') as HTMLButtonElement;
      const streamLabel = document.getElementById('stream-username-display') as HTMLElement;
      
      if (streamBtn) {
        streamBtn.classList.add('disconnected');
        streamBtn.classList.remove('connected', 'live');
      }
      
      if (streamLabel) {
        streamLabel.textContent = '-';
      }
      
      updateUserStatus('stream', '', false);
      console.log('⏹️ AzuraCast streaming stopped');
      
    } catch (error) {
      console.error('❌ Error stopping AzuraCast streaming:', error);
    }
  }

  // Get current track metadata for AzuraCast
  function getCurrentTrackMetadata(): AzuraCastMetadata | null {
    // Try to get metadata from currently playing deck
    const playingDecks = ['a', 'b', 'c', 'd'].filter(deck => {
      const playBtn = document.getElementById(`play-${deck}`) as HTMLButtonElement;
      return playBtn?.classList.contains('playing');
    });
    
    if (playingDecks.length > 0) {
      const deckId = playingDecks[0];
      const song = deckSongs[deckId as keyof typeof deckSongs];
      
      if (song) {
        return {
          title: song.title || 'Unknown Title',
          artist: song.artist || 'Unknown Artist'
        };
      }
    }
    
    return null;
  }
  
  micBtn?.addEventListener("click", async () => {
    micActive = !micActive;
    
    // Initialize microphone if not already done
    if (!microphoneStream) {
      // Audio-Mixing initialisieren falls nötig
      if (!audioContext) {
        await initializeAudioMixing();
      }
      
      // Ensure AudioContext is running
      if (audioContext && audioContext.state === 'suspended') {
        await audioContext.resume();
        console.log('🎤 AudioContext resumed for microphone activation');
      }
      
      // Mikrofon einrichten (nur einmal, läuft dann kontinuierlich)
      const micReady = await setupMicrophone();
      if (!micReady) {
        micActive = false;
        alert('Microphone access denied or not available');
        return;
      }
    }
    
    // Button controls volume, not stream
    if (micActive) {
      // Volume basierend auf Slider setzen
      const volume = parseInt(micVolumeSlider?.value || "100") / 100;
      setMicrophoneEnabled(true, volume);
      micBtn.classList.add("active");
      micBtn.innerHTML = '<span class="material-icons">mic</span> MICROPHONE ON';
      console.log(`🎤 Microphone volume enabled: ${Math.round(volume * 100)}%`);
    } else {
      // Mute microphone but keep stream running
      setMicrophoneEnabled(false);
      micBtn.classList.remove("active");
      micBtn.innerHTML = '<span class="material-icons">mic</span> MICROPHONE';
      console.log("🎤 Microphone muted (stream still active)");
    }
  });

  // AzuraCast Station Selection Setup
  await initializeStationDropdown();

  // Stream Live Button Event Listener - AzuraCast WebDJ Integration
  // NOTE: This handler is now handled by the station dropdown logic in initializeStationDropdown()
  // to ensure proper station selection before streaming
  const streamLiveBtn = document.getElementById('stream-live-status') as HTMLButtonElement;
  if (streamLiveBtn) {
    console.log('🔄 Stream button found - using station dropdown handler instead of direct streaming');
  }
  
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

// Mikrofon zum Mixing-System hinzufügen
async function setupMicrophone() {
  if (!audioContext || !microphoneGain) return false;
  
  try {
    // Clean up any existing microphone stream first
    if (microphoneStream) {
      microphoneStream.getTracks().forEach(track => {
        track.stop();
        console.log('🎤 Previous microphone track stopped');
      });
      microphoneStream = null;
    }
    
    // DYNAMISCHE SAMPLE RATE: Verwende AudioContext Sample Rate für Kompatibilität
    const contextSampleRate = audioContext.sampleRate;
    console.log(`🎤 Setting up fresh microphone with dynamic sample rate: ${contextSampleRate} Hz`);
    
    // Mikrofon-Konfiguration f�r DJ-Anwendung (ALLE Audio-Effekte deaktiviert f�r beste Verst�ndlichkeit)
    const audioConstraints: MediaTrackConstraints = {
      // Device Selection - use selected device if available
      ...(selectedMicDeviceId && { deviceId: { exact: selectedMicDeviceId } }),
      
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
      channelCount: { ideal: 1 },       // Mono für geringere Bandbreite
        
      // Browser-spezifische Verbesserungen - ALLE AUS für natürliche Stimme
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
    };
    
    microphoneStream = await navigator.mediaDevices.getUserMedia({ 
      audio: audioConstraints
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
    
    // AnalyserNode für Volume Meter erstellen
    const micAnalyser = audioContext.createAnalyser();
    micAnalyser.fftSize = 256;
    micAnalyser.smoothingTimeConstant = 0.3;
    
    // Analyser global speichern für Volume Meter
    (window as any).micAnalyser = micAnalyser;
    
    // 🎙️ PROFESSIONELLE BROADCAST AUDIO-PROCESSING CHAIN 🎙️
    console.log('🔧 Setting up professional microphone processing chain...');
    
    // 1. HIGH-PASS FILTER - Entfernt Rumpeln und Low-End-Probleme
    const highPassFilter = audioContext.createBiquadFilter();
    highPassFilter.type = 'highpass';
    highPassFilter.frequency.setValueAtTime(85, audioContext.currentTime); // 85Hz cutoff für Stimme
    highPassFilter.Q.setValueAtTime(0.7, audioContext.currentTime);
    console.log('🔧 High-pass filter: 85Hz cutoff');
    
    // 2. PREAMP/INPUT GAIN - Boost vor Kompressor
    const preAmp = audioContext.createGain();
    preAmp.gain.setValueAtTime(2.5, audioContext.currentTime); // +8dB Input Gain
    console.log('🔧 PreAmp: +8dB input gain');
    
    // 3. KOMPRESSOR - Aggressiv für Broadcast-Lautheit
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-18, audioContext.currentTime);  // -18dB threshold (aggressiver)
    compressor.knee.setValueAtTime(15, audioContext.currentTime);        // 15dB knee (sanfter Übergang)
    compressor.ratio.setValueAtTime(8, audioContext.currentTime);        // 8:1 ratio (stark komprimiert)
    compressor.attack.setValueAtTime(0.001, audioContext.currentTime);   // 1ms attack (sehr schnell)
    compressor.release.setValueAtTime(0.1, audioContext.currentTime);    // 100ms release (schnell)
    console.log('🔧 Compressor: -18dB threshold, 8:1 ratio, fast attack');
    
    // 4. EQ - SPEECH OPTIMIZATION (Präsenz-Boost)
    const eqLowMid = audioContext.createBiquadFilter();
    eqLowMid.type = 'peaking';
    eqLowMid.frequency.setValueAtTime(200, audioContext.currentTime);    // 200Hz
    eqLowMid.Q.setValueAtTime(1.0, audioContext.currentTime);
    eqLowMid.gain.setValueAtTime(-2, audioContext.currentTime);          // -2dB (reduziert Wummern)
    
    const eqPresence = audioContext.createBiquadFilter();
    eqPresence.type = 'peaking';
    eqPresence.frequency.setValueAtTime(2500, audioContext.currentTime);  // 2.5kHz Präsenz
    eqPresence.Q.setValueAtTime(1.2, audioContext.currentTime);
    eqPresence.gain.setValueAtTime(4, audioContext.currentTime);          // +4dB Boost für Klarheit
    
    const eqBrilliance = audioContext.createBiquadFilter();
    eqBrilliance.type = 'peaking';
    eqBrilliance.frequency.setValueAtTime(8000, audioContext.currentTime); // 8kHz Brillanz
    eqBrilliance.Q.setValueAtTime(0.8, audioContext.currentTime);
    eqBrilliance.gain.setValueAtTime(2, audioContext.currentTime);          // +2dB für Luftigkeit
    console.log('🔧 EQ: Low-mid cut (-2dB@200Hz), Presence boost (+4dB@2.5kHz), Brilliance (+2dB@8kHz)');
    
    // 5. LIMITER - Verhindert Clipping
    const limiter = audioContext.createDynamicsCompressor();
    limiter.threshold.setValueAtTime(-3, audioContext.currentTime);      // -3dB threshold (sehr hoch)
    limiter.knee.setValueAtTime(0, audioContext.currentTime);            // Hard knee (0dB)
    limiter.ratio.setValueAtTime(20, audioContext.currentTime);          // 20:1 ratio (Brickwall)
    limiter.attack.setValueAtTime(0.0001, audioContext.currentTime);     // 0.1ms attack (instant)
    limiter.release.setValueAtTime(0.05, audioContext.currentTime);      // 50ms release (schnell)
    console.log('🔧 Limiter: -3dB threshold, 20:1 ratio, brickwall limiting');
    
    // 6. OUTPUT GAIN - Finale Lautstärke-Kontrolle
    const outputGain = audioContext.createGain();
    outputGain.gain.setValueAtTime(1.8, audioContext.currentTime);       // +5dB Output für Broadcast-Level
    console.log('🔧 Output gain: +5dB final boost');
    
    // 🎵 PROFESSIONELLE AUDIO-KETTE AUFBAUEN 🎵
    // Mikrofon -> Analyser -> High-Pass -> PreAmp -> Kompressor -> EQ -> Limiter -> Output -> Final Gain
    micSourceNode.connect(micAnalyser);
    micAnalyser.connect(highPassFilter);
    highPassFilter.connect(preAmp);
    preAmp.connect(compressor);
    compressor.connect(eqLowMid);
    eqLowMid.connect(eqPresence);
    eqPresence.connect(eqBrilliance);
    eqBrilliance.connect(limiter);
    limiter.connect(outputGain);
    outputGain.connect(microphoneGain);
    
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

// Crossfader-Position setzen (0 = A, 0.25 = B, 0.5 = C, 0.75 = D, 1 = alle)
function setCrossfaderPosition(position: number) {
  if (!crossfaderGain) return;
  
  // Position zwischen 0 und 1 begrenzen
  position = Math.max(0, Math.min(1, position));
  
  // Gleichmäßige Verteilung für 4 Decks
  const aGain = position < 0.25 ? 1.0 : 1.0 - (position - 0.25) * 4;
  const bGain = position < 0.25 ? position * 4 : (position < 0.5 ? 1.0 : 1.0 - (position - 0.5) * 4);
  const cGain = position < 0.5 ? 0 : (position < 0.75 ? (position - 0.5) * 4 : 1.0 - (position - 0.75) * 4);
  const dGain = position < 0.75 ? 0 : (position - 0.75) * 4;
  
  // Monitor-Crossfader (für Speaker/Kopfhörer)
  crossfaderGain.a.gain.value = Math.max(0, Math.min(1, aGain));
  crossfaderGain.b.gain.value = Math.max(0, Math.min(1, bGain));
  crossfaderGain.c.gain.value = Math.max(0, Math.min(1, cGain));
  crossfaderGain.d.gain.value = Math.max(0, Math.min(1, dGain));
  
  console.log(`🎚️ Crossfader position: ${position}, A: ${aGain.toFixed(2)}, B: ${bGain.toFixed(2)}, C: ${cGain.toFixed(2)}, D: ${dGain.toFixed(2)}`);
}

// Mikrofon Lautstärke steuern (Stream bleibt immer aktiv)
function setMicrophoneEnabled(enabled: boolean, volume: number = 1) {
  if (!microphoneGain) return;
  
  if (enabled) {
    microphoneGain.gain.value = volume;
    console.log(`🎤 Microphone volume set to ${Math.round(volume * 100)}%`);
  } else {
    // Mute but keep stream alive for consistent behavior
    microphoneGain.gain.value = 0;
    console.log(`🎤 Microphone muted (stream still recording)`);
    // Note: Stream stays active for consistent meter display and instant activation
  }
}















// Streaming-Status anzeigen/verstecken






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
    
    // Re-initialize drop zones after library is loaded
    setTimeout(() => {
      console.log("🎯 Re-initializing drop zones after library load...");
      initializePlayerDropZones();
      setupQueueDropZone();
      console.log("🎯 Drop zones re-initialized after library load");
      
      // Re-initialize album cover drag & drop after library load
      setupAlbumCoverDragDrop();
      console.log("🎯 Album cover drag & drop re-initialized after library load");
    }, 1000);
    
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
    console.log('🚀 DRAGSTART on track item:', song.title, 'by', song.artist);
    console.log('🚀 Event target:', e.target);
    console.log('🚀 DataTransfer available:', !!e.dataTransfer);
    
    if (e.dataTransfer) {
      // Set JSON data (preferred)
      const dragData = {
        type: 'song',
        song: song,
        sourceUrl: openSubsonicClient?.getStreamUrl(song.id)
      };
      
      console.log('🚀 Setting drag data:', dragData);
      
      e.dataTransfer.setData('application/json', JSON.stringify(dragData));
      // Set song ID as text/plain for fallback compatibility
      e.dataTransfer.setData('text/plain', song.id);
      e.dataTransfer.effectAllowed = 'copy';
      
      console.log('🚀 Drag data set successfully');
    } else {
      console.error('🚀 ERROR: No dataTransfer available!');
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
  
  // Update player rating if this song is currently playing (ALL DECKS)
  updatePlayerRating('a', songId, rating);
  updatePlayerRating('b', songId, rating);
  updatePlayerRating('c', songId, rating);
  updatePlayerRating('d', songId, rating);
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
  
  // Temporäres Status-Element erstellen falls noch nicht vorhanden
  let statusElement = document.getElementById('status-message');
  if (!statusElement) {
    statusElement = document.createElement('div');
    statusElement.id = 'status-message';
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

// Update radio stream display with station info
function updateRadioStreamDisplay(deck: string, station: any) {
  console.log(`📻 Updating radio display for deck ${deck.toUpperCase()}:`, {
    stationName: station.name,
    isLive: station.live?.is_live,
    streamerName: station.live?.streamer_name,
    nowPlaying: station.now_playing?.song
  });
  
  // Use the waveform display elements (zweckentfremden für Radio-Streams)
  const titleElement = document.getElementById(`track-title-${deck}`) as HTMLElement;
  const artistElement = document.getElementById(`track-artist-${deck}`) as HTMLElement;
  const albumCoverElement = document.getElementById(`album-cover-${deck}`) as HTMLElement;
  
  console.log(`📻 Found elements for deck ${deck}:`, {
    titleElement: !!titleElement,
    artistElement: !!artistElement,
    albumCoverElement: !!albumCoverElement
  });
  
  // Get live and now playing info
  const isLive = station.live?.is_live;
  const streamerName = station.live?.streamer_name;
  const nowPlaying = station.now_playing?.song;
  
  // Update waveform title field with current track or station name
  if (titleElement) {
    if (nowPlaying?.title) {
      titleElement.textContent = nowPlaying.title;
    } else {
      titleElement.textContent = `📻 ${station.name}`;
    }
  }
  
  // Update waveform artist field with artist or streamer info
  if (artistElement) {
    if (nowPlaying?.artist) {
      artistElement.textContent = nowPlaying.artist;
    } else if (isLive && streamerName) {
      artistElement.textContent = `🔴 Live: ${streamerName}`;
    } else {
      artistElement.textContent = `${station.name} - Live Radio`;
    }
  }
  
  // Update waveform album cover with current track art
  if (albumCoverElement) {
    if (nowPlaying?.art) {
      albumCoverElement.innerHTML = `<img src="${nowPlaying.art}" alt="Album Cover" style="width: 100%; height: 100%; object-fit: cover;">`;
    } else {
      // Default radio icon when no cover available
      albumCoverElement.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; background: rgba(255,255,255,0.1); border-radius: 8px;">
          <span class="material-icons" style="font-size: 48px; color: rgba(255,255,255,0.7);">radio</span>
        </div>
      `;
    }
  }
}

// Update radio stream display from WebSocket data
function updateRadioStreamFromWebSocket(deck: string, station: any, data: AzuraCastNowPlayingData) {
  console.log(`📻 WebSocket update for deck ${deck.toUpperCase()}:`, data);
  
  // Use the waveform display elements (zweckentfremden für Radio-Stream Updates)
  const titleElement = document.getElementById(`track-title-${deck}`) as HTMLElement;
  const artistElement = document.getElementById(`track-artist-${deck}`) as HTMLElement;
  const albumCoverElement = document.getElementById(`album-cover-${deck}`) as HTMLElement;
  
  console.log(`📻 WebSocket elements found for deck ${deck}:`, {
    titleElement: !!titleElement,
    artistElement: !!artistElement,
    albumCoverElement: !!albumCoverElement,
    titleElementId: `track-title-${deck}`,
    artistElementId: `track-artist-${deck}`,
    albumElementId: `album-cover-${deck}`
  });
  
  // Update waveform title with real-time track info
  if (titleElement) {
    const newTitle = data.now_playing?.song?.title || `📻 ${station.name}`;
    console.log(`📻 Setting title for deck ${deck}: "${newTitle}"`);
    titleElement.textContent = newTitle;
  } else {
    console.error(`❌ Title element not found: track-title-${deck}`);
  }
  
  // Update waveform artist with real-time artist or streamer info
  if (artistElement) {
    let newArtist = '';
    if (data.now_playing?.song?.artist) {
      newArtist = data.now_playing.song.artist;
    } else if (data.live?.is_live && data.live?.streamer_name) {
      newArtist = `🔴 Live: ${data.live.streamer_name}`;
    } else {
      newArtist = `${station.name} - Live Radio`;
    }
    console.log(`📻 Setting artist for deck ${deck}: "${newArtist}"`);
    artistElement.textContent = newArtist;
  } else {
    console.error(`❌ Artist element not found: track-artist-${deck}`);
  }
  
  // Update waveform album cover automatically when it changes
  if (albumCoverElement) {
    const newCoverUrl = data.now_playing?.song?.art;
    const currentCover = albumCoverElement.querySelector('img');
    const currentSrc = currentCover?.src;
    
    if (newCoverUrl && currentSrc !== newCoverUrl) {
      console.log(`🖼️ Updating album cover for deck ${deck.toUpperCase()}: ${newCoverUrl}`);
      
      // Add smooth transition for cover changes
      albumCoverElement.style.opacity = '0.5';
      setTimeout(() => {
        albumCoverElement.innerHTML = `<img src="${newCoverUrl}" alt="Album Cover" style="width: 100%; height: 100%; object-fit: cover;">`;
        albumCoverElement.style.opacity = '1';
      }, 200);
    } else if (!newCoverUrl && currentCover) {
      // Switch back to radio icon when no cover available
      albumCoverElement.style.opacity = '0.5';
      setTimeout(() => {
        albumCoverElement.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; background: rgba(255,255,255,0.1); border-radius: 8px;">
            <span class="material-icons" style="font-size: 48px; color: rgba(255,255,255,0.7);">radio</span>
          </div>
        `;
        albumCoverElement.style.opacity = '1';
      }, 200);
    }
  }
  
  // Update stored radio track info for consistency
  const radioTrack = (window as any)[`radioTrack_${deck}`];
  if (radioTrack && data.now_playing?.song) {
    radioTrack.title = data.now_playing.song.title;
    radioTrack.artist = data.now_playing.song.artist;
    radioTrack.coverArt = data.now_playing.song.art;
  }
}

// Setup Radio Stream Selector
function setupRadioStreamSelector() {
  const radioBtn = document.getElementById('radio-stream-btn') as HTMLButtonElement;
  const dropdown = document.getElementById('radio-stream-dropdown') as HTMLDivElement;
  const loadingDiv = document.getElementById('radio-stream-loading') as HTMLDivElement;
  const streamList = document.getElementById('radio-stream-list') as HTMLDivElement;
  
  if (!radioBtn || !dropdown || !loadingDiv || !streamList) {
    console.warn('Radio stream elements not found');
    return;
  }
  
  let isDropdownOpen = false;
  let radioStations: any[] = [];
  
  // Toggle dropdown
  const toggleDropdown = async () => {
    if (isDropdownOpen) {
      dropdown.classList.remove('show');
      radioBtn.classList.remove('active');
      isDropdownOpen = false;
    } else {
      dropdown.classList.add('show');
      radioBtn.classList.add('active');
      isDropdownOpen = true;
      
      // Load radio stations if not already loaded
      if (radioStations.length === 0) {
        await loadRadioStations();
      }
    }
  };
  
  // Load radio stations from AzuraCast
  const loadRadioStations = async () => {
    try {
      loadingDiv.style.display = 'block';
      streamList.style.display = 'none';
      
      console.log('📻 Loading radio stations...');
      
      // Get AzuraCast servers from environment
      const serverUrls = import.meta.env.VITE_AZURACAST_SERVERS?.split(',').map((url: string) => url.trim()) || [];
      
      if (serverUrls.length === 0) {
        throw new Error('No AzuraCast servers configured');
      }
      
      // Import and use the AzuraCast client
      const { fetchAllAzuraCastStations } = await import('./azuracast');
      const allServersData = await fetchAllAzuraCastStations(serverUrls);
      
      // Flatten all stations with server info
      radioStations = [];
      allServersData.forEach(serverData => {
        serverData.stations.forEach(stationResponse => {
          // Each station response has a 'station' property with the actual station data
          const station = stationResponse.station || stationResponse;
          radioStations.push({
            ...station,
            serverUrl: serverData.serverUrl,
            // Add live info from the response
            live: stationResponse.live || station.live,
            now_playing: stationResponse.now_playing || station.now_playing
          });
        });
      });
      
      console.log(`📻 Loaded ${radioStations.length} radio stations from ${allServersData.length} servers`);
      
      // Populate dropdown
      populateRadioDropdown(radioStations);
      
      loadingDiv.style.display = 'none';
      streamList.style.display = 'block';
      
    } catch (error) {
      console.error('❌ Error loading radio stations:', error);
      loadingDiv.innerHTML = `
        <span class="material-icons">error</span>
        Error loading stations
      `;
    }
  };
  
  // Populate dropdown with stations
  const populateRadioDropdown = (stations: any[]) => {
    streamList.innerHTML = '';
    
    stations.forEach(station => {
      const stationItem = document.createElement('div');
      const isLive = station.live?.is_live;
      const streamerName = station.live?.streamer_name;
      const nowPlaying = station.now_playing?.song;
      
      // Add live class for styling
      stationItem.className = `radio-stream-item ${isLive ? 'live-stream' : ''}`;
      
      // Create description text
      let description = station.description || 'Radio Stream';
      if (isLive && streamerName) {
        description = `🔴 LIVE: ${streamerName}`;
      } else if (nowPlaying) {
        description = `🎵 ${nowPlaying.artist} - ${nowPlaying.title}`;
      }
      
      stationItem.innerHTML = `
        <div class="radio-stream-info">
          <div class="radio-stream-name">
            ${isLive ? '<span class="live-indicator">●</span>' : ''}
            ${station.name}
          </div>
          <div class="radio-stream-description">${description}</div>
        </div>
        <div class="radio-stream-deck-buttons">
          <button class="radio-deck-btn" data-deck="a" data-station-id="${station.id}" data-server-url="${station.serverUrl}" data-shortcode="${station.shortcode}">A</button>
          <button class="radio-deck-btn" data-deck="b" data-station-id="${station.id}" data-server-url="${station.serverUrl}" data-shortcode="${station.shortcode}">B</button>
          <button class="radio-deck-btn" data-deck="c" data-station-id="${station.id}" data-server-url="${station.serverUrl}" data-shortcode="${station.shortcode}">C</button>
          <button class="radio-deck-btn" data-deck="d" data-station-id="${station.id}" data-server-url="${station.serverUrl}" data-shortcode="${station.shortcode}">D</button>
        </div>
      `;
      
      streamList.appendChild(stationItem);
    });
    
    // Add event listeners for deck buttons
    streamList.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      if (target.classList.contains('radio-deck-btn')) {
        const deck = target.dataset.deck;
        const stationId = target.dataset.stationId;
        const serverUrl = target.dataset.serverUrl;
        const shortcode = target.dataset.shortcode;
        const station = stations.find(s => s.id == stationId && s.serverUrl === serverUrl && s.shortcode === shortcode);
        
        if (deck && station) {
          loadRadioStreamToDeck(deck, station);
          toggleDropdown(); // Close dropdown after selection
        }
      }
    });
  };
  
  // Load radio stream to specified deck
  const loadRadioStreamToDeck = async (deck: string, station: any) => {
    try {
      console.log(`📻 Loading ${station.name} to Deck ${deck.toUpperCase()}`);
      
      // Get the audio element for the deck
      const audio = document.getElementById(`audio-${deck}`) as HTMLAudioElement;
      const titleElement = document.getElementById(`title-${deck}`) as HTMLSpanElement;
      const artistElement = document.getElementById(`artist-${deck}`) as HTMLSpanElement;
      const albumCoverElement = document.getElementById(`album-cover-${deck}`) as HTMLImageElement;
      
      if (!audio) {
        console.error(`❌ Audio element for deck ${deck} not found`);
        return;
      }
      
      // Always use standard AzuraCast listen URL format (more reliable for CORS)
      const streamUrl = `${station.serverUrl}/listen/${station.shortcode}/radio.mp3`;
      
      console.log(`📻 Stream URL: ${streamUrl}`);
      
      // Create a deck-compatible track object for the radio stream
      const radioTrack = {
        id: `radio-${station.id}`,
        title: station.name,
        artist: 'Live Radio Stream',
        album: station.description || station.name,
        duration: 0, // Live streams have no duration
        genre: station.genre || 'Radio',
        year: new Date().getFullYear(),
        track: 0,
        discNumber: 0,
        coverArt: station.now_playing?.song?.art || null,
        suffix: 'mp3',
        bitRate: station.bitrate || 128,
        path: streamUrl,
        isStream: true,
        isRadio: true,
        stationId: station.id,
        shortcode: station.shortcode,
        serverUrl: station.serverUrl
      };
      
      // Store radio track info for this deck
      (window as any)[`radioTrack_${deck}`] = radioTrack;
      
      // Load the stream
      audio.src = streamUrl;
      audio.crossOrigin = 'anonymous'; // Allow CORS for radio streams
      audio.load();
      
      // Update initial display
      updateRadioStreamDisplay(deck, station);
      
      // Subscribe to WebSocket updates for this station
      azuraCastWebSocket.subscribe(station.serverUrl, station.shortcode, (data: AzuraCastNowPlayingData) => {
        updateRadioStreamFromWebSocket(deck, station, data);
      });
      
      // Update file info display
      const fileInfo = document.querySelector(`#file-info-${deck} .file-path-display`);
      if (fileInfo) {
        fileInfo.textContent = `📻 ${station.name}`;
      }
      
      console.log(`✅ Radio stream loaded to Deck ${deck.toUpperCase()}`);
      
      // Find and show visual feedback on the clicked button
      const deckButton = document.querySelector(`[data-deck="${deck}"][data-station-id="${station.id}"]`) as HTMLButtonElement;
      if (deckButton) {
        deckButton.style.background = 'rgba(100, 255, 218, 0.3)';
        deckButton.style.borderColor = '#64FFDA';
        deckButton.style.color = '#64FFDA';
        
        setTimeout(() => {
          deckButton.style.background = '';
          deckButton.style.borderColor = '';
          deckButton.style.color = '';
        }, 2000);
      }
      
    } catch (error) {
      console.error(`❌ Error loading radio stream to deck ${deck}:`, error);
    }
  };
  
  // Event listeners
  radioBtn.addEventListener('click', toggleDropdown);
  
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (isDropdownOpen && !radioBtn.contains(e.target as Node) && !dropdown.contains(e.target as Node)) {
      toggleDropdown();
    }
  });
  
  console.log('📻 Radio stream selector initialized');
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
  
  // Get environment configuration
  const envOpenSubsonicUrl = import.meta.env.VITE_OPENSUBSONIC_URL;
  const envAzuraCastServers = import.meta.env.VITE_AZURACAST_SERVERS;
  const useUnifiedLogin = import.meta.env.VITE_USE_UNIFIED_LOGIN === 'true';
  
  // Get UI elements
  const unifiedLoginSection = document.getElementById('unified-login-section') as HTMLElement;
  const individualLoginSections = document.getElementById('individual-login-sections') as HTMLElement;
  const unifiedUsernameInput = document.getElementById('unified-username') as HTMLInputElement;
  const unifiedPasswordInput = document.getElementById('unified-password') as HTMLInputElement;
  const opensubsonicUrlValue = document.getElementById('opensubsonic-url-value') as HTMLElement;
  const azuracastUrlValue = document.getElementById('azuracast-url-value') as HTMLElement;
  
  // Individual form elements
  const serverInput = document.getElementById('OpenSubsonic-server') as HTMLInputElement;
  const usernameInput = document.getElementById('OpenSubsonic-username') as HTMLInputElement;
  const passwordInput = document.getElementById('OpenSubsonic-password') as HTMLInputElement;
  const streamServerInput = document.getElementById('stream-server-url') as HTMLInputElement;
  const streamUsernameInput = document.getElementById('stream-username') as HTMLInputElement;
  const streamPasswordInput = document.getElementById('stream-password') as HTMLInputElement;
  
  console.log(`🔧 Login Mode: ${useUnifiedLogin ? 'Unified' : 'Individual'}`);
  
  if (useUnifiedLogin) {
    // Show unified login interface
    if (unifiedLoginSection) unifiedLoginSection.style.display = 'block';
    if (individualLoginSections) individualLoginSections.style.display = 'none';
    
    // Display pre-configured URLs (read-only)
    if (opensubsonicUrlValue && envOpenSubsonicUrl) {
      opensubsonicUrlValue.textContent = envOpenSubsonicUrl;
    }
    if (azuracastUrlValue && envAzuraCastServers) {
      azuracastUrlValue.textContent = envAzuraCastServers;
    }
    
    console.log('✅ Unified login interface activated');
  } else {
    // Show individual login interface
    if (unifiedLoginSection) unifiedLoginSection.style.display = 'none';
    if (individualLoginSections) individualLoginSections.style.display = 'block';
    
    // Pre-fill URLs if available (but keep them editable)
    if (serverInput && envOpenSubsonicUrl) serverInput.value = envOpenSubsonicUrl;
    if (streamServerInput && envAzuraCastServers) streamServerInput.value = envAzuraCastServers;
    
    console.log('✅ Individual login interface activated');
  }
  
  // Clean up any existing unified info
  const existingUnifiedInfo = loginForm.querySelector('.unified-login-info');
  if (existingUnifiedInfo) {
    existingUnifiedInfo.remove();
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
        
        // Update login state
        isOpenSubsonicLoggedIn = true;
        autoLoginInProgress = false;
        
        // Update OpenSubsonic user status
        updateUserStatus('opensubsonic', username, true);
        
        // Configure streaming with unified or individual credentials
        if (useUnifiedLogin && envAzuraCastServers) {
          // Unified login: use the same credentials for streaming
          streamConfig.username = username;
          streamConfig.password = password;
          console.log(`🎙️ Stream configuration updated with unified credentials for: ${username}`);
          updateUserStatus('stream', username, true);
        } else {
          console.log('ℹ️ Stream configuration: Individual login mode or no AzuraCast servers configured');
        }
        
        // Hide login form, show DJ controls
        loginForm.style.display = 'none';
        djControls.style.display = 'flex';
        
        // Initialize Live Streaming functionality (after DJ controls are visible)
        initializeLiveStreaming();
        
        // Auto-initialize microphone after successful login
        console.log("🎤 Auto-initializing microphone...");
        try {
          if (!audioContext) {
            await initializeAudioMixing();
          }
          
          if (audioContext && audioContext.state === 'suspended') {
            await audioContext.resume();
          }
          
          const micReady = await setupMicrophone();
          if (micReady) {
            console.log("🎤 Microphone auto-initialized successfully (muted by default)");
            // Microphone is now always recording but muted by default
            setMicrophoneEnabled(false); // Start muted
            
            // Start microphone volume meter immediately
            setTimeout(() => {
              if (typeof startVolumeMeter === 'function') {
                startVolumeMeter('mic');
                console.log("🎤 Microphone volume meter started");
              }
            }, 100);
          }
        } catch (error) {
          console.warn("⚠️ Microphone auto-initialization failed:", error);
        }
        
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
        // Reset login state
        isOpenSubsonicLoggedIn = false;
        autoLoginInProgress = false;
        
        // Reset user status indicators
        updateUserStatus('opensubsonic', '-', false);
        // Stream status removed (streaming functionality removed)
        
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
      // Reset login state on error
      isOpenSubsonicLoggedIn = false;
      autoLoginInProgress = false;
      
      // Reset user status indicators on error
      updateUserStatus('opensubsonic', '-', false);
      // Stream status removed (streaming functionality removed)
      
      if (loginBtn) {
        loginBtn.textContent = 'Connection Error';
        setTimeout(() => {
          loginBtn.textContent = 'Connect';
          loginBtn.disabled = false;
        }, 2000);
      }
    }
  };
  
  // Define login handler based on mode
  const performLoginFromForm = async () => {
    if (useUnifiedLogin) {
      // Unified login: get credentials from unified form, URLs from environment
      const username = unifiedUsernameInput?.value.trim();
      const password = unifiedPasswordInput?.value.trim();
      const serverUrl = envOpenSubsonicUrl;
      
      if (!username || !password) {
        console.log('❌ Please enter username and password');
        if (loginBtn) {
          loginBtn.textContent = 'Credentials Required';
          setTimeout(() => {
            loginBtn.textContent = 'Connect';
            loginBtn.disabled = false;
          }, 2000);
        }
        return;
      }
      
      if (!serverUrl) {
        console.log('❌ OpenSubsonic server URL not configured');
        if (loginBtn) {
          loginBtn.textContent = 'Server Not Configured';
          setTimeout(() => {
            loginBtn.textContent = 'Connect';
            loginBtn.disabled = false;
          }, 2000);
        }
        return;
      }
      
      await performLogin(serverUrl, username, password);
      
    } else {
      // Individual login: get all values from individual form
      const username = usernameInput?.value.trim();
      const password = passwordInput?.value.trim();
      const serverUrl = serverInput?.value.trim();
      
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
      
      if (!username || !password) {
        console.log('❌ Please enter username and password');
        if (loginBtn) {
          loginBtn.textContent = 'Credentials Required';
          setTimeout(() => {
            loginBtn.textContent = 'Connect';
            loginBtn.disabled = false;
          }, 2000);
        }
        return;
      }
      
      await performLogin(serverUrl, username, password);
    }
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
      
      // WaveSurfer Progressbar auch zurücksetzen
      const wavesurfer = waveSurfers[side];
      if (wavesurfer) {
        try {
          wavesurfer.seekTo(0);
          console.log(`🌊 WaveSurfer ${side.toUpperCase()} reset to position 0`);
        } catch (e) {
          console.warn(`⚠️ WaveSurfer reset error on Player ${side}:`, e);
        }
      }
      
      console.log(`🔄 Player ${side.toUpperCase()} restarted`);
    } else {
      console.log(`❌ No track loaded on Player ${side}`);
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
  
  // Cleanup radio stream if one was loaded before
  const radioTrack = (window as any)[`radioTrack_${side}`];
  if (radioTrack) {
    console.log(`📻 Cleaning up radio stream for deck ${side.toUpperCase()}`);
    
    // Unsubscribe from WebSocket updates
    if (radioTrack.shortcode && radioTrack.serverUrl) {
      azuraCastWebSocket.unsubscribeAll(radioTrack.serverUrl, radioTrack.shortcode);
    }
    
    // Remove radio track reference
    delete (window as any)[`radioTrack_${side}`];
  }
  
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
  
  // Audio-Event-Listener werden nach allen Funktionsdefinitionen hinzugefügt
  setupAudioEventListeners(audio, side);
  
  // Update drag functionality for this deck after loading
  setTimeout(() => {
    const albumCover = document.getElementById(`album-cover-${side}`);
    if (albumCover) {
      // Trigger dragability update
      const updateEvent = new Event('loadeddata');
      audio.dispatchEvent(updateEvent);
      console.log(`🎵 Updated drag functionality for deck ${side} after loading track`);
    }
  }, 100);
  
  // Note: We don't sync WaveSurfer with audio to avoid double playback
  // WaveSurfer handles playback directly via play button
  
  // Song ID für Rating-System speichern
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
    if (crossfaderGain) {
      // Position zwischen 0 und 1 begrenzen
      const clampedPosition = Math.max(0, Math.min(1, position));
      
      // Links: maximum bei 0, minimum bei 1
      const leftGain = Math.cos(clampedPosition * Math.PI / 2);
      // Rechts: minimum bei 0, maximum bei 1
      const rightGain = Math.sin(clampedPosition * Math.PI / 2);
      
      // Monitor-Crossfader
      crossfaderGain.a.gain.value = leftGain;
      crossfaderGain.b.gain.value = rightGain;
      
      console.log(`🎚️ Crossfader Web Audio: ${position}, Left: ${leftGain.toFixed(2)}, Right: ${rightGain.toFixed(2)} (Monitor)`);
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
  console.log('🎯 Initializing all player drop zones...');
  
  // Debug: Check if elements exist
  ['a', 'b', 'c', 'd'].forEach(side => {
    const deck = document.getElementById(`player-${side}`);
    console.log(`🎯 Player ${side} deck:`, deck ? 'FOUND' : 'NOT FOUND', deck);
  });
  
  // Ensure body allows drop events
  document.body.addEventListener('dragover', (e) => {
    console.log('🌐 Body dragover event fired');
    e.preventDefault(); // Allow drop
  });
  
  document.body.addEventListener('drop', (e) => {
    console.log('🌐 Body drop event fired');
    e.preventDefault(); // Prevent default file handling
  });
  
  // Test: Add a global drag detection
  document.addEventListener('dragstart', (e) => {
    console.log('🚀 GLOBAL DRAGSTART detected:', e.target);
    console.log('🚀 Draggable element:', e.target);
    console.log('🚀 DataTransfer available:', !!e.dataTransfer);
  });
  
  initializePlayerDropZone('a');
  initializePlayerDropZone('b');
  initializePlayerDropZone('c');
  initializePlayerDropZone('d');
  
  console.log('🎯 All player drop zones initialized');
  
  // Debug: Test all current draggable elements
  setTimeout(() => {
    debugDraggableElements();
  }, 2000);
}

// Debug function to test all draggable elements
function debugDraggableElements() {
  console.log('🔍 DEBUGGING DRAGGABLE ELEMENTS:');
  
  const draggableElements = document.querySelectorAll('[draggable="true"]');
  console.log(`🔍 Found ${draggableElements.length} draggable elements:`);
  
  draggableElements.forEach((element, index) => {
    console.log(`🔍 Draggable ${index + 1}:`, element);
    console.log(`  - Tag: ${element.tagName}`);
    console.log(`  - Classes: ${element.className}`);
    console.log(`  - ID: ${element.id}`);
    console.log(`  - Has dragstart listener:`, element.hasAttribute('ondragstart') || element.addEventListener.length > 0);
  });
  
  // Test drop zones
  console.log('🔍 DEBUGGING DROP ZONES:');
  ['a', 'b', 'c', 'd'].forEach(side => {
    const deck = document.getElementById(`player-${side}`);
    if (deck) {
      console.log(`🔍 Drop zone ${side}:`, deck);
      console.log(`  - Has drag-over class:`, deck.classList.contains('drag-over'));
      console.log(`  - Style display:`, getComputedStyle(deck).display);
      console.log(`  - Style visibility:`, getComputedStyle(deck).visibility);
      console.log(`  - Style pointer-events:`, getComputedStyle(deck).pointerEvents);
      console.log(`  - Style z-index:`, getComputedStyle(deck).zIndex);
      console.log(`  - Style position:`, getComputedStyle(deck).position);
    }
  });
  
  // Check for overlapping elements
  console.log('🔍 CHECKING FOR OVERLAPPING ELEMENTS:');
  const overlays = document.querySelectorAll('[style*="position: fixed"], [style*="position: absolute"], .disconnect-timer-overlay, .stream-config-panel');
  overlays.forEach((overlay, index) => {
    const computed = getComputedStyle(overlay);
    console.log(`🔍 Overlay ${index + 1}:`, overlay);
    console.log(`  - Display:`, computed.display);
    console.log(`  - Visibility:`, computed.visibility);
    console.log(`  - Z-index:`, computed.zIndex);
    console.log(`  - Pointer-events:`, computed.pointerEvents);
    console.log(`  - Classes:`, overlay.className);
  });
}

// Global debug function - call this from browser console
(window as any).debugDragDrop = function() {
  console.log('🔧 MANUAL DRAG & DROP DEBUG STARTED');
  debugDraggableElements();
  
  // Test if we can manually trigger drag events
  const firstDraggable = document.querySelector('[draggable="true"]');
  if (firstDraggable) {
    console.log('🔧 Testing manual drag event on:', firstDraggable);
    
    const dragEvent = new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      dataTransfer: new DataTransfer()
    });
    
    const result = firstDraggable.dispatchEvent(dragEvent);
    console.log('🔧 Manual drag event result:', result);
  }
  
  // Test drop zones
  ['a', 'b', 'c', 'd'].forEach(side => {
    const deck = document.getElementById(`player-${side}`);
    if (deck) {
      console.log(`🔧 Testing drop zone ${side}`);
      
      const dragOverEvent = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer()
      });
      
      const result = deck.dispatchEvent(dragOverEvent);
      console.log(`🔧 Drop zone ${side} dragover result:`, result);
    }
  });
};

console.log('🔧 Debug function ready! Call debugDragDrop() from browser console to test.');

function initializePlayerDropZone(side: 'a' | 'b' | 'c' | 'd') {
  const playerDeck = document.getElementById(`player-${side}`);
  if (!playerDeck) {
    console.warn(`Player deck ${side} not found for drop zone setup`);
    return;
  }
  
  console.log(`🎯 Setting up drop zone for player ${side}`);
  
  playerDeck.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log(`🎯 Dragover on player ${side}`);
    if (e.dataTransfer) {
      // Check if it's a deck-to-deck move
      const jsonData = e.dataTransfer.getData('application/json');
      if (jsonData) {
        try {
          const dragData = JSON.parse(jsonData);
          if (dragData.type === 'deck-song') {
            e.dataTransfer.dropEffect = 'move'; // Move operation for deck songs
          } else {
            e.dataTransfer.dropEffect = 'copy'; // Copy operation for library songs
          }
        } catch {
          e.dataTransfer.dropEffect = 'copy'; // Fallback
        }
      } else {
        e.dataTransfer.dropEffect = 'copy'; // Fallback
      }
    }
    playerDeck.classList.add('drag-over');
  });
  
  playerDeck.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log(`🎯 Dragenter on player ${side}`);
  });
  
  playerDeck.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log(`🎯 Dragleave on player ${side}`);
    playerDeck.classList.remove('drag-over');
  });
  
  playerDeck.addEventListener('drop', async (e) => {
    console.log(`🎯 DROP EVENT on player ${side}!`);
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
          const sourceDeck = songData.sourceDeck;
          console.log(`🎵 Detected deck-song drop: from ${sourceDeck} to ${side}, song:`, song);
          
          if (song) {
            console.log(`🎵 Moving deck song from ${sourceDeck?.toUpperCase()} to ${side.toUpperCase()}: "${song.title}"`);
            
            // Load track to target deck
            if (song && songId) {
              console.log(`⬇️ Moving song ${songId} from Player ${sourceDeck?.toUpperCase()} to Player ${side.toUpperCase()}`);
              
              // Load track to target deck WITHOUT auto-play
              loadTrackToPlayer(side, song, false);
              console.log(`✅ Track "${song.title}" moved to Player ${side.toUpperCase()}`);
              
              // Clear the source deck (move operation)
              if (sourceDeck && sourceDeck !== side) {
                console.log(`🗑️ About to clear source deck ${sourceDeck.toUpperCase()}`);
                try {
                  clearPlayerDeck(sourceDeck as 'a' | 'b' | 'c' | 'd');
                  console.log(`✅ Source deck ${sourceDeck.toUpperCase()} cleared successfully`);
                } catch (error) {
                  console.error(`❌ Error clearing source deck ${sourceDeck.toUpperCase()}:`, error);
                }
              } else {
                console.log(`ℹ️ Not clearing source deck (same as target or invalid): source=${sourceDeck}, target=${side}`);
              }
              return; // Exit early since we handled the move
            } else {
              console.error(`❌ Missing song or songId for move operation`);
            }
          } else {
            console.error(`❌ No song data in deck-song drop`);
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
    
    if (target.classList.contains('star') || target.classList.contains('rating-star')) {
      let rating = parseInt(target.dataset.rating || '0');
      let songId = target.dataset.songId;
      
      // Fallback: Wenn kein data-song-id, prüfe ob es ein Player-Rating ist
      if (!songId) {
        const playerRatingContainer = target.closest('[id^="player-rating-"]');
        if (playerRatingContainer) {
          const playerId = playerRatingContainer.id.split('-')[2]; // z.B. "a" aus "player-rating-a"
          const audio = document.getElementById(`audio-${playerId}`) as HTMLAudioElement;
          songId = audio?.dataset.songId;
          
          // Rating über Position im Container ermitteln
          if (!rating) {
            const stars = Array.from(playerRatingContainer.querySelectorAll('.star, .rating-star'));
            rating = stars.indexOf(target) + 1;
          }
        }
      }
      
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
    
    if (target.classList.contains('star') || target.classList.contains('rating-star')) {
      let rating = parseInt(target.dataset.rating || '0');
      let songId = target.dataset.songId;
      
      // Fallback: Wenn kein data-song-id, prüfe ob es ein Player-Rating ist
      if (!songId) {
        const playerRatingContainer = target.closest('[id^="player-rating-"]');
        if (playerRatingContainer) {
          const playerId = playerRatingContainer.id.split('-')[2]; // z.B. "a" aus "player-rating-a"
          const audio = document.getElementById(`audio-${playerId}`) as HTMLAudioElement;
          songId = audio?.dataset.songId;
          
          // Rating über Position im Container ermitteln
          if (!rating) {
            const stars = Array.from(playerRatingContainer.querySelectorAll('.star, .rating-star'));
            rating = stars.indexOf(target) + 1;
          }
        }
      }
      
      if (songId && rating > 0) {
        highlightStars(songId, rating);
      }
    }
  });
  
  document.addEventListener('mouseout', (event) => {
    const target = event.target as HTMLElement;
    
    if (target.classList.contains('star') || target.classList.contains('rating-star')) {
      let songId = target.dataset.songId;
      
      // Fallback: Wenn kein data-song-id, prüfe ob es ein Player-Rating ist
      if (!songId) {
        const playerRatingContainer = target.closest('[id^="player-rating-"]');
        if (playerRatingContainer) {
          const playerId = playerRatingContainer.id.split('-')[2]; // z.B. "a" aus "player-rating-a"
          const audio = document.getElementById(`audio-${playerId}`) as HTMLAudioElement;
          songId = audio?.dataset.songId;
        }
      }
      
      if (songId) {
        resetStarHighlight(songId);
      }
    }
  });
}

// Sterne für Hover-Effekt hervorheben
function highlightStars(songId: string, rating: number) {
  // Alle Rating-Container für diesen Song finden
  const ratingContainers = document.querySelectorAll(`[data-song-id="${songId}"]`);
  
  ratingContainers.forEach(container => {
    // Alle Sterne in diesem Container (sowohl .star als auch .rating-star)
    const stars = container.querySelectorAll('.star, .rating-star');
    
    stars.forEach((star, index) => {
      const starElement = star as HTMLElement;
      if (index < rating) {
        starElement.classList.add('hover-preview');
      } else {
        starElement.classList.remove('hover-preview');
      }
    });
  });
  
  // Auch Player-Rating-Container für diesen Song hervorheben
  const playerRatings = document.querySelectorAll(`[id^="player-rating-"]`);
  playerRatings.forEach(playerRating => {
    const stars = playerRating.querySelectorAll('.star, .rating-star');
    // Prüfen ob dieser Player den Song hat
    const playerId = playerRating.id.split('-')[2]; // z.B. "a" aus "player-rating-a"
    const audio = document.getElementById(`audio-${playerId}`) as HTMLAudioElement;
    
    if (audio && audio.dataset.songId === songId) {
      stars.forEach((star, index) => {
        const starElement = star as HTMLElement;
        if (index < rating) {
          starElement.classList.add('hover-preview');
        } else {
          starElement.classList.remove('hover-preview');
        }
      });
    }
  });
}

// Stern-Highlight zurücksetzen
function resetStarHighlight(songId: string) {
  // Alle Rating-Container für diesen Song finden
  const ratingContainers = document.querySelectorAll(`[data-song-id="${songId}"]`);
  
  ratingContainers.forEach(container => {
    const stars = container.querySelectorAll('.star, .rating-star');
    stars.forEach(star => {
      star.classList.remove('hover-preview');
    });
  });
  
  // Auch Player-Rating-Container für diesen Song zurücksetzen
  const playerRatings = document.querySelectorAll(`[id^="player-rating-"]`);
  playerRatings.forEach(playerRating => {
    const stars = playerRating.querySelectorAll('.star, .rating-star');
    // Prüfen ob dieser Player den Song hat
    const playerId = playerRating.id.split('-')[2]; // z.B. "a" aus "player-rating-a"
    const audio = document.getElementById(`audio-${playerId}`) as HTMLAudioElement;
    
    if (audio && audio.dataset.songId === songId) {
      stars.forEach(star => {
        star.classList.remove('hover-preview');
      });
    }
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
  
  // AnalyserNode für Audio-Level-Messung
  let analyser: AnalyserNode;
  
  if (side === 'mic') {
    // Verwende den bereits erstellten micAnalyser für bessere Performance
    analyser = (window as any).micAnalyser;
    if (!analyser) {
      console.warn('🎤 Microphone analyser not available yet');
      return;
    }
  } else {
    // Für Player: erstelle neue Analyser
    let gainNode: GainNode | null = null;
    
    if (side === 'a') {
      gainNode = aPlayerGain;
    } else if (side === 'b') {
      gainNode = bPlayerGain;
    } else if (side === 'c') {
      gainNode = cPlayerGain;
    } else if (side === 'd') {
      gainNode = dPlayerGain;
    }
    
    if (!gainNode) return;
    
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    
    // Verbinde Gain Node mit Analyser (ohne Audio-Flow zu stören)
    gainNode.connect(analyser);
  }
  
  try {
    
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

// Volume Meter Auto-Start (will be called from main initialization)
function autoStartVolumeMeters() {
  // Auto-start volume meters when audio mixing is initialized
  setTimeout(() => {
    if (audioContext) {
      console.log('🎵 Auto-starting volume meters...');
      startVolumeMeter('a');
      startVolumeMeter('b');
      startVolumeMeter('c');
      startVolumeMeter('d');
      startVolumeMeter('mic');
    }
  }, 1000);
}

// Live Streaming State
let isLiveStreaming = false;
let liveStreamStartTime: number = 0;

// Initialize Live Streaming Click Handler
function initializeLiveStreaming() {
  const streamLiveButton = document.getElementById('stream-live-status') as HTMLButtonElement;
  
  if (streamLiveButton) {
    console.log('🔴 Live streaming button found and event listeners added');
    
    // Add click listener for normal clicks (station selection and streaming start)
    // Note: This handles single clicks, while mousedown/mouseup handle press-and-hold disconnect
    streamLiveButton.addEventListener('click', async (e) => {
      const timestamp = Date.now();
      e.preventDefault();
      console.log(`🔘 [${timestamp}] CLICK EVENT - Current state: ${currentButtonState}, Station ID: ${currentStationId}, isLiveStreaming: ${isLiveStreaming}`);
      
      switch (currentButtonState) {
        case StreamButtonState.SELECT_STATION:
          // Check if streaming is active - if so, block station selection
          if (isLiveStreaming) {
            console.log('🚫 Station selection blocked - streaming is active');
            alert('Cannot change station while streaming is active. Please stop the stream first.');
            return;
          }
          
          console.log('📋 Opening station selection dropdown');
          // This should be handled by the dropdown logic - let it bubble up
          break;
          
        case StreamButtonState.START_STREAMING:
          // If streaming is already active, show warning instead of triggering disconnect
          if (isLiveStreaming) {
            console.log(`🔴 [${timestamp}] CLICK blocked - stream is already active`);
            showWarningMessage("stream is active!<br>press and hold for 5 seconds to disconnect");
            return;
          }
          
          console.log(`🚀 [${timestamp}] Starting streaming via CLICK event`);
          // Start streaming directly
          await startLiveStreaming();
          break;
          
        case StreamButtonState.STREAMING_ACTIVE:
          console.log(`⏹️ [${timestamp}] CLICK on active stream - showing press-and-hold message`);
          // Show warning instead of starting countdown via click
          showWarningMessage("stream is active!<br>press and hold for 5 seconds to disconnect");
          break;
          
        default:
          console.warn(`⚠️ Unknown button state: ${currentButtonState}`);
      }
    });

    // Add mousedown/mouseup listeners for press-and-hold disconnect functionality
    streamLiveButton.addEventListener('mousedown', (e) => {
      const timestamp = Date.now();
      e.preventDefault();
      console.log(`🔴 [${timestamp}] MOUSEDOWN EVENT - Current state: ${currentButtonState}, isLiveStreaming: ${isLiveStreaming}`);
      
      // Only handle mousedown for DISCONNECT when streaming is active
      if (currentButtonState !== StreamButtonState.STREAMING_ACTIVE) {
        console.log(`📋 [${timestamp}] MOUSEDOWN ignored - not in streaming mode`);
        return;
      }
      
      // Only start disconnect countdown when streaming is active
      if (isLiveStreaming) {
        console.log(`⏹️ [${timestamp}] Starting disconnect countdown (MOUSEDOWN - press and hold)`);
        startDisconnectCountdown();
      }
    });
    
    streamLiveButton.addEventListener('mouseup', (e) => {
      const timestamp = Date.now();
      e.preventDefault();
      console.log(`🔴 [${timestamp}] MOUSEUP EVENT - Current state: ${currentButtonState}, isLiveStreaming: ${isLiveStreaming}`);
      
      // Only handle mouseup for DISCONNECT when streaming is active
      if (currentButtonState !== StreamButtonState.STREAMING_ACTIVE) {
        console.log(`📋 [${timestamp}] MOUSEUP ignored - not in streaming mode`);
        return;
      }
      
      // Stop disconnect countdown if streaming is active
      if (isLiveStreaming) {
        console.log(`⏹️ [${timestamp}] Stopping disconnect countdown (MOUSEUP - mouse released)`);
        handleStreamButtonRelease();
      }
    });
    
    streamLiveButton.addEventListener('mouseleave', (e) => {
      const timestamp = Date.now();
      e.preventDefault();
      console.log(`🔴 [${timestamp}] MOUSELEAVE EVENT - Current state: ${currentButtonState}, isLiveStreaming: ${isLiveStreaming}`);
      
      // Only handle mouseleave for DISCONNECT when streaming is active
      if (currentButtonState !== StreamButtonState.STREAMING_ACTIVE) {
        console.log(`📋 [${timestamp}] MOUSELEAVE ignored - not in streaming mode`);
        return;
      }
      
      // Stop disconnect countdown if streaming is active
      if (isLiveStreaming) {
        console.log(`⏹️ [${timestamp}] Stopping disconnect countdown (MOUSELEAVE - mouse left)`);
        handleStreamButtonRelease();
      }
    });
    
    // Prevent context menu
    streamLiveButton.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
  } else {
    console.log('❌ Live streaming button not found');
  }
}

// Handle stream button press (mousedown) - Only for disconnect countdown
function handleStreamButtonPress() {
  console.log(`🔘 handleStreamButtonPress - Current state: ${currentButtonState}, Station ID: ${currentStationId}`);
  
  // Only handle disconnect countdown when streaming is active
  if (!isLiveStreaming || currentButtonState !== StreamButtonState.STREAMING_ACTIVE) {
    console.log('🔘 Not streaming or wrong state - press ignored');
    return;
  }
  
  // Start disconnect countdown for live streaming
  console.log('⏹️ Starting disconnect countdown (streaming is active)');
  startDisconnectCountdown();
}

// Handle stream button release (mouseup/mouseleave)
function handleStreamButtonRelease() {
  const timestamp = Date.now();
  console.log(`⏹️ [${timestamp}] handleStreamButtonRelease() CALLED - isDisconnecting: ${isDisconnecting}, isLiveStreaming: ${isLiveStreaming}`);
  
  if (isDisconnecting) {
    // Stop countdown and show warning only if already connected
    console.log(`🛑 [${timestamp}] Stopping disconnect countdown`);
    stopDisconnectCountdown();
    if (isLiveStreaming) {
      // Only show warning if stream has been live for more than 1 second
      const streamDuration = Date.now() - liveStreamStartTime;
      console.log(`⏰ [${timestamp}] Stream duration: ${streamDuration}ms`);
      if (streamDuration > 1000) {
        console.log(`⚠️ [${timestamp}] Showing safety warning`);
        showWarningMessage("safety mechanism active!<br>press and hold for 5 seconds to disconnect");
      }
    }
  }
}

// Variables for disconnect timer
let disconnectTimer: NodeJS.Timeout | null = null;
let disconnectStartTime: number = 0;
let isDisconnecting: boolean = false;
const DISCONNECT_DURATION = 5000; // 5 seconds in milliseconds

// Toggle Live Streaming with Hold-to-Disconnect
function toggleLiveStreaming() {
  const streamLiveButton = document.getElementById('stream-live-status') as HTMLButtonElement;
  
  if (!streamLiveButton) return;
  
  if (!isLiveStreaming) {
    // Start Live Streaming (instant)
    startLiveStreaming();
  } else {
    // Stop Live Streaming requires hold-to-disconnect (only if connected)
    if (isLiveStreaming) {
      // Only show warning if stream has been live for more than 1 second
      const streamDuration = Date.now() - liveStreamStartTime;
      if (streamDuration > 1000) {
        showWarningMessage("safety mechanism active!<br>press and hold for 5 seconds to disconnect");
      }
    }
  }
}

// Start Live Streaming with actual AzuraCast connection
async function startLiveStreaming() {
  const timestamp = Date.now();
  console.log(`🚀 [${timestamp}] startLiveStreaming() CALLED - Entry point`);
  
  const streamLiveButton = document.getElementById('stream-live-status') as HTMLButtonElement;
  if (!streamLiveButton) {
    console.error(`❌ [${timestamp}] startLiveStreaming() - button not found`);
    return;
  }
  
  // Check prerequisites
  if (!currentStationId || !currentStationShortcode || !currentServerUrl) {
    console.error(`❌ [${timestamp}] startLiveStreaming() - prerequisites missing - Station ID: ${currentStationId}, Shortcode: ${currentStationShortcode}, Server: ${currentServerUrl}`);
    alert('Please select a station first before starting to stream.');
    return;
  }
  
  console.log(`🔴 STARTING LIVE STREAMING to station: ${currentStationId} (${currentStationShortcode})`);
  
  try {
    // Show loading status
    streamLiveButton.textContent = 'Connecting...';
    streamLiveButton.classList.add('connecting');
    
    // Start the actual AzuraCast streaming
    const startStreamingFunc = (window as any).__startAzuraCastStreaming;
    if (!startStreamingFunc) {
      throw new Error('AzuraCast streaming function not available');
    }
    await startStreamingFunc();
    
    // Update streaming state and UI
    isLiveStreaming = true;
    liveStreamStartTime = Date.now();
    currentButtonState = StreamButtonState.STREAMING_ACTIVE;
    
    streamLiveButton.classList.remove('connecting');
    streamLiveButton.classList.add('live');
    streamLiveButton.textContent = 'LIVE';
    
    // 🔥 Funken-Effekt für die ersten 10 Sekunden
    streamLiveButton.classList.add('sparks-effect');
    setTimeout(() => {
      streamLiveButton.classList.remove('sparks-effect');
    }, 10000);
    
    console.log('✅ LIVE STREAMING STARTED SUCCESSFULLY!');
    
  } catch (error) {
    console.error('❌ Failed to start live streaming:', error);
    alert(`Failed to start streaming: ${error instanceof Error ? error.message : String(error)}`);
    
    // Reset UI on error
    streamLiveButton.classList.remove('connecting', 'live');
    streamLiveButton.textContent = currentStationShortcode || 'ERROR';
    currentButtonState = StreamButtonState.START_STREAMING;
  }
}

// GLOBALE FUNKTION: Alle Disconnect-Effekte sofort stoppen
function clearAllDisconnectEffects() {
  console.log('🛑 CLEARING ALL DISCONNECT EFFECTS...');
  
  // Alle CSS-Klassen entfernen
  document.querySelectorAll('*').forEach(el => {
    el.classList.remove('global-flicker-weak', 'global-flicker-medium', 'global-flicker-extreme', 
                        'global-shake-weak', 'global-shake-medium', 'global-shake-crazy', 
                        'global-disco-flash', 'mixer-crt-flicker', 'mixer-crt-blur', 
                        'mixer-crt-scanlines', 'mixer-crt-static');
  });
  
  // Zusätzlich: CSS-Override einfügen um Animationen zu stoppen
  let overrideStyle = document.getElementById('disconnect-effects-override');
  if (!overrideStyle) {
    overrideStyle = document.createElement('style');
    overrideStyle.id = 'disconnect-effects-override';
    document.head.appendChild(overrideStyle);
  }
  
  overrideStyle.textContent = `
    .global-flicker-weak,
    .global-flicker-medium,
    .global-flicker-extreme,
    .global-shake-weak,
    .global-shake-medium,
    .global-shake-crazy,
    .global-disco-flash,
    .mixer-crt-flicker,
    .mixer-crt-blur,
    .mixer-crt-scanlines,
    .mixer-crt-static {
      animation: none !important;
      transform: none !important;
      filter: none !important;
      opacity: 1 !important;
      background-color: initial !important;
      box-shadow: none !important;
      background-image: none !important;
    }
  `;
  
  // Style-Override nach 500ms wieder entfernen um normale Animationen zu erlauben
  setTimeout(() => {
    if (overrideStyle && overrideStyle.parentNode) {
      overrideStyle.remove();
    }
    console.log('✅ Disconnect effects cleanup complete - normal animations restored');
  }, 500);
}

// THREE.JS EXPLOSIONS-SYSTEM
let explosionScene: THREE.Scene | null = null;
let explosionRenderer: THREE.WebGLRenderer | null = null;
let explosionCamera: THREE.PerspectiveCamera | null = null;
let explosionParticles: THREE.Points[] = [];
let smokeClouds: THREE.Points[] = [];
let animationId: number | null = null;

function initExplosionSystem() {
  // Scene erstellen
  explosionScene = new THREE.Scene();
  
  // Camera erstellen
  explosionCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  explosionCamera.position.z = 5;
  
  // Renderer erstellen (transparent für Overlay)
  explosionRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  explosionRenderer.setSize(window.innerWidth, window.innerHeight);
  explosionRenderer.setClearColor(0x000000, 0); // Transparenter Hintergrund
  
  // Canvas als Overlay hinzufügen
  const canvas = explosionRenderer.domElement;
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '9999';
  canvas.id = 'explosion-canvas';
  
  document.body.appendChild(canvas);
  
  console.log('🎆 Three.js explosion system initialized');
}

function createExplosion(element: Element) {
  if (!explosionScene || !explosionRenderer || !explosionCamera) return;
  
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  
  // Weltkoordinaten berechnen
  const worldX = (centerX / window.innerWidth) * 2 - 1;
  const worldY = -(centerY / window.innerHeight) * 2 + 1;
  
  // Partikel-Geometrie für Explosion
  const particles = new THREE.BufferGeometry();
  const particleCount = 100;
  const positions = new Float32Array(particleCount * 3);
  const velocities = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  
  for (let i = 0; i < particleCount; i++) {
    const i3 = i * 3;
    
    // Startposition (Container-Position)
    positions[i3] = worldX * 2;
    positions[i3 + 1] = worldY * 2;
    positions[i3 + 2] = 0;
    
    // Zufällige Geschwindigkeit in alle Richtungen
    velocities[i3] = (Math.random() - 0.5) * 0.4;
    velocities[i3 + 1] = (Math.random() - 0.5) * 0.4;
    velocities[i3 + 2] = (Math.random() - 0.5) * 0.2;
    
    // Orange/Rot/Gelb Explosion-Farben
    colors[i3] = 1.0; // R
    colors[i3 + 1] = Math.random() * 0.8; // G
    colors[i3 + 2] = 0.0; // B
  }
  
  particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particles.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
  particles.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  
  // Partikel-Material
  const material = new THREE.PointsMaterial({
    size: 0.1,
    vertexColors: true,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending
  });
  
  const particleSystem = new THREE.Points(particles, material);
  particleSystem.userData = { life: 1.0, decay: 0.02 };
  
  explosionScene.add(particleSystem);
  explosionParticles.push(particleSystem);
  
  console.log(`💥 Explosion created at (${centerX}, ${centerY})`);
}

function createSmokeCloud(element: Element) {
  if (!explosionScene || !explosionRenderer || !explosionCamera) return;
  
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  
  // Weltkoordinaten berechnen
  const worldX = (centerX / window.innerWidth) * 2 - 1;
  const worldY = -(centerY / window.innerHeight) * 2 + 1;
  
  // Rauch-Partikel
  const smoke = new THREE.BufferGeometry();
  const smokeCount = 50;
  const positions = new Float32Array(smokeCount * 3);
  const velocities = new Float32Array(smokeCount * 3);
  const colors = new Float32Array(smokeCount * 3);
  
  for (let i = 0; i < smokeCount; i++) {
    const i3 = i * 3;
    
    // Startposition mit leichter Streuung
    positions[i3] = worldX * 2 + (Math.random() - 0.5) * 0.5;
    positions[i3 + 1] = worldY * 2 + (Math.random() - 0.5) * 0.3;
    positions[i3 + 2] = 0;
    
    // Langsame Aufwärtsbewegung
    velocities[i3] = (Math.random() - 0.5) * 0.02;
    velocities[i3 + 1] = Math.random() * 0.05 + 0.02;
    velocities[i3 + 2] = (Math.random() - 0.5) * 0.01;
    
    // Grau-Rauch-Farben
    const gray = 0.3 + Math.random() * 0.4;
    colors[i3] = gray;
    colors[i3 + 1] = gray;
    colors[i3 + 2] = gray;
  }
  
  smoke.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  smoke.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
  smoke.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  
  // Rauch-Material
  const material = new THREE.PointsMaterial({
    size: 0.15,
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    blending: THREE.NormalBlending
  });
  
  const smokeSystem = new THREE.Points(smoke, material);
  smokeSystem.userData = { life: 5.0, decay: 0.004 }; // 5 Sekunden Lebensdauer
  
  explosionScene.add(smokeSystem);
  smokeClouds.push(smokeSystem);
  
  console.log(`💨 Smoke cloud created at (${centerX}, ${centerY})`);
}

function animateExplosions() {
  if (!explosionScene || !explosionRenderer || !explosionCamera) return;
  
  // Explosions-Partikel updaten
  for (let i = explosionParticles.length - 1; i >= 0; i--) {
    const particles = explosionParticles[i];
    const positions = particles.geometry.attributes.position;
    const velocities = particles.geometry.attributes.velocity;
    const material = particles.material as THREE.PointsMaterial;
    
    // Partikel bewegen
    for (let j = 0; j < positions.count; j++) {
      const j3 = j * 3;
      positions.array[j3] += velocities.array[j3];
      positions.array[j3 + 1] += velocities.array[j3 + 1];
      positions.array[j3 + 2] += velocities.array[j3 + 2];
      
      // Gravitation simulieren
      velocities.array[j3 + 1] -= 0.005;
    }
    
    positions.needsUpdate = true;
    
    // Lebensdauer reduzieren
    particles.userData.life -= particles.userData.decay;
    material.opacity = particles.userData.life;
    
    // Tote Partikel entfernen
    if (particles.userData.life <= 0) {
      explosionScene.remove(particles);
      explosionParticles.splice(i, 1);
    }
  }
  
  // Rauch-Partikel updaten
  for (let i = smokeClouds.length - 1; i >= 0; i--) {
    const smoke = smokeClouds[i];
    const positions = smoke.geometry.attributes.position;
    const velocities = smoke.geometry.attributes.velocity;
    const material = smoke.material as THREE.PointsMaterial;
    
    // Rauch bewegen
    for (let j = 0; j < positions.count; j++) {
      const j3 = j * 3;
      positions.array[j3] += velocities.array[j3];
      positions.array[j3 + 1] += velocities.array[j3 + 1];
      positions.array[j3 + 2] += velocities.array[j3 + 2];
    }
    
    positions.needsUpdate = true;
    
    // Lebensdauer reduzieren
    smoke.userData.life -= smoke.userData.decay;
    material.opacity = smoke.userData.life * 0.7; // Maximal 0.7 Opacity
    
    // Toten Rauch entfernen
    if (smoke.userData.life <= 0) {
      explosionScene.remove(smoke);
      smokeClouds.splice(i, 1);
    }
  }
  
  // Szene rendern
  explosionRenderer.render(explosionScene, explosionCamera);
  
  // Animation fortsetzen wenn Partikel vorhanden
  if (explosionParticles.length > 0 || smokeClouds.length > 0) {
    animationId = requestAnimationFrame(animateExplosions);
  } else {
    animationId = null;
  }
}

function explodeAllContainers() {
  console.log('💥🚀 EXPLODING ALL CONTAINERS! 🚀💥');
  
  // Three.js System initialisieren falls noch nicht geschehen
  if (!explosionScene) {
    initExplosionSystem();
  }
  
  // Alle Container finden (außer Mixer)
  const containers = document.querySelectorAll('.player-deck, .breadcrumb-bar, .crossfader-container, .volume-meter, .mic-controls, .queue-container, .content-section, .music-library');
  
  containers.forEach((container, index) => {
    // Container verstecken mit zeitversetzter Explosion
    setTimeout(() => {
      // Explosion erstellen
      createExplosion(container);
      
      // Container ausblenden
      (container as HTMLElement).style.transition = 'opacity 0.1s ease';
      (container as HTMLElement).style.opacity = '0';
      
      // Nach kurzer Verzögerung Rauchwolke erstellen
      setTimeout(() => {
        createSmokeCloud(container);
      }, 200);
      
    }, index * 100); // Gestaffelte Explosionen
  });
  
  // Animation starten
  if (!animationId) {
    animateExplosions();
  }
  
  // Nach 5 Sekunden Container wieder einblenden
  setTimeout(() => {
    fadeInContainers();
  }, 5000);
}

function fadeInContainers() {
  console.log('✨ Fading containers back in...');
  
  const containers = document.querySelectorAll('.player-deck, .breadcrumb-bar, .crossfader-container, .volume-meter, .mic-controls, .queue-container, .content-section, .music-library');
  
  containers.forEach((container, index) => {
    setTimeout(() => {
      (container as HTMLElement).style.transition = 'opacity 1s ease';
      (container as HTMLElement).style.opacity = '1';
    }, index * 100); // Gestaffelte Wiedereinblendung
  });
  
  // Explosions-System nach weiteren 2 Sekunden aufräumen
  setTimeout(cleanupExplosionSystem, 2000);
}

function cleanupExplosionSystem() {
  console.log('🧹 Cleaning up explosion system...');
  
  // Animation stoppen
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  
  // Arrays leeren
  explosionParticles.length = 0;
  smokeClouds.length = 0;
  
  // Canvas entfernen
  const canvas = document.getElementById('explosion-canvas');
  if (canvas) {
    canvas.remove();
  }
  
  // Three.js Objekte aufräumen
  if (explosionRenderer) {
    explosionRenderer.dispose();
    explosionRenderer = null;
  }
  
  explosionScene = null;
  explosionCamera = null;
  
  console.log('✅ Explosion system cleaned up');
}

// Stop Live Streaming (only after successful disconnect countdown)
function stopLiveStreaming() {
  const timestamp = Date.now();
  console.log(`⏹️ [${timestamp}] stopLiveStreaming() CALLED - WHO CALLED ME?`);
  console.trace(`📍 [${timestamp}] STACK TRACE for stopLiveStreaming()`);
  
  const streamLiveButton = document.getElementById('stream-live-status') as HTMLButtonElement;
  const streamUsernameDisplay = document.getElementById('stream-username-display') as HTMLSpanElement;
  if (!streamLiveButton) {
    console.error(`❌ [${timestamp}] stopLiveStreaming() - button not found`);
    return;
  }
  
  console.log(`⏹️ [${timestamp}] STOPPING LIVE STREAMING UI EFFECTS...`);
  
  // 🔌 WICHTIG: AzuraCast-Verbindung trennen!
  console.log(`🔌 [${timestamp}] Disconnecting from AzuraCast...`);
  if (azuraCastWebcaster) {
    try {
      azuraCastWebcaster.disconnect();
      console.log(`✅ [${timestamp}] AzuraCast webcaster disconnected successfully`);
    } catch (error) {
      console.error(`❌ [${timestamp}] Error disconnecting AzuraCast:`, error);
    }
    azuraCastWebcaster = null;
  } else {
    console.warn(`⚠️ [${timestamp}] No AzuraCast webcaster to disconnect`);
  }
  
  isLiveStreaming = false;
  isStreaming = false; // Auch den allgemeinen Streaming-Status zurücksetzen
  streamLiveButton.classList.remove('live', 'connecting');
  streamLiveButton.textContent = 'STREAM';
  
  // Reset button state to station selection after disconnect
  currentButtonState = StreamButtonState.SELECT_STATION;
  currentStationId = null;  
  currentStationShortcode = null;
  currentServerUrl = null;
  
  // Hide reset button since no station is selected
  const resetButton = document.getElementById('stream-reset-button') as HTMLButtonElement;
  if (resetButton) {
    resetButton.style.display = 'none';
  }
  
  // Update button appearance using the proper update function
  const updateStreamButton = (window as any).__updateStreamButton;
  if (typeof updateStreamButton === 'function') {
    console.log('🔄 Calling global updateStreamButton to reset UI');
    updateStreamButton();
  } else {
    // Fallback: manual button update
    console.log('🔄 Using fallback UI update');
    streamLiveButton.classList.remove('occupied', 'connected');
    streamLiveButton.classList.add('disconnected');
    if (streamUsernameDisplay) {
      streamUsernameDisplay.textContent = 'Select Station';
    }
  }  // 🛑 SOFORTIGE EFFEKT-BEREINIGUNG!
  clearAllDisconnectEffects();
  
  console.log('⏹️ LIVE STREAMING UI EFFECTS STOPPED - ALL EFFECTS CLEANED UP!');
  console.log('🔄 Button state reset to SELECT_STATION');
}

// Show warning message for short clicks
function showWarningMessage(message: string) {
  const overlay = document.getElementById('disconnect-timer-overlay');
  const warningMessage = document.getElementById('timer-warning-message');
  const timerDisplay = document.getElementById('digital-timer-display');
  
  if (!overlay || !warningMessage || !timerDisplay) return;
  
  // Reset any previous animations
  overlay.classList.remove('crt-poweroff', 'crt-poweroff-warning');
  
  // Hide timer display, show only warning
  timerDisplay.style.display = 'none';
  warningMessage.innerHTML = message;
  warningMessage.style.display = 'block';
  
  overlay.classList.add('active');
  
  // Hide warning after 4 seconds with CRT power-off effect
  setTimeout(() => {
    overlay.classList.add('crt-poweroff-warning');
    
    // Actually hide after animation completes
    setTimeout(() => {
      overlay.classList.remove('active', 'crt-poweroff-warning');
      timerDisplay.style.display = 'block';
      warningMessage.style.display = 'block';
    }, 400); // Match new faster animation duration
  }, 4000);
}

// Start disconnect countdown
function startDisconnectCountdown() {
  const timestamp = Date.now();
  console.log(`⏰ [${timestamp}] startDisconnectCountdown() CALLED - isDisconnecting: ${isDisconnecting}`);
  
  if (isDisconnecting) {
    console.log(`⚠️ [${timestamp}] Already disconnecting - ignoring startDisconnectCountdown()`);
    return;
  }
  
  const overlay = document.getElementById('disconnect-timer-overlay');
  const timerDisplay = document.getElementById('digital-timer-display');
  
  if (!overlay || !timerDisplay) {
    console.error(`❌ [${timestamp}] Missing overlay or timer display elements`);
    return;
  }
  
  // WICHTIG: Erst alles vorbereiten, dann Timer starten!
  console.log(`🔥 [${timestamp}] Starting disconnect countdown`);
  isDisconnecting = true;
  overlay.classList.add('active');
  
  // Warten bis Overlay definitiv sichtbar ist, dann Timer starten
  requestAnimationFrame(() => {
    // Jetzt erst den Timer starten wenn alles bereit ist
    disconnectStartTime = Date.now();
    
    // Start countdown animation
    disconnectTimer = setInterval(() => {
      const elapsed = Date.now() - disconnectStartTime;
      const remaining = Math.max(0, DISCONNECT_DURATION - elapsed);
      const seconds = remaining / 1000;
      
      // Update timer display with 5 decimal places
      timerDisplay.textContent = `disconnecting in: ${seconds.toFixed(5)}`;
      
      // Apply progressive effects based on remaining time
      applyProgressiveTimerEffects(overlay, seconds);
      
      if (remaining <= 0) {
        // Countdown complete - SOFORT alle Effekte stoppen!
        clearInterval(disconnectTimer!);
        disconnectTimer = null;
        isDisconnecting = false;
        
        // 🛑 SOFORT alle globalen Effekte entfernen BEVOR irgendwas anderes passiert!
        clearAllDisconnectEffects();
        
        // 💥 CONTAINER EXPLOSION FINALE! 💥
        explodeAllContainers();
        
        // Start CRT power-off animation
        overlay.classList.add('crt-poweroff');
        
        // Remove all timer effects
        overlay.classList.remove('timer-shake-1', 'timer-shake-2', 'timer-shake-3', 'timer-shake-4', 'timer-shake-extreme');
        
        // Actually disconnect and hide after animation completes
        setTimeout(() => {
          overlay.classList.remove('active', 'crt-poweroff');
          overlay.className = 'disconnect-timer-overlay';
          
          // Actually disconnect
          stopLiveStreaming();
        }, 300); // Match new faster animation duration
      }
    }, 10); // Update every 10ms for smooth countdown
  }); // Close requestAnimationFrame
}

// Stop disconnect countdown
function stopDisconnectCountdown() {
  const timestamp = Date.now();
  console.log(`🛑 [${timestamp}] stopDisconnectCountdown() CALLED - isDisconnecting: ${isDisconnecting}, has timer: ${!!disconnectTimer}`);
  
  if (disconnectTimer) {
    console.log(`⏰ [${timestamp}] Clearing disconnect timer`);
    clearInterval(disconnectTimer);
    disconnectTimer = null;
  }
  
  console.log(`🔄 [${timestamp}] Setting isDisconnecting = false`);
  isDisconnecting = false;
  
  const overlay = document.getElementById('disconnect-timer-overlay');
  if (overlay) {
    console.log(`🎭 [${timestamp}] Hiding disconnect overlay`);
    overlay.classList.remove('active');
    // Remove all timer effects
    overlay.className = 'disconnect-timer-overlay';
  }
  
  // 🛑 SOFORTIGE EFFEKT-BEREINIGUNG!
  clearAllDisconnectEffects();
  
  // 🧹 Explosions-System aufräumen falls aktiv
  if (explosionScene || explosionRenderer) {
    cleanupExplosionSystem();
  }
  
  console.log('🛑 All global disconnect effects STOPPED!');
}

// Apply progressive timer effects based on remaining time
function applyProgressiveTimerEffects(overlay: HTMLElement, seconds: number) {
  const timerDisplay = document.getElementById('digital-timer-display');
  if (!timerDisplay) return;
  
  // Remove all previous effect classes first
      overlay.classList.remove('timer-shake-1', 'timer-shake-2', 'timer-shake-3', 'timer-shake-4');
      timerDisplay.classList.remove('timer-color-urgent', 'timer-color-critical');  // IMMER alle globalen Effekte von allen Elementen entfernen
  document.querySelectorAll('*').forEach(el => {
    el.classList.remove('global-flicker-weak', 'global-flicker-medium', 'global-flicker-extreme', 
                        'global-shake-weak', 'global-shake-medium', 'global-shake-crazy', 
                        'global-disco-flash', 'mixer-crt-flicker', 'mixer-crt-blur', 
                        'mixer-crt-scanlines', 'mixer-crt-static');
  });
  
  if (seconds > 4.0) {
    // 5.0 - 4.0 seconds: Minimal effects
    overlay.classList.add('timer-shake-1');
  } else if (seconds > 3.0) {
    // 4.0 - 3.0 seconds: Light effects + schwache globale Effekte
    overlay.classList.add('timer-shake-2');
    timerDisplay.classList.add('timer-color-urgent');
    
    // SCHWACHE globale Effekte für wichtige UI-Elemente + Music Library
    document.querySelectorAll('.player-deck, .breadcrumb-bar, .crossfader-container, .volume-meter, .music-library').forEach(el => {
      el.classList.add('global-flicker-weak', 'global-shake-weak');
    });
    
    // Spezielle CRT-Effekte für Mixer (ohne Bewegung)
    document.querySelectorAll('.mixer-section').forEach(el => {
      el.classList.add('mixer-crt-flicker');
    });
    
  } else if (seconds > 2.0) {
    // 3.0 - 2.0 seconds: Moderate effects + mittlere globale Effekte
    overlay.classList.add('timer-shake-3');
    timerDisplay.classList.add('timer-color-critical');
    
    // MITTLERE globale Effekte für mehr Elemente + Music Library
    document.querySelectorAll('.player-deck, .breadcrumb-bar, .crossfader-container, .volume-meter, .mic-controls, .queue-container, .music-library').forEach(el => {
      el.classList.add('global-flicker-medium', 'global-shake-medium');
    });
    
    // Mittlere CRT-Effekte für Mixer
    document.querySelectorAll('.mixer-section').forEach(el => {
      el.classList.add('mixer-crt-flicker', 'mixer-crt-blur');
    });
    
  } else if (seconds > 1.0) {
    // 2.0 - 1.0 seconds: Heavy effects + starke globale Effekte
    overlay.classList.add('timer-shake-4');
    timerDisplay.classList.add('timer-color-critical');
    
    // STARKE globale Effekte + erste Disco-Blitze + Music Library
    document.querySelectorAll('.player-deck, .breadcrumb-bar, .crossfader-container, .volume-meter, .mic-controls, .queue-container, .content-section, .music-library').forEach(el => {
      el.classList.add('global-flicker-extreme', 'global-shake-crazy');
      if (Math.random() > 0.7) el.classList.add('global-disco-flash');
    });
    
    // Starke CRT-Effekte für Mixer
    document.querySelectorAll('.mixer-section').forEach(el => {
      el.classList.add('mixer-crt-flicker', 'mixer-crt-blur', 'mixer-crt-scanlines');
    });
    
  } else {
    // 1.0 - 0.0 seconds: Finale intensive Effekte (aber kontrolliert)
    overlay.classList.add('timer-shake-4');
    timerDisplay.classList.add('timer-color-critical');
    
    // Intensive Effekte nur für wichtige Bereiche + Music Library
    document.querySelectorAll('.player-deck, .breadcrumb-bar, .crossfader-container, .volume-meter, .mic-controls, .queue-container, .content-section, .music-library').forEach(el => {
      el.classList.add('global-flicker-extreme', 'global-shake-crazy');
      if (Math.random() > 0.5) el.classList.add('global-disco-flash');
    });
    
    // MAXIMALE CRT-Effekte für Mixer (immer noch ohne Bewegung)
    document.querySelectorAll('.mixer-section').forEach(el => {
      el.classList.add('mixer-crt-flicker', 'mixer-crt-blur', 'mixer-crt-scanlines', 'mixer-crt-static');
    });
    
    console.log('🚨 FINAL COUNTDOWN - MAXIMUM INTENSITY! 🚨');
  }
}

// Recent Albums Funktion entfernt - wird nicht mehr ben�tigt

// ======= MEDIA LIBRARY FUNCTIONS =======

// Initialize Media Library with Unified Browser
function initializeMediaLibrary() {
  console.log("🎵 LIBRARY DEBUG: initializeMediaLibrary() called");
  
  // Check if auto-login credentials are available
  const envUrl = import.meta.env.VITE_OPENSUBSONIC_URL;
  const envUsername = import.meta.env.VITE_OPENSUBSONIC_USERNAME;
  const envPassword = import.meta.env.VITE_OPENSUBSONIC_PASSWORD;
  
  console.log("🎵 LIBRARY DEBUG: Environment variables:", {
    envUrl: !!envUrl,
    envUsername: !!envUsername,
    envPassword: !!envPassword,
    actualUrl: envUrl
  });
  
  // Unified Login Configuration
  const useUnifiedLogin = import.meta.env.VITE_USE_UNIFIED_LOGIN === 'true';
  const unifiedUsername = import.meta.env.VITE_UNIFIED_USERNAME;
  const unifiedPassword = import.meta.env.VITE_UNIFIED_PASSWORD;
  
  // Determine final credentials
  const finalUsername = useUnifiedLogin ? unifiedUsername : envUsername;
  const finalPassword = useUnifiedLogin ? unifiedPassword : envPassword;
  
  console.log("🎵 LIBRARY DEBUG: Final credentials:", {
    finalUsername: !!finalUsername,
    finalPassword: !!finalPassword,
    useUnifiedLogin
  });
  
  // If credentials are available, delay showing login hint to allow auto-login to complete
  if (envUrl && finalUsername && finalPassword) {
    console.log("🔄 Auto-login credentials detected, waiting for auto-login...");
    
    // Wait for auto-login with multiple checks
    let checkCount = 0;
    const maxChecks = 10; // Max 5 seconds
    
    const checkAutoLogin = () => {
      checkCount++;
      console.log(`🎵 LIBRARY DEBUG: Auto-login check ${checkCount}/${maxChecks}:`, {
        isOpenSubsonicLoggedIn,
        autoLoginInProgress,
        libraryBrowser: !!libraryBrowser
      });
      
      if (isOpenSubsonicLoggedIn) {
        console.log("🎵 LIBRARY DEBUG: Auto-login successful!");
        // Login successful, library should already be initialized
        return;
      }
      
      if (!autoLoginInProgress && checkCount >= maxChecks) {
        console.log("🎵 LIBRARY DEBUG: Auto-login timeout, showing login hint");
        showLoginHintForLibrary();
        return;
      }
      
      if (autoLoginInProgress || checkCount < maxChecks) {
        // Still in progress or not enough time passed, check again
        setTimeout(checkAutoLogin, 500);
      }
    };
    
    // Start checking after a short delay
    setTimeout(checkAutoLogin, 500);
  } else {
    console.log("🎵 LIBRARY DEBUG: No credentials available, showing login hint immediately");
    // No credentials available, show login hint immediately
    showLoginHintForLibrary();
  }
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
  console.log("🔓 LIBRARY DEBUG: enableLibraryAfterLogin called!");
  console.log("📡 LIBRARY DEBUG: openSubsonicClient available:", !!openSubsonicClient);
  
  const browseContent = document.getElementById('browse-content');
  console.log("📦 LIBRARY DEBUG: browse-content element found:", !!browseContent);
  
  if (!browseContent) {
    console.error("❌ LIBRARY DEBUG: browse-content element not found!");
    return;
  }
  
  // Initialize and show the library browser with content
  // Queue the initialization to run after all classes are defined
  const initLibraryBrowser = () => {
    try {
      console.log("🚀 LIBRARY DEBUG: Creating new LibraryBrowser...");
      console.log("🚀 LIBRARY DEBUG: pendingInitializations queue length:", pendingInitializations.length);
      libraryBrowser = new LibraryBrowser();
      console.log("✅ LIBRARY DEBUG: LibraryBrowser created successfully");
    } catch (error) {
      console.error("❌ LIBRARY DEBUG: Error initializing LibraryBrowser:", error);
      showLoginHintForLibrary();
    }
  };
  
  // Add to pending initializations queue and trigger immediate execution
  console.log("🔄 LIBRARY DEBUG: Adding initLibraryBrowser to pending queue");
  pendingInitializations.push(initLibraryBrowser);
  console.log("🔄 LIBRARY DEBUG: Queue length after adding:", pendingInitializations.length);
  
  // Trigger execution immediately since we know we're logged in
  setTimeout(() => {
    console.log("🚀 LIBRARY DEBUG: Executing pending initializations immediately");
    if (pendingInitializations.length > 0) {
      const initFns = [...pendingInitializations]; // Copy the array
      pendingInitializations = []; // Clear the queue
      initFns.forEach((initFn, index) => {
        try {
          initFn();
          console.log(`✅ Immediate pending initialization ${index + 1} completed`);
        } catch (error) {
          console.error(`❌ Immediate pending initialization ${index + 1} failed:`, error);
        }
      });
    }
  }, 50); // Very short delay to ensure DOM is ready
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

// Global instance - declared above

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

// Global debug function for drag and drop
function debugDragDrop() {
  console.log('🔍 === DRAG & DROP DEBUG ===');
  
  // Check all draggable elements
  const draggableElements = document.querySelectorAll('[draggable="true"]');
  console.log(`🔍 Found ${draggableElements.length} draggable elements`);
  
  draggableElements.forEach((element, index) => {
    console.log(`🔍 Draggable ${index + 1}:`, element);
  });
  
  // Check drop zones
  ['a', 'b', 'c', 'd'].forEach(side => {
    const deck = document.getElementById(`player-${side}`);
    console.log(`🔍 Player ${side} deck:`, deck ? 'EXISTS' : 'MISSING');
    
    if (deck) {
      // Test if drop zone listeners are active
      const rect = deck.getBoundingClientRect();
      console.log(`🔍 Player ${side} position:`, rect);
      console.log(`🔍 Player ${side} pointer-events:`, window.getComputedStyle(deck).pointerEvents);
      console.log(`🔍 Player ${side} z-index:`, window.getComputedStyle(deck).zIndex);
    }
  });
  
  // Check queue drop zone
  const queueList = document.getElementById('queue-list');
  console.log('🔍 Queue drop zone:', queueList ? 'EXISTS' : 'MISSING');
  if (queueList) {
    console.log(`🔍 Queue pointer-events:`, window.getComputedStyle(queueList).pointerEvents);
    console.log(`🔍 Queue z-index:`, window.getComputedStyle(queueList).zIndex);
  }
  
  // Test manual drop zone re-initialization
  console.log('🔍 Re-initializing drop zones...');
  try {
    initializePlayerDropZones();
    setupQueueDropZone();
    console.log('🔍 Drop zones re-initialized successfully');
  } catch (error) {
    console.error('🔍 Error re-initializing drop zones:', error);
  }
}

// Manual test function for drop zones
function testDropZones() {
  console.log('🧪 === TESTING DROP ZONES ===');
  
  // Simulate dragover on each deck
  ['a', 'b', 'c', 'd'].forEach(side => {
    const deck = document.getElementById(`player-${side}`);
    if (deck) {
      console.log(`🧪 Testing player ${side}...`);
      
      // Create synthetic dragover event
      const dragEvent = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer()
      });
      
      deck.dispatchEvent(dragEvent);
    }
  });
}

// Test album cover dragability
function testAlbumCoverDrag() {
  console.log('🧪 === TESTING ALBUM COVER DRAG ===');
  
  ['a', 'b', 'c', 'd'].forEach(side => {
    const albumCover = document.getElementById(`album-cover-${side}`);
    const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
    const sideKey = side as 'a' | 'b' | 'c' | 'd';
    
    console.log(`🧪 Deck ${side}:`, {
      albumCover: albumCover ? 'EXISTS' : 'MISSING',
      draggable: albumCover?.draggable,
      draggableAttr: albumCover?.getAttribute('draggable'),
      audioSrc: audio?.src || 'NO SOURCE',
      deckSong: deckSongs[sideKey] ? `"${deckSongs[sideKey]?.title}"` : 'NO SONG DATA',
      cursor: albumCover?.style.cursor || 'default'
    });
    
    // Try to make it draggable manually
    if (albumCover && audio?.src) {
      albumCover.draggable = true;
      albumCover.setAttribute('draggable', 'true');
      console.log(`🧪 Manually made deck ${side} draggable`);
    }
  });
  
  // Re-check draggable elements
  setTimeout(() => {
    const draggableElements = document.querySelectorAll('[draggable="true"]');
    console.log(`🧪 Total draggable elements now: ${draggableElements.length}`);
    draggableElements.forEach((el, i) => {
      console.log(`🧪 Draggable ${i + 1}:`, el.id, el.className);
    });
  }, 100);
}

// Initialize audio event listeners for all players after DOM is ready
function initializeAllAudioEventListeners() {
  ['a', 'b', 'c', 'd'].forEach(side => {
    const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
    if (audio) {
      console.log(`🎵 Setting up audio event listeners for player ${side.toUpperCase()}`);
      try {
        setupAudioEventListeners(audio, side as 'a' | 'b' | 'c' | 'd');
        console.log(`✅ Audio event listeners setup complete for player ${side.toUpperCase()}`);
      } catch (error) {
        console.error(`❌ Error setting up audio event listeners for player ${side.toUpperCase()}:`, error);
      }
    } else {
      console.error(`❌ Audio element for player ${side.toUpperCase()} not found`);
    }
  });
}

// Make functions globally available
(window as any).debugDragDrop = debugDragDrop;
(window as any).testDropZones = testDropZones;
(window as any).testAlbumCoverDrag = testAlbumCoverDrag;

// Execute all pending initializations - with retry mechanism for race conditions
let initializationAttempts = 0;
const MAX_INIT_ATTEMPTS = 5;

function executePendingInitializations() {
  initializationAttempts++;
  console.log(`🚀 Executing ${pendingInitializations.length} pending initializations (attempt ${initializationAttempts})...`);
  
  if (pendingInitializations.length === 0 && initializationAttempts < MAX_INIT_ATTEMPTS) {
    // No pending initializations yet, might be race condition - try again
    console.log(`⏳ No pending initializations found, retrying in 500ms...`);
    setTimeout(executePendingInitializations, 500);
    return;
  }
  
  pendingInitializations.forEach((initFn, index) => {
    try {
      initFn();
      console.log(`✅ Pending initialization ${index + 1} completed`);
    } catch (error) {
      console.error(`❌ Pending initialization ${index + 1} failed:`, error);
    }
  });
  pendingInitializations = []; // Clear the queue
}

// Start the initialization process
setTimeout(executePendingInitializations, 100);

// =====================================
// SETUP WIZARD INITIALIZATION
// =====================================

// Add keyboard shortcut to show setup (Ctrl+Shift+S) - always available
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'S') {
    e.preventDefault();
    console.log('🔧 Setup Wizard triggered by keyboard shortcut (Ctrl+Shift+S)');
    const setupWizard = new SetupWizard();
    setupWizard.show();
  }
});

console.log('🎧 SubCaster initialized successfully!');
