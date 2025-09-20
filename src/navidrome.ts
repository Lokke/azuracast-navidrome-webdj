// Navidrome API Client für DJ Radio Webapp
// Server: https://musik.radio-endstation.de
// Credentials: a/b

interface NavidromeConfig {
  serverUrl: string;
  username: string;
  password: string;
}

interface NavidromeAuth {
  token: string;
  salt: string;
}

interface NavidromeArtistRef {
  id: string;
  name: string;
}

interface NavidromeSong {
  id: string;
  title: string;
  artist: string;  // Fallback string für Kompatibilität
  album: string;
  albumId?: string;  // Album ID falls verfügbar
  duration: number;
  size: number;
  suffix: string;
  bitRate: number;
  year?: number;
  genre?: string;
  coverArt?: string;
  userRating?: number;  // 1-5 stars rating
  artists?: NavidromeArtistRef[];  // Array von Artists mit ID und Name
  albumArtists?: NavidromeArtistRef[];  // Array von Album Artists
  displayArtist?: string;  // Anzeige-String für Artists
  displayAlbumArtist?: string;  // Anzeige-String für Album Artists
}

interface NavidromeAlbum {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  songCount: number;
  duration: number;
  year?: number;
  genre?: string;
  coverArt?: string;
}

interface NavidromeArtist {
  id: string;
  name: string;
  albumCount: number;
  starred?: string;
}

interface NavidromeSearchResult {
  song?: NavidromeSong[];
  album?: NavidromeAlbum[];
  artist?: NavidromeArtist[];
}

class NavidromeClient {
  private config: NavidromeConfig;
  private auth: NavidromeAuth | null = null;

  constructor(config: NavidromeConfig) {
    this.config = config;
  }

  // MD5 Hash Funktion für Authentifizierung (echte MD5-Implementierung)
  private md5(text: string): string {
    // Echte MD5-Implementierung für korrekte Navidrome-Authentifizierung
    function rotateLeft(lValue: number, iShiftBits: number): number {
      return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
    }

    function addUnsigned(lX: number, lY: number): number {
      const lX4 = (lX & 0x40000000);
      const lY4 = (lY & 0x40000000);
      const lX8 = (lX & 0x80000000);
      const lY8 = (lY & 0x80000000);
      const lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
      if (lX4 & lY4) {
        return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
      }
      if (lX4 | lY4) {
        if (lResult & 0x40000000) {
          return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
        } else {
          return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
        }
      } else {
        return (lResult ^ lX8 ^ lY8);
      }
    }

    function F(x: number, y: number, z: number): number {
      return (x & y) | ((~x) & z);
    }

    function G(x: number, y: number, z: number): number {
      return (x & z) | (y & (~z));
    }

    function H(x: number, y: number, z: number): number {
      return (x ^ y ^ z);
    }

    function I(x: number, y: number, z: number): number {
      return (y ^ (x | (~z)));
    }

    function FF(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
      a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
      return addUnsigned(rotateLeft(a, s), b);
    }

    function GG(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
      a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
      return addUnsigned(rotateLeft(a, s), b);
    }

    function HH(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
      a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
      return addUnsigned(rotateLeft(a, s), b);
    }

    function II(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
      a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
      return addUnsigned(rotateLeft(a, s), b);
    }

    function convertToWordArray(string: string): number[] {
      let lWordCount;
      const lMessageLength = string.length;
      const lNumberOfWords_temp1 = lMessageLength + 8;
      const lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
      const lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
      const lWordArray = Array(lNumberOfWords - 1);
      let lBytePosition = 0;
      let lByteCount = 0;
      while (lByteCount < lMessageLength) {
        lWordCount = (lByteCount - (lByteCount % 4)) / 4;
        lBytePosition = (lByteCount % 4) * 8;
        lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition));
        lByteCount++;
      }
      lWordCount = (lByteCount - (lByteCount % 4)) / 4;
      lBytePosition = (lByteCount % 4) * 8;
      lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
      lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
      lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
      return lWordArray;
    }

    function wordToHex(lValue: number): string {
      let WordToHexValue = "", WordToHexValue_temp = "", lByte, lCount;
      for (lCount = 0; lCount <= 3; lCount++) {
        lByte = (lValue >>> (lCount * 8)) & 255;
        WordToHexValue_temp = "0" + lByte.toString(16);
        WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2);
      }
      return WordToHexValue;
    }

    const x = convertToWordArray(text);
    let a = 0x67452301;
    let b = 0xEFCDAB89;
    let c = 0x98BADCFE;
    let d = 0x10325476;

    for (let k = 0; k < x.length; k += 16) {
      const AA = a;
      const BB = b;
      const CC = c;
      const DD = d;
      a = FF(a, b, c, d, x[k + 0], 7, 0xD76AA478);
      d = FF(d, a, b, c, x[k + 1], 12, 0xE8C7B756);
      c = FF(c, d, a, b, x[k + 2], 17, 0x242070DB);
      b = FF(b, c, d, a, x[k + 3], 22, 0xC1BDCEEE);
      a = FF(a, b, c, d, x[k + 4], 7, 0xF57C0FAF);
      d = FF(d, a, b, c, x[k + 5], 12, 0x4787C62A);
      c = FF(c, d, a, b, x[k + 6], 17, 0xA8304613);
      b = FF(b, c, d, a, x[k + 7], 22, 0xFD469501);
      a = FF(a, b, c, d, x[k + 8], 7, 0x698098D8);
      d = FF(d, a, b, c, x[k + 9], 12, 0x8B44F7AF);
      c = FF(c, d, a, b, x[k + 10], 17, 0xFFFF5BB1);
      b = FF(b, c, d, a, x[k + 11], 22, 0x895CD7BE);
      a = FF(a, b, c, d, x[k + 12], 7, 0x6B901122);
      d = FF(d, a, b, c, x[k + 13], 12, 0xFD987193);
      c = FF(c, d, a, b, x[k + 14], 17, 0xA679438E);
      b = FF(b, c, d, a, x[k + 15], 22, 0x49B40821);
      a = GG(a, b, c, d, x[k + 1], 5, 0xF61E2562);
      d = GG(d, a, b, c, x[k + 6], 9, 0xC040B340);
      c = GG(c, d, a, b, x[k + 11], 14, 0x265E5A51);
      b = GG(b, c, d, a, x[k + 0], 20, 0xE9B6C7AA);
      a = GG(a, b, c, d, x[k + 5], 5, 0xD62F105D);
      d = GG(d, a, b, c, x[k + 10], 9, 0x2441453);
      c = GG(c, d, a, b, x[k + 15], 14, 0xD8A1E681);
      b = GG(b, c, d, a, x[k + 4], 20, 0xE7D3FBC8);
      a = GG(a, b, c, d, x[k + 9], 5, 0x21E1CDE6);
      d = GG(d, a, b, c, x[k + 14], 9, 0xC33707D6);
      c = GG(c, d, a, b, x[k + 3], 14, 0xF4D50D87);
      b = GG(b, c, d, a, x[k + 8], 20, 0x455A14ED);
      a = GG(a, b, c, d, x[k + 13], 5, 0xA9E3E905);
      d = GG(d, a, b, c, x[k + 2], 9, 0xFCEFA3F8);
      c = GG(c, d, a, b, x[k + 7], 14, 0x676F02D9);
      b = GG(b, c, d, a, x[k + 12], 20, 0x8D2A4C8A);
      a = HH(a, b, c, d, x[k + 5], 4, 0xFFFA3942);
      d = HH(d, a, b, c, x[k + 8], 11, 0x8771F681);
      c = HH(c, d, a, b, x[k + 11], 16, 0x6D9D6122);
      b = HH(b, c, d, a, x[k + 14], 23, 0xFDE5380C);
      a = HH(a, b, c, d, x[k + 1], 4, 0xA4BEEA44);
      d = HH(d, a, b, c, x[k + 4], 11, 0x4BDECFA9);
      c = HH(c, d, a, b, x[k + 7], 16, 0xF6BB4B60);
      b = HH(b, c, d, a, x[k + 10], 23, 0xBEBFBC70);
      a = HH(a, b, c, d, x[k + 13], 4, 0x289B7EC6);
      d = HH(d, a, b, c, x[k + 0], 11, 0xEAA127FA);
      c = HH(c, d, a, b, x[k + 3], 16, 0xD4EF3085);
      b = HH(b, c, d, a, x[k + 6], 23, 0x4881D05);
      a = HH(a, b, c, d, x[k + 9], 4, 0xD9D4D039);
      d = HH(d, a, b, c, x[k + 12], 11, 0xE6DB99E5);
      c = HH(c, d, a, b, x[k + 15], 16, 0x1FA27CF8);
      b = HH(b, c, d, a, x[k + 2], 23, 0xC4AC5665);
      a = II(a, b, c, d, x[k + 0], 6, 0xF4292244);
      d = II(d, a, b, c, x[k + 7], 10, 0x432AFF97);
      c = II(c, d, a, b, x[k + 14], 15, 0xAB9423A7);
      b = II(b, c, d, a, x[k + 5], 21, 0xFC93A039);
      a = II(a, b, c, d, x[k + 12], 6, 0x655B59C3);
      d = II(d, a, b, c, x[k + 3], 10, 0x8F0CCC92);
      c = II(c, d, a, b, x[k + 10], 15, 0xFFEFF47D);
      b = II(b, c, d, a, x[k + 1], 21, 0x85845DD1);
      a = II(a, b, c, d, x[k + 8], 6, 0x6FA87E4F);
      d = II(d, a, b, c, x[k + 15], 10, 0xFE2CE6E0);
      c = II(c, d, a, b, x[k + 6], 15, 0xA3014314);
      b = II(b, c, d, a, x[k + 13], 21, 0x4E0811A1);
      a = II(a, b, c, d, x[k + 4], 6, 0xF7537E82);
      d = II(d, a, b, c, x[k + 11], 10, 0xBD3AF235);
      c = II(c, d, a, b, x[k + 2], 15, 0x2AD7D2BB);
      b = II(b, c, d, a, x[k + 9], 21, 0xEB86D391);
      a = addUnsigned(a, AA);
      b = addUnsigned(b, BB);
      c = addUnsigned(c, CC);
      d = addUnsigned(d, DD);
    }

    return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
  }

  // Authentifizierung mit Navidrome
  async authenticate(): Promise<boolean> {
    try {
      // Generiere Salt (random string)
      const salt = Math.random().toString(36).substring(2, 15);
      
      // Erstelle Token: md5(password + salt)
      const passwordSaltCombo = this.config.password + salt;
      const token = this.md5(passwordSaltCombo);
      
      console.log(`🔐 Auth Debug: password="${this.config.password}", salt="${salt}"`);
      console.log(`🔐 Auth Debug: password+salt="${passwordSaltCombo}"`);
      console.log(`🔐 Auth Debug: token="${token}"`);
      
      this.auth = { token, salt };

      // Teste Authentifizierung mit ping
      const response = await this.makeRequest('ping');
      return response.status === 'ok';
    } catch (error) {
      console.error('Navidrome Authentication failed:', error);
      return false;
    }
  }

  // HTTP Request zu Navidrome API
  private async makeRequest(method: string, params: Record<string, any> = {}): Promise<any> {
    if (!this.auth) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    const baseParams = {
      u: this.config.username,
      t: this.auth.token,
      s: this.auth.salt,
      f: 'json',
      v: '1.16.1',
      c: 'DJ-Radio-Webapp'
    };

    const allParams = { ...baseParams, ...params };
    const queryString = new URLSearchParams(allParams).toString();
    const url = `${this.config.serverUrl}/rest/${method}?${queryString}`;

    console.log('🌐 Navidrome API Request:', method, 'URL:', url.split('?')[0]);
    console.log('📋 Parameters:', Object.keys(allParams));

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        mode: 'cors' // Explizit CORS-Modus setzen
      });

      console.log('📥 Response status:', response.status, response.statusText);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
      }

      const data = await response.json();
      console.log('📦 Response data received');
      
      if (data['subsonic-response'].status !== 'ok') {
        const errorMsg = data['subsonic-response'].error?.message || 'Unknown error';
        console.error('🚫 Navidrome API error:', errorMsg);
        throw new Error(`Navidrome API error: ${errorMsg}`);
      }

      return data['subsonic-response'];
    } catch (fetchError) {
      console.error('🚨 Fetch error:', fetchError);
      throw fetchError;
    }
  }

  // Suche nach Songs, Alben, Künstlern
  async search(query: string, songCount = 20, albumCount = 10, artistCount = 10): Promise<NavidromeSearchResult> {
    const response = await this.makeRequest('search3', {
      query,
      songCount,
      albumCount,
      artistCount
    });

    return response.searchResult3 || {};
  }

  // Alle Songs abrufen (paginiert)
  async getSongs(size = 50, offset = 0): Promise<NavidromeSong[]> {
    const response = await this.makeRequest('getSong', { size, offset });
    return response.song || [];
  }

  // Alle Alben abrufen
  async getAlbums(size = 50, offset = 0): Promise<NavidromeAlbum[]> {
    const response = await this.makeRequest('getAlbumList2', { 
      type: 'alphabeticalByName',
      size, 
      offset 
    });
    return response.albumList2?.album || [];
  }

  // Alle Künstler abrufen
  async getArtists(): Promise<NavidromeArtist[]> {
    const response = await this.makeRequest('getArtists');
    const indexes = response.artists?.index || [];
    const artists: NavidromeArtist[] = [];
    
    indexes.forEach((index: any) => {
      if (index.artist) {
        artists.push(...index.artist);
      }
    });
    
    return artists;
  }

  // Songs eines Albums abrufen
  async getAlbumSongs(albumId: string): Promise<NavidromeSong[]> {
    const response = await this.makeRequest('getAlbum', { id: albumId });
    return response.album?.song || [];
  }

  // Songs eines Artists abrufen (Top Songs)
  async getArtistSongs(artistId: string): Promise<NavidromeSong[]> {
    try {
      // Versuche zuerst mit Artist ID über getArtistInfo2
      const response = await this.makeRequest('getArtistInfo2', { id: artistId });
      if (response.artistInfo2?.topSongs?.song) {
        return response.artistInfo2.topSongs.song;
      }
    } catch (error) {
      console.log('getArtistInfo2 failed, trying alternative approach');
    }

    try {
      // Alternative: Alle Songs suchen und nach Artist filtern
      // Zuerst Artist-Info holen für den Namen
      const artistResponse = await this.makeRequest('getArtist', { id: artistId });
      const artistName = artistResponse.artist?.name;
      
      if (artistName) {
        // TopSongs mit Artist-Namen abrufen
        const topSongsResponse = await this.makeRequest('getTopSongs', { artist: artistName });
        return topSongsResponse.topSongs?.song || [];
      }
    } catch (error) {
      console.log('getTopSongs failed, trying search approach');
    }

    try {
      // Fallback: Search verwenden
      const artistResponse = await this.makeRequest('getArtist', { id: artistId });
      const artistName = artistResponse.artist?.name;
      
      if (artistName) {
        const searchResponse = await this.makeRequest('search3', { 
          query: artistName,
          songCount: 20,
          albumCount: 0,
          artistCount: 0
        });
        return searchResponse.searchResult3?.song || [];
      }
    } catch (error) {
      console.error('All methods failed for getArtistSongs:', error);
    }

    return [];
  }

  // Albums eines Artists abrufen
  async getArtistAlbums(artistId: string): Promise<NavidromeAlbum[]> {
    const response = await this.makeRequest('getArtist', { id: artistId });
    return response.artist?.album || [];
  }

  // Get single artist by ID
  async getArtist(artistId: string): Promise<NavidromeArtist | null> {
    try {
      const response = await this.makeRequest('getArtist', { id: artistId });
      return response.artist || null;
    } catch (error) {
      console.error('Error getting artist by ID:', error);
      return null;
    }
  }

  // Alle Alben finden, auf denen ein Künstler vorkommt (auch Sampler)
  async getAllAlbumsWithArtist(artistName: string): Promise<NavidromeAlbum[]> {
    try {
      // Suche nach Songs des Künstlers, um alle Alben zu finden
      const searchResponse = await this.makeRequest('search3', { 
        query: artistName,
        songCount: 500,  // Mehr Songs für bessere Abdeckung
        albumCount: 200
      });
      
      const songs = searchResponse.searchResult3?.song || [];
      
      // Sammle alle Album-Namen aus Songs wo der Künstler beteiligt ist
      const albumNames = new Set<string>();
      
      songs.forEach((song: NavidromeSong) => {
        // Prüfe ob der Künstler in Artist-Field vorkommt (exakter Match oder Teil)
        if (song.artist && song.artist.toLowerCase().includes(artistName.toLowerCase())) {
          if (song.album) {
            albumNames.add(song.album);
          }
        }
      });
      
      // Jetzt suche nach jedem Album-Namen um die Album-Details zu bekommen
      const albums: NavidromeAlbum[] = [];
      const albumSet = new Set<string>(); // Duplikate vermeiden
      
      for (const albumName of albumNames) {
        try {
          const albumSearchResponse = await this.makeRequest('search3', { 
            query: albumName,
            albumCount: 50
          });
          
          const foundAlbums = albumSearchResponse.searchResult3?.album || [];
          foundAlbums.forEach((album: NavidromeAlbum) => {
            // Nur hinzufügen wenn exakter Album-Name Match
            if (album.name.toLowerCase() === albumName.toLowerCase() && !albumSet.has(album.id)) {
              albums.push(album);
              albumSet.add(album.id);
            }
          });
        } catch (error) {
          console.warn(`Failed to search for album ${albumName}:`, error);
        }
      }
      
      return albums;
    } catch (error) {
      console.error('Error searching for albums with artist:', error);
      return [];
    }
  }

  // Album-Informationen abrufen
  async getAlbumInfo(albumId: string): Promise<NavidromeAlbum | null> {
    const response = await this.makeRequest('getAlbum', { id: albumId });
    return response.album || null;
  }

  // Stream URL für einen Song erstellen
  getStreamUrl(songId: string): string {
    if (!this.auth) {
      throw new Error('Not authenticated');
    }

    const params = new URLSearchParams({
      u: this.config.username,
      t: this.auth.token,
      s: this.auth.salt,
      v: '1.16.1',
      c: 'DJ-Radio-Webapp',
      id: songId
    });

    // Ursprüngliche Navidrome URL
    const originalUrl = `${this.config.serverUrl}/rest/stream?${params.toString()}`;
    
    // CORS-Fix: Über SAME-ORIGIN API Route leiten (löst Cross-Origin Problem)
    const proxiedUrl = `/api/navidrome-stream?url=${encodeURIComponent(originalUrl)}`;
    
    console.log(`🎵 Stream URL (same-origin): ${proxiedUrl}`);
    return proxiedUrl;
  }

  // Cover Art URL erstellen
  getCoverArtUrl(coverArtId: string, size = 300): string {
    if (!this.auth || !coverArtId) {
      return '';
    }

    const params = new URLSearchParams({
      u: this.config.username,
      t: this.auth.token,
      s: this.auth.salt,
      v: '1.16.1',
      c: 'DJ-Radio-Webapp',
      id: coverArtId,
      size: size.toString()
    });

    // Ursprüngliche Cover Art URL
    const originalUrl = `${this.config.serverUrl}/rest/getCoverArt?${params.toString()}`;
    
    // CORS-Fix: Über SAME-ORIGIN API Route leiten (löst Cross-Origin Problem)
    const proxiedUrl = `/api/navidrome-cover?url=${encodeURIComponent(originalUrl)}`;
    
    return proxiedUrl;
  }

  // Download URL für einen Song
  getDownloadUrl(songId: string): string {
    if (!this.auth) {
      throw new Error('Not authenticated');
    }

    const params = new URLSearchParams({
      u: this.config.username,
      t: this.auth.token,
      s: this.auth.salt,
      v: '1.16.1',
      c: 'DJ-Radio-Webapp',
      id: songId
    });

    return `${this.config.serverUrl}/rest/download?${params.toString()}`;
  }

  // Rating für einen Song setzen (1-5 Sterne)
  async setRating(songId: string, rating: number): Promise<boolean> {
    try {
      if (rating < 1 || rating > 5) {
        throw new Error('Rating must be between 1 and 5');
      }

      await this.makeRequest('setRating', { 
        id: songId, 
        rating: rating.toString() 
      });
      
      return true;
    } catch (error) {
      console.error('Error setting rating:', error);
      return false;
    }
  }

  // Rating für einen Song abrufen
  async getRating(songId: string): Promise<number | null> {
    try {
      const response = await this.makeRequest('getSong', { id: songId });
      return response.song?.userRating || null;
    } catch (error) {
      console.error('Error getting rating:', error);
      return null;
    }
  }

  // Neueste Alben abrufen
  async getNewestAlbums(size = 20): Promise<NavidromeAlbum[]> {
    try {
      const response = await this.makeRequest('getAlbumList2', { 
        type: 'newest',
        size: size.toString()
      });
      
      return response.albumList2?.album || [];
    } catch (error) {
      console.error('Error getting newest albums:', error);
      return [];
    }
  }
}

// Exportiere für Verwendung in main.ts
export { NavidromeClient, type NavidromeSong, type NavidromeAlbum, type NavidromeArtist, type NavidromeSearchResult };