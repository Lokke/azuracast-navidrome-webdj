/**
 * AzuraCast WebDJ Integration
 * Based on AzuraCast's WebDJ system for streaming master audio
 */

export interface AzuraCastMetadata {
  title: string;
  artist: string;
}

export interface AzuraCastConfig {
  servers: string[]; // Multiple server URLs
  stationId: string;
  stationShortcode?: string; // Add shortcode for proper WebDJ URL
  serverUrl?: string; // Selected server URL for current station
  username: string;
  password: string;
  bitrate: number;
  sampleRate: number;
}

export interface AzuraCastStation {
  id: number;
  name: string;
  shortcode: string;
  description: string;
  is_public: boolean;
  is_online: boolean;
  listen_url: string;
}

export interface AzuraCastNowPlayingResponse {
  station: AzuraCastStation & {
    frontend: string;
    backend: string;
    timezone: string;
    url: string;
    public_player_url: string;
    playlist_pls_url: string;
    playlist_m3u_url: string;
    mounts: Array<{
      id: number;
      name: string;
      url: string;
      bitrate: number;
      format: string;
      path: string;
      is_default: boolean;
    }>;
  };
  listeners: {
    total: number;
    unique: number;
    current: number;
  };
  live: {
    is_live: boolean;
    streamer_name: string;
    broadcast_start: string | null;
    art: string | null;
  };
  now_playing: {
    song: {
      id: string;
      art: string;
      text: string;
      artist: string;
      title: string;
      album: string;
      genre: string;
    };
    elapsed: number;
    remaining: number;
  };
  is_online: boolean;
}

export class AzuraCastWebcaster {
  private socket: WebSocket | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private isConnected = false;
  private config: AzuraCastConfig;
  private metadata: AzuraCastMetadata | null = null;

  constructor(config: AzuraCastConfig) {
    this.config = config;
  }

  /**
   * Connect to AzuraCast WebDJ endpoint
   */
  async connect(audioStream: MediaStream): Promise<boolean> {
    try {
      // Build WebSocket URL using AzuraCast's actual format: /webdj/{shortcode}/
      const stationIdentifier = this.config.stationShortcode || this.config.stationId;
      const serverUrl = this.config.serverUrl || this.config.servers[0];
      const wsUrl = `${serverUrl.replace('https://', 'wss://').replace('http://', 'ws://')}/webdj/${stationIdentifier}/`;
      
      const timestamp = Date.now();
      console.log(`🔗 [${timestamp}] Connecting to AzuraCast WebDJ: ${wsUrl}`);
      console.log(`🔐 [${timestamp}] Using credentials - User: ${this.config.username}, Password: ${this.config.password ? '[SET]' : '[NOT SET]'}`);
      
      this.socket = new WebSocket(wsUrl, "webcast");
      console.log(`📡 [${timestamp}] WebSocket created with protocol: webcast`);

      // Setup MediaRecorder for audio streaming
      this.mediaRecorder = new MediaRecorder(audioStream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: this.config.bitrate * 1000
      });

      return new Promise((resolve, reject) => {
        if (!this.socket) {
          reject(new Error('WebSocket not initialized'));
          return;
        }

        this.socket.onopen = () => {
          const timestamp = Date.now();
          console.log(`🎯 [${timestamp}] AzuraCast WebSocket connected`);
          
          // Send hello message (AzuraCast protocol)
          const hello = {
            mime: this.mediaRecorder?.mimeType || 'audio/webm;codecs=opus',
            user: this.config.username,
            password: this.config.password
          };

          console.log(`📤 [${timestamp}] Sending hello message:`, hello);
          this.socket?.send(JSON.stringify({
            type: "hello",
            data: hello
          }));

          this.isConnected = true;

          // Start recording and streaming
          this.startRecording();

          // Success notification after 1 second (like AzuraCast)
          setTimeout(() => {
            if (this.isConnected) {
              console.log('✅ AzuraCast WebDJ connected successfully!');
              
              // Send initial metadata if available
              if (this.metadata) {
                this.sendMetadata(this.metadata);
              }
              
              resolve(true);
            }
          }, 1000);
        };

        this.socket.onerror = (error) => {
          console.error('❌ AzuraCast WebSocket error:', error);
          console.error('💡 Check if AzuraCast WebDJ is enabled and running on the server');
          console.error(`💡 Tried to connect to: ${wsUrl}`);
          this.isConnected = false;
          reject(error);
        };

        this.socket.onmessage = (event) => {
          const timestamp = Date.now();
          console.log(`📨 [${timestamp}] WebSocket message received:`, event.data);
          try {
            const data = JSON.parse(event.data);
            console.log(`📊 [${timestamp}] Parsed message:`, data);
          } catch (e) {
            console.log(`📄 [${timestamp}] Raw text message:`, event.data);
          }
        };

        this.socket.onclose = (event) => {
          const timestamp = Date.now();
          console.log(`🔌 [${timestamp}] AzuraCast WebSocket disconnected - WHO TRIGGERED THIS?`);
          console.log(`🔍 [${timestamp}] Close event details:`, {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean
          });
          console.trace(`📍 [${timestamp}] STACK TRACE for WebSocket onclose`);
          this.isConnected = false;
          this.stopRecording();
        };
      });

    } catch (error) {
      console.error('❌ Failed to connect to AzuraCast:', error);
      return false;
    }
  }

  /**
   * Start recording and streaming audio
   */
  private startRecording(): void {
    if (!this.mediaRecorder) return;

    this.mediaRecorder.ondataavailable = async (event: BlobEvent) => {
      if (this.isConnected && this.socket && event.data.size > 0) {
        const audioData = await event.data.arrayBuffer();
        this.socket.send(audioData);
      }
    };

    this.mediaRecorder.onstop = () => {
      if (this.isConnected && this.socket) {
        this.socket.close();
      }
    };

    // Start recording with 100ms intervals (like AzuraCast)
    this.mediaRecorder.start(100);
    console.log('🎤 Started recording master audio for AzuraCast streaming');
  }

  /**
   * Stop recording and streaming
   */
  private stopRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      console.log('⏹️ Stopped recording master audio');
    }
  }

  /**
   * Send metadata to AzuraCast (like track info)
   */
  sendMetadata(metadata: AzuraCastMetadata): void {
    this.metadata = metadata;

    if (this.isConnected && this.socket) {
      this.socket.send(JSON.stringify({
        type: "metadata",
        data: metadata
      }));
      
      console.log(`📊 Sent metadata to AzuraCast: ${metadata.artist} - ${metadata.title}`);
    }
  }

  /**
   * Disconnect from AzuraCast
   */
  disconnect(): void {
    this.isConnected = false;
    
    if (this.mediaRecorder) {
      this.stopRecording();
    }
    
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    
    console.log('🔌 Disconnected from AzuraCast WebDJ');
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Update streaming configuration
   */
  updateConfig(newConfig: Partial<AzuraCastConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('⚙️ Updated AzuraCast configuration:', newConfig);
  }
}

/**
 * Create AzuraCast configuration from environment variables
 * @param overrideStationId - Optional station ID to override the environment variable
 * @param overrideStationShortcode - Optional station shortcode for WebDJ URL
 * @param selectedServerUrl - Optional server URL for selected station
 */
export function createAzuraCastConfig(overrideStationId?: string, overrideStationShortcode?: string, selectedServerUrl?: string, dynamicUsername?: string, dynamicPassword?: string): AzuraCastConfig {
  const timestamp = Date.now();
  
  // Use runtime config if available, fallback to import.meta.env
  const getConfigValue = (window as any).getConfigValue || ((key: string) => import.meta.env[key]);
  
  const serversEnv = getConfigValue('VITE_AZURACAST_SERVERS') || 'https://localhost';
  const servers = serversEnv.split(',').map((url: string) => url.trim());
  
  // Check for unified login
  const useUnifiedLogin = getConfigValue('VITE_USE_UNIFIED_LOGIN') === 'true';
  const unifiedUsername = getConfigValue('VITE_UNIFIED_USERNAME');
  const unifiedPassword = getConfigValue('VITE_UNIFIED_PASSWORD');
  
  // Determine credentials
  const finalUsername = dynamicUsername || (useUnifiedLogin ? unifiedUsername : getConfigValue('VITE_AZURACAST_DJ_USERNAME')) || 'webdj';
  const finalPassword = dynamicPassword || (useUnifiedLogin ? unifiedPassword : getConfigValue('VITE_AZURACAST_DJ_PASSWORD')) || 'webdj123';
  
  const config = {
    servers,
    serverUrl: selectedServerUrl || servers[0], // Default to first server
    stationId: overrideStationId || getConfigValue('VITE_AZURACAST_STATION_ID') || '1',
    stationShortcode: overrideStationShortcode,
    username: finalUsername,
    password: finalPassword,
    bitrate: parseInt(getConfigValue('VITE_STREAM_BITRATE') || '128'),
    sampleRate: parseInt(getConfigValue('VITE_STREAM_SAMPLE_RATE') || '44100')
  };
  
  console.log(`🔧 [${timestamp}] AzuraCast Config created:`);
  console.log(`   - Server: ${config.serverUrl}`);
  console.log(`   - Station ID: ${config.stationId}`);
  console.log(`   - Station Shortcode: ${config.stationShortcode}`);
  console.log(`   - Username: ${config.username}`);
  console.log(`   - Password: ${config.password ? '[SET - ' + config.password.length + ' chars]' : '[NOT SET]'}`);
  console.log(`   - Bitrate: ${config.bitrate}`);
  
  return config;
}

/**
 * Fetch available AzuraCast stations from nowplaying API
 */
/**
 * Fetch available AzuraCast stations from nowplaying API
 */
export async function fetchAzuraCastStations(apiUrl: string): Promise<AzuraCastStation[]> {
  try {
    const response = await fetch(`${apiUrl}/nowplaying`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: AzuraCastNowPlayingResponse[] = await response.json();
    
    return data.map((item) => ({
      id: item.station.id,
      name: item.station.name,
      shortcode: item.station.shortcode,
      description: item.station.description,
      is_public: item.station.is_public,
      is_online: item.station.is_online,
      listen_url: item.station.listen_url
    }));
  } catch (error) {
    console.error(`Failed to fetch stations from ${apiUrl}:`, error);
    throw error;
  }
}

/**
 * Fetch stations from all configured AzuraCast servers
 */
export async function fetchAllAzuraCastStations(servers: string[]): Promise<Array<{serverUrl: string, stations: any[]}>> {
  const results = [];
  
  for (const serverUrl of servers) {
    try {
      console.log(`🔍 Loading stations from ${serverUrl}...`);
      const apiUrl = `${serverUrl}/api`;
      const response = await fetch(`${apiUrl}/nowplaying`);
      
      if (response.ok) {
        const stationsData = await response.json();
        results.push({
          serverUrl,
          stations: stationsData
        });
        console.log(`✅ Loaded ${stationsData.length} stations from ${serverUrl}`);
      } else {
        console.warn(`⚠️ Failed to load stations from ${serverUrl}: ${response.status}`);
      }
    } catch (error) {
      console.error(`❌ Error loading stations from ${serverUrl}:`, error);
    }
  }
  
  return results;
}