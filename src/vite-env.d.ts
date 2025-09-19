/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NAVIDROME_URL: string
  readonly VITE_NAVIDROME_USERNAME: string
  readonly VITE_NAVIDROME_PASSWORD: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}