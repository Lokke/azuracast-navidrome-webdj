#!/bin/bash

# Build and run WebDJ Docker container

echo "Building WebDJ Docker image..."
docker build -t webdj:latest .

if [ $? -eq 0 ]; then
    echo "Build successful!"
    echo ""
    echo "To run the container:"
    echo "docker run -d --name webdj -p 5173:5173 -p 8082:8082 webdj:latest"
    echo ""
    echo "Or use Docker Compose:"
    echo "docker-compose up -d"
    echo ""
    echo "Access the WebDJ interface at: http://localhost:5173"
else
    echo "Build failed!"
    exit 1
fi