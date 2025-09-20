#!/bin/sh

# Start services script for Docker container

echo "Starting WebDJ services..."

# Create .env file from environment variables if it doesn't exist
if [ ! -f .env ]; then
    echo "Creating .env file from environment variables..."
    {
        echo "VITE_STREAM_USERNAME=${STREAM_USERNAME:-test}"
        echo "VITE_STREAM_PASSWORD=${STREAM_PASSWORD:-test}"
        echo "VITE_STREAM_SERVER=${STREAM_SERVER:-funkturm.radio-endstation.de}"
        echo "VITE_STREAM_PORT=${STREAM_PORT:-8015}"
        echo "VITE_STREAM_MOUNT=${STREAM_MOUNT:-/}"
    } > .env 2>/dev/null || echo "Warning: Could not create .env file, using environment variables directly"
fi

# Start CORS proxy in background
echo "Starting CORS proxy on port 8082..."
node cors-proxy-fixed.js &
PROXY_PID=$!

# Wait a moment for proxy to start
sleep 2

# Start the web server using Node.js http-server (more reliable than Python)
echo "Starting web server on port 5173..."
npx http-server dist -p 5173 -c-1 --cors &
WEB_PID=$!

# Function to handle shutdown
shutdown() {
    echo "Shutting down services..."
    kill $PROXY_PID 2>/dev/null
    kill $WEB_PID 2>/dev/null
    exit 0
}

# Trap signals
trap shutdown SIGTERM SIGINT

# Wait for processes
wait $PROXY_PID
wait $WEB_PID