/**
 * Browser-based Shoutcast Streaming
 * Pure JavaScript solution - no external dependencies
 * 
 * This approach encodes audio directly in the browser and streams
 * to Shoutcast via a simple proxy server.
 */

class ShoutcastStreamer {
    constructor(options = {}) {
        this.options = {
            sampleRate: 44100,
            bitRate: 128,
            channels: 2,
            proxyUrl: 'http://localhost:3001/stream',
            ...options
        };
        
        this.isStreaming = false;
        this.audioContext = null;
        this.mediaRecorder = null;
        this.socket = null;
    }

    /**
     * Initialize audio context and start streaming
     */
    async startStreaming(audioSource) {
        try {
            console.log('🎵 Starting Shoutcast stream...');
            
            // Create audio context if needed
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            // Connect to streaming proxy
            this.socket = new WebSocket(this.options.proxyUrl.replace('http', 'ws'));
            
            this.socket.onopen = () => {
                console.log('✅ Connected to streaming proxy');
                this.isStreaming = true;
            };

            this.socket.onerror = (error) => {
                console.error('❌ Streaming proxy error:', error);
                this.isStreaming = false;
            };

            this.socket.onclose = () => {
                console.log('🔌 Streaming proxy disconnected');
                this.isStreaming = false;
            };

            // Set up audio processing
            await this.setupAudioProcessing(audioSource);
            
        } catch (error) {
            console.error('❌ Failed to start streaming:', error);
            throw error;
        }
    }

    /**
     * Set up audio processing and encoding
     */
    async setupAudioProcessing(audioSource) {
        // Create destination node for capturing mixed audio
        const destination = this.audioContext.createMediaStreamDestination();
        
        // Connect audio source to destination
        audioSource.connect(destination);
        
        // Create MediaRecorder with MP3 encoding (if supported)
        const mimeType = this.getSupportedMimeType();
        console.log(`🎧 Using audio format: ${mimeType}`);
        
        this.mediaRecorder = new MediaRecorder(destination.stream, {
            mimeType: mimeType,
            audioBitsPerSecond: this.options.bitRate * 1000
        });

        // Handle encoded audio data
        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0 && this.socket && this.socket.readyState === WebSocket.OPEN) {
                // Send encoded audio chunk to proxy
                this.socket.send(event.data);
            }
        };

        // Start recording with small time slices for low latency
        this.mediaRecorder.start(100); // 100ms chunks
    }

    /**
     * Get best supported audio mime type
     */
    getSupportedMimeType() {
        const types = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/mp4',
            'audio/wav'
        ];

        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) {
                return type;
            }
        }
        
        return 'audio/webm'; // fallback
    }

    /**
     * Stop streaming
     */
    stopStreaming() {
        console.log('🛑 Stopping Shoutcast stream...');
        
        this.isStreaming = false;
        
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.close();
        }
        
        console.log('✅ Streaming stopped');
    }

    /**
     * Get streaming status
     */
    getStatus() {
        return {
            isStreaming: this.isStreaming,
            socketState: this.socket ? this.socket.readyState : null,
            recorderState: this.mediaRecorder ? this.mediaRecorder.state : null,
            options: this.options
        };
    }
}

// Export for use in React app
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ShoutcastStreamer;
} else {
    window.ShoutcastStreamer = ShoutcastStreamer;
}