#!/bin/bash

echo "🐳 SubCaster Docker Setup wird gestartet..."

# Prüfen ob .env.docker existiert
if [ ! -f ".env.docker" ]; then
    echo "⚠️  .env.docker nicht gefunden - erstelle aus Template..."
    cp env.docker.template .env.docker
    echo "✅ .env.docker erstellt - bitte Werte anpassen und erneut starten"
    exit 1
fi

# Alte Container und Images aufräumen (optional)
echo "🧹 Cleanup alter Container..."
docker-compose down --remove-orphans

# Neu bauen und starten
echo "🔨 Container wird gebaut und gestartet..."
docker-compose up --build -d

# Status anzeigen
echo "📊 Container Status:"
docker-compose ps

echo "🚀 SubCaster läuft auf http://localhost:3001"
echo "📋 Logs anzeigen: docker-compose logs -f"
echo "🛑 Stoppen: docker-compose down"