# AzuraCast Metadaten-Integration

## Übersicht

Das SubCaster-System wurde erweitert um eine kontinuierliche Metadaten-Übertragung an AzuraCast-Server. Diese Implementierung stellt sicher, dass immer aktuelle Track-Informationen gesendet werden, auch wenn gerade keine Musik spielt.

## Funktionsweise

### 1. WebSocket-Verbindung
- **Standard AzuraCast**: `wss://server.com/webdj/{station}/`
- **funkturm.radio-endstation.de**: `wss://funkturm.radio-endstation.de/public/{station}/websocket`

### 2. Automatische Metadaten-Updates

#### Kontinuierliche Updates (alle 5 Sekunden)
```typescript
// Automatischer Check alle 5 Sekunden
setInterval(() => {
  if (aktueller_track_vorhanden) {
    sendMetadata({ title: "Song", artist: "Artist" });
  } else {
    sendMetadata({ title: "username@SubCaster", artist: "Live Stream" });
  }
}, 5000);
```

#### Sofortige Updates bei Events
- **Play-Event**: Sofortiges Update mit neuen Track-Daten
- **Pause-Event**: Update (falls andere Tracks noch laufen)
- **Ended-Event**: Update (Fallback auf andere Tracks oder username@SubCaster)

### 3. Prioritätssystem

Die Metadaten werden nach folgendem System priorisiert:

1. **Zuletzt gestarteter Track** (höchste Priorität)
2. **Andere spielende Tracks** (nach Startzeit sortiert)
3. **Fallback**: `{username}@SubCaster` + `Live Stream`

```typescript
function getCurrentTrackMetadata() {
  const playingDecks = getAllPlayingDecks()
    .sort((a, b) => b.startTime - a.startTime); // Neueste zuerst
  
  if (playingDecks.length > 0) {
    return { title: track.title, artist: track.artist };
  }
  
  return null; // Führt zu Fallback-Metadaten
}
```

### 4. WebSocket-Protokoll

#### Authentifizierung
```json
{
  "type": "hello",
  "data": {
    "user": "demo",
    "password": "demo", 
    "mime": "audio/webm;codecs=opus"
  }
}
```

#### Metadaten senden
```json
{
  "type": "metadata",
  "data": {
    "title": "Song Title",
    "artist": "Artist Name"
  }
}
```

## Implementierung

### Erweiterte AzuraCastWebcaster-Klasse

```typescript
class AzuraCastWebcaster {
  private metadataUpdateTimer: number | null = null;
  private lastSentMetadata: string | null = null;
  private currentUsername: string = '';
  
  // Kontinuierliche Updates starten
  private startMetadataUpdates() {
    this.metadataUpdateTimer = setInterval(() => {
      const currentTrack = this.getCurrentTrackFromApp();
      if (currentTrack) {
        this.sendMetadata(currentTrack);
      } else {
        this.sendFallbackMetadata(); // username@SubCaster
      }
    }, 5000);
  }
  
  // Fallback-Metadaten
  private sendFallbackMetadata() {
    this.sendMetadata({
      title: `${this.currentUsername}@SubCaster`,
      artist: 'Live Stream'
    });
  }
}
```

### Integration in main.ts

```typescript
// Globale Metadaten-Broadcast-Funktion
function broadcastCurrentMetadata(force: boolean = false) {
  if (azuraCastWebcaster?.getConnectionStatus()) {
    azuraCastWebcaster.updateMetadataImmediate();
  }
}

// Bei Player-Events
audio.addEventListener('play', () => {
  // ... andere Logik
  setTimeout(() => broadcastCurrentMetadata(true), 100);
});
```

## Konfiguration

Die Metadaten-Updates können über folgende Parameter gesteuert werden:

- **Update-Intervall**: 5 Sekunden (hardcoded)
- **Fallback-Format**: `{username}@SubCaster`
- **Duplicate-Check**: Verhindert identische Metadaten-Sends
- **Auto-Retry**: Bei Verbindungsfehlern wird automatisch versucht zu reconnecten

## Debugging

Console-Ausgaben für Monitoring:

```
🔄 Started continuous metadata updates (every 5 seconds)
📊 Sent metadata to AzuraCast: Artist - Title
🎯 Forced metadata broadcast triggered
⚠️ Cannot send metadata - not connected to AzuraCast
```

## Kompatibilität

- ✅ Standard AzuraCast-Server
- ✅ funkturm.radio-endstation.de
- ✅ Demo-Credentials (demo:demo)
- ✅ Alle WebDJ-Features
- ✅ Automatische Fallbacks