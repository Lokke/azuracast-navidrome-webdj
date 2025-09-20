import React, { useState, useEffect, useRef } from 'react';

/**
 * Streaming Control Component
 * 
 * Integrates browser-based Shoutcast streaming into the DJ app
 * No external dependencies required!
 */

const StreamingControl = ({ audioContext, masterGainNode }) => {
    const [isStreaming, setIsStreaming] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [streamStatus, setStreamStatus] = useState('disconnected');
    const [bytesStreamed, setBytesStreamed] = useState(0);
    const [error, setError] = useState(null);
    
    const streamerRef = useRef(null);
    const wsRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const destinationRef = useRef(null);

    const PROXY_URL = 'ws://localhost:3001/stream';
    
    useEffect(() => {
        return () => {
            // Cleanup on unmount
            stopStreaming();
        };
    }, []);

    /**
     * Start streaming to Shoutcast
     */
    const startStreaming = async () => {
        try {
            console.log('🎵 Starting Shoutcast stream...');
            setError(null);
            
            if (!audioContext || !masterGainNode) {
                throw new Error('Audio context or master gain node not available');
            }

            // Create destination for capturing mixed audio
            destinationRef.current = audioContext.createMediaStreamDestination();
            
            // Connect master output to destination
            masterGainNode.connect(destinationRef.current);
            
            // Connect to proxy server
            wsRef.current = new WebSocket(PROXY_URL);
            
            wsRef.current.onopen = () => {
                console.log('✅ Connected to streaming proxy');
                setIsConnected(true);
                setStreamStatus('connected');
                setupMediaRecorder();
            };

            wsRef.current.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
                setError('Failed to connect to streaming server');
                setStreamStatus('error');
                setIsConnected(false);
            };

            wsRef.current.onclose = () => {
                console.log('🔌 Disconnected from streaming proxy');
                setIsConnected(false);
                setIsStreaming(false);
                setStreamStatus('disconnected');
            };

        } catch (err) {
            console.error('❌ Failed to start streaming:', err);
            setError(err.message);
            setStreamStatus('error');
        }
    };

    /**
     * Setup MediaRecorder for audio encoding
     */
    const setupMediaRecorder = () => {
        try {
            // Get best supported format
            const mimeType = getSupportedMimeType();
            console.log(`🎧 Using audio format: ${mimeType}`);
            
            mediaRecorderRef.current = new MediaRecorder(destinationRef.current.stream, {
                mimeType: mimeType,
                audioBitsPerSecond: 128000 // 128 kbps
            });

            mediaRecorderRef.current.ondataavailable = (event) => {
                if (event.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(event.data);
                    setBytesStreamed(prev => prev + event.data.size);
                }
            };

            mediaRecorderRef.current.onstart = () => {
                console.log('🎤 Audio recording started');
                setIsStreaming(true);
                setStreamStatus('streaming');
            };

            mediaRecorderRef.current.onstop = () => {
                console.log('🛑 Audio recording stopped');
                setIsStreaming(false);
                setStreamStatus('connected');
            };

            // Start recording with 100ms chunks for low latency
            mediaRecorderRef.current.start(100);

        } catch (err) {
            console.error('❌ Failed to setup MediaRecorder:', err);
            setError('Failed to setup audio recording');
        }
    };

    /**
     * Stop streaming
     */
    const stopStreaming = () => {
        console.log('🛑 Stopping stream...');
        
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.close();
        }
        
        if (destinationRef.current && masterGainNode) {
            masterGainNode.disconnect(destinationRef.current);
        }
        
        setIsStreaming(false);
        setIsConnected(false);
        setStreamStatus('disconnected');
        setBytesStreamed(0);
        setError(null);
    };

    /**
     * Get best supported audio mime type
     */
    const getSupportedMimeType = () => {
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
    };

    /**
     * Format bytes for display
     */
    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    /**
     * Get status color based on streaming state
     */
    const getStatusColor = () => {
        switch (streamStatus) {
            case 'streaming': return '#22c55e'; // green
            case 'connected': return '#f59e0b'; // yellow
            case 'error': return '#ef4444'; // red
            default: return '#6b7280'; // gray
        }
    };

    return (
        <div className="streaming-control">
            <div className="streaming-header">
                <h3>📡 Live Streaming</h3>
                <div 
                    className="status-indicator"
                    style={{ 
                        backgroundColor: getStatusColor(),
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        display: 'inline-block',
                        marginLeft: '8px'
                    }}
                />
            </div>

            <div className="streaming-info">
                <div className="status-text">
                    Status: <strong>{streamStatus}</strong>
                </div>
                
                {bytesStreamed > 0 && (
                    <div className="data-counter">
                        Streamed: <strong>{formatBytes(bytesStreamed)}</strong>
                    </div>
                )}
                
                {error && (
                    <div className="error-message" style={{ color: '#ef4444' }}>
                        Error: {error}
                    </div>
                )}
            </div>

            <div className="streaming-controls">
                {!isStreaming ? (
                    <button 
                        onClick={startStreaming}
                        disabled={!audioContext || !masterGainNode}
                        className="stream-button start"
                        style={{
                            backgroundColor: '#22c55e',
                            color: 'white',
                            border: 'none',
                            padding: '12px 24px',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '16px',
                            fontWeight: 'bold'
                        }}
                    >
                        🔴 Start Streaming
                    </button>
                ) : (
                    <button 
                        onClick={stopStreaming}
                        className="stream-button stop"
                        style={{
                            backgroundColor: '#ef4444',
                            color: 'white',
                            border: 'none',
                            padding: '12px 24px',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '16px',
                            fontWeight: 'bold'
                        }}
                    >
                        ⏹️ Stop Streaming
                    </button>
                )}
            </div>

            <div className="streaming-help">
                <small style={{ color: '#6b7280' }}>
                    💡 Make sure the proxy server is running: <code>node simple-shoutcast-proxy.js</code>
                </small>
            </div>

            <style jsx>{`
                .streaming-control {
                    background: #1f2937;
                    padding: 20px;
                    border-radius: 12px;
                    margin: 16px 0;
                    color: white;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }
                
                .streaming-header {
                    display: flex;
                    align-items: center;
                    margin-bottom: 16px;
                }
                
                .streaming-header h3 {
                    margin: 0;
                    font-size: 18px;
                }
                
                .streaming-info {
                    margin-bottom: 16px;
                    font-size: 14px;
                }
                
                .streaming-info > div {
                    margin-bottom: 4px;
                }
                
                .streaming-controls {
                    margin-bottom: 12px;
                }
                
                .stream-button:hover {
                    opacity: 0.9;
                    transform: translateY(-1px);
                }
                
                .stream-button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                
                code {
                    background: #374151;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-family: 'Courier New', monospace;
                }
            `}</style>
        </div>
    );
};

export default StreamingControl;