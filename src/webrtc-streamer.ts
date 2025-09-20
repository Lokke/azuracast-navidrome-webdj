// WebRTC Live Streaming Implementation
// Ersetzt die HTTP-basierte Shoutcast-Lösung mit modernem WebRTC

export interface WebRTCStreamConfig {
  signalingServer: string;
  iceServers: RTCIceServer[];
  audioConstraints: MediaTrackConstraints;
  bitrate: number;
  sampleRate: number;
}

export class WebRTCStreamer {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private signalingSocket: WebSocket | null = null;
  private config: WebRTCStreamConfig;
  private isStreaming: boolean = false;

  constructor(config: WebRTCStreamConfig) {
    this.config = config;
  }

  // WebRTC-Streaming initialisieren
  async initialize(): Promise<boolean> {
    try {
      // RTCPeerConnection erstellen
      this.peerConnection = new RTCPeerConnection({
        iceServers: this.config.iceServers
      });

      // ICE-Events verwalten
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate && this.signalingSocket) {
          this.sendSignalingMessage({
            type: 'ice-candidate',
            candidate: event.candidate
          });
        }
      };

      this.peerConnection.onconnectionstatechange = () => {
        console.log('WebRTC connection state:', this.peerConnection?.connectionState);
      };

      // Signaling Server verbinden
      await this.connectSignalingServer();

      console.log('WebRTC Streamer initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize WebRTC streamer:', error);
      return false;
    }
  }

  // Audio-Stream von Web Audio API hinzufügen
  async addAudioStream(audioContext: AudioContext, sourceNode: AudioNode): Promise<boolean> {
    try {
      // MediaStreamDestination für WebRTC erstellen
      const destination = audioContext.createMediaStreamDestination();
      sourceNode.connect(destination);
      
      this.localStream = destination.stream;

      // Audio-Track zu PeerConnection hinzufügen
      if (this.peerConnection && this.localStream) {
        this.localStream.getTracks().forEach(track => {
          this.peerConnection!.addTrack(track, this.localStream!);
        });

        console.log('Audio stream added to WebRTC peer connection');
        return true;
      }

      return false;
    } catch (error) {
      console.error('Failed to add audio stream:', error);
      return false;
    }
  }

  // Live-Streaming starten
  async startStreaming(): Promise<boolean> {
    try {
      if (!this.peerConnection || !this.localStream) {
        throw new Error('WebRTC not initialized');
      }

      // Offer erstellen
      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false
      });

      await this.peerConnection.setLocalDescription(offer);

      // Offer an Signaling Server senden
      this.sendSignalingMessage({
        type: 'offer',
        offer: offer
      });

      this.isStreaming = true;
      console.log('WebRTC streaming started');
      return true;

    } catch (error) {
      console.error('Failed to start WebRTC streaming:', error);
      return false;
    }
  }

  // Live-Streaming stoppen
  async stopStreaming(): Promise<boolean> {
    try {
      this.isStreaming = false;

      // Signaling-Nachricht senden
      if (this.signalingSocket) {
        this.sendSignalingMessage({ type: 'stop-stream' });
      }

      // PeerConnection schließen
      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }

      // Local Stream stoppen
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => track.stop());
        this.localStream = null;
      }

      console.log('WebRTC streaming stopped');
      return true;

    } catch (error) {
      console.error('Failed to stop WebRTC streaming:', error);
      return false;
    }
  }

  // Signaling Server verbinden
  private async connectSignalingServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.signalingSocket = new WebSocket(this.config.signalingServer);

        this.signalingSocket.onopen = () => {
          console.log('Connected to WebRTC signaling server');
          resolve();
        };

        this.signalingSocket.onmessage = async (event) => {
          try {
            const message = JSON.parse(event.data);
            await this.handleSignalingMessage(message);
          } catch (e) {
            console.error('Failed to parse signaling message:', e);
          }
        };

        this.signalingSocket.onerror = (error) => {
          console.error('Signaling socket error:', error);
          reject(error);
        };

        this.signalingSocket.onclose = () => {
          console.log('Signaling socket closed');
          this.signalingSocket = null;
        };

      } catch (error) {
        reject(error);
      }
    });
  }

  // Signaling-Nachrichten verarbeiten
  private async handleSignalingMessage(message: any): Promise<void> {
    try {
      switch (message.type) {
        case 'answer':
          if (this.peerConnection && message.answer) {
            await this.peerConnection.setRemoteDescription(message.answer);
          }
          break;

        case 'ice-candidate':
          if (this.peerConnection && message.candidate) {
            await this.peerConnection.addIceCandidate(message.candidate);
          }
          break;

        case 'stream-ready':
          console.log('Stream server ready to receive');
          break;

        case 'error':
          console.error('Signaling server error:', message.error);
          break;

        default:
          console.log('Unknown signaling message:', message.type);
      }
    } catch (error) {
      console.error('Failed to handle signaling message:', error);
    }
  }

  // Signaling-Nachricht senden
  private sendSignalingMessage(message: any): void {
    if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
      this.signalingSocket.send(JSON.stringify(message));
    }
  }

  // Stream-Status abrufen
  getStreamingStatus(): boolean {
    return this.isStreaming;
  }

  // Connection-Status abrufen
  getConnectionStatus(): string {
    return this.peerConnection?.connectionState || 'disconnected';
  }
}

// Standard WebRTC-Konfiguration
export const defaultWebRTCConfig: WebRTCStreamConfig = {
  signalingServer: 'wss://localhost:3002', // WebSocket Signaling Server
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ],
  audioConstraints: {
    sampleRate: 48000,
    channelCount: 2,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  },
  bitrate: 320,
  sampleRate: 48000
};