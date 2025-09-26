@echo off
echo 🐳 SubCaster Docker Setup wird gestartet...

REM Prüfen ob .env.docker existiert
if not exist ".env.docker" (
    echo ⚠️  .env.docker nicht gefunden - erstelle aus Template...
    copy env.docker.template .env.docker
    echo ✅ .env.docker erstellt - bitte Werte anpassen und erneut starten
    pause
    exit /b 1
)

REM Alte Container und Images aufräumen
echo 🧹 Cleanup alter Container...
docker-compose down --remove-orphans

REM Neu bauen und starten
echo 🔨 Container wird gebaut und gestartet...
docker-compose up --build -d

REM Status anzeigen
echo 📊 Container Status:
docker-compose ps

echo.
echo 🚀 SubCaster läuft auf http://localhost:3001
echo 📋 Logs anzeigen: docker-compose logs -f
echo 🛑 Stoppen: docker-compose down
pause