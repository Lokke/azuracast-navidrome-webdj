import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  server: {
    proxy: {
      // OpenSubsonic Stream Proxy
      '/api/OpenSubsonic-stream': {
        target: 'http://localhost:8080', // Fallback target
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/OpenSubsonic-stream/, '/api/OpenSubsonic-stream'),
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            const targetUrl = req.url.split('url=')[1];
            if (targetUrl) {
              const decodedUrl = decodeURIComponent(targetUrl);
              console.log(`🎵 Proxying audio stream: ${decodedUrl}`);
              
              // Direkt zur OpenSubsonic URL weiterleiten
              const url = new URL(decodedUrl);
              proxyReq.path = url.pathname + url.search;
              proxyReq.setHeader('host', url.host);
              
              // Target dynamisch setzen
              proxy.options.target = `${url.protocol}//${url.host}`;
            }
          });
        }
      },
      
      // OpenSubsonic Cover Art Proxy  
      '/api/OpenSubsonic-cover': {
        target: 'http://localhost:8080', // Fallback target
        changeOrigin: true,
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            const targetUrl = req.url.split('url=')[1];
            if (targetUrl) {
              const decodedUrl = decodeURIComponent(targetUrl);
              console.log(`🖼️ Proxying cover art: ${decodedUrl}`);
              
              // Direkt zur OpenSubsonic URL weiterleiten
              const url = new URL(decodedUrl);
              proxyReq.path = url.pathname + url.search;
              proxyReq.setHeader('host', url.host);
              
              // Target dynamisch setzen
              proxy.options.target = `${url.protocol}//${url.host}`;
            }
          });
        }
      }
    }
  }
})