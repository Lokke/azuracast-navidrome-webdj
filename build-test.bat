@echo off
echo Stopping containers...
docker-compose --env-file .env.docker down

echo Building with proper environment...
docker-compose --env-file .env.docker build --no-cache

echo Starting containers...
docker-compose --env-file .env.docker up -d

echo.
echo WebDJ URL: http://localhost:5173
echo.
echo Checking container status...
docker-compose --env-file .env.docker ps