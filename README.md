# SubCaster

Web interface for radio moderators. Provides access to music from OpenSubsonic-compatible servers (Navidrome, Gonic, Ampache, Astiga, LMS, Nextcloud Music, ownCloud Music, Supysonic) with live streaming to AzuraCast.
<img width="1846" height="999" alt="Screenshot 2025-09-24 002355" src="https://github.com/user-attachments/assets/b3c522a6-95bc-417a-9f3c-15ff7dfa8fd9" />

## Features

- Music library browser for OpenSubsonic servers
- Dual-deck audio player with crossfader
- Microphone input with live mixing
- Direct streaming to AzuraCast
- Smart metadata transmission
- Browser-based interface

## License

Non-commercial use only.

See LICENSE and COMMERCIAL-LICENSE.md for details.

### Third-Party Licenses

This project uses Material Icons (MaterialIcons-Regular.woff2) provided by Google under the Apache License 2.0. See LICENSE-MATERIAL-ICONS for the full license text.

## Docker Setup

Clone repository:

```bash
git clone https://github.com/Lokke/subcaster.git
cd subcaster
```

Start with Docker Compose:

```bash
docker-compose up -d
```

Open interface at http://localhost:5173

### Environment Variables

**Streaming Configuration:**
- `STREAM_USERNAME` - Streaming username
- `STREAM_PASSWORD` - Streaming password  
- `STREAM_SERVER` - Streaming server hostname
- `STREAM_PORT` - Streaming port (default: 8015)
- `STREAM_MOUNT` - Mount point (default: /)

**OpenSubsonic Configuration:**
- `VITE_OPENSUBSONIC_URL` - OpenSubsonic server URL
- `VITE_OPENSUBSONIC_USERNAME` - OpenSubsonic username  
- `VITE_OPENSUBSONIC_PASSWORD` - OpenSubsonic password

**Advanced Streaming Options:**
- `VITE_STREAM_SERVER_TYPE` - Server type: 'icecast' or 'shoutcast' (default: icecast)
- `VITE_STREAM_BITRATE` - Audio bitrate in kbps (default: 192)
- `VITE_USE_PROXY` - Use proxy for streaming (true/false)
- `VITE_PROXY_SERVER` - Proxy server URL (default: http://localhost:3001)

**Unified Login (Optional):**
- `VITE_USE_UNIFIED_LOGIN` - Use same credentials for all services (true/false)
- `VITE_UNIFIED_USERNAME` - Unified username for all services
- `VITE_UNIFIED_PASSWORD` - Unified password for all services

## Manual Installation

Install dependencies:

```bash
npm install
```

Configure streaming in `.env`:

```env
VITE_STREAM_USERNAME=username
VITE_STREAM_PASSWORD=password
```


Start development server:

```bash
npm run dev
```


Open interface at http://localhost:5173

