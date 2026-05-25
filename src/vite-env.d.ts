/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string
  readonly VITE_FIREBASE_AUTH_DOMAIN: string
  readonly VITE_FIREBASE_DATABASE_URL: string
  readonly VITE_FIREBASE_PROJECT_ID: string
  readonly VITE_FIREBASE_STORAGE_BUCKET: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string
  readonly VITE_FIREBASE_APP_ID: string
  readonly VITE_FIREBASE_FUNCTIONS_REGION?: string

  readonly VITE_USE_EMULATOR?: string
  readonly VITE_EMULATOR_HOST?: string
  readonly VITE_EMULATOR_AUTH_PORT?: string
  readonly VITE_EMULATOR_DATABASE_PORT?: string
  readonly VITE_EMULATOR_STORAGE_PORT?: string
  readonly VITE_EMULATOR_FUNCTIONS_PORT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
