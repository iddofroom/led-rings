/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_LIBRARY_URL?: string
  readonly VITE_LIBRARY_KEY?: string
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
