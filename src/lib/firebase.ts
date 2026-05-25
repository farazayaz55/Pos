import { initializeApp, type FirebaseOptions } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getDatabase, connectDatabaseEmulator } from 'firebase/database'
import { getStorage, connectStorageEmulator } from 'firebase/storage'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'

const env = import.meta.env

const isTruthy = (v: string | undefined): boolean =>
  !!v && ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())

const useEmulator = isTruthy(env.VITE_USE_EMULATOR)

const emulatorHost = env.VITE_EMULATOR_HOST || '127.0.0.1'
const emulatorPorts = {
  auth: Number(env.VITE_EMULATOR_AUTH_PORT) || 9099,
  database: Number(env.VITE_EMULATOR_DATABASE_PORT) || 9000,
  storage: Number(env.VITE_EMULATOR_STORAGE_PORT) || 9199,
  functions: Number(env.VITE_EMULATOR_FUNCTIONS_PORT) || 5001,
}

const projectId = env.VITE_FIREBASE_PROJECT_ID || 'demo-project'

// When the Database emulator is in use, the SDK needs a databaseURL that points
// at the emulator. Otherwise use the real one from env.
const databaseURL = useEmulator
  ? `http://${emulatorHost}:${emulatorPorts.database}?ns=${projectId}-default-rtdb`
  : env.VITE_FIREBASE_DATABASE_URL

const config: FirebaseOptions = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'demo-key',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL,
  projectId,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
}

if (!useEmulator && (!env.VITE_FIREBASE_API_KEY || !env.VITE_FIREBASE_DATABASE_URL || !env.VITE_FIREBASE_PROJECT_ID)) {
  console.error(
    '[firebase] Missing VITE_FIREBASE_* env vars. Copy .env.example to .env and fill in your Firebase project values, or set VITE_USE_EMULATOR=true.',
  )
}

const region = env.VITE_FIREBASE_FUNCTIONS_REGION || 'us-central1'

export const app = initializeApp(config)
export const auth = getAuth(app)
export const db = getDatabase(app)
export const storage = getStorage(app)
export const functions = getFunctions(app, region)

// Connect to the local Firebase Emulator Suite when enabled.
// Each connect* call is idempotent-safe per app instance because the module
// is evaluated once thanks to ES module caching.
if (useEmulator) {
  try {
    connectAuthEmulator(auth, `http://${emulatorHost}:${emulatorPorts.auth}`, {
      disableWarnings: true,
    })
    connectDatabaseEmulator(db, emulatorHost, emulatorPorts.database)
    connectStorageEmulator(storage, emulatorHost, emulatorPorts.storage)
    connectFunctionsEmulator(functions, emulatorHost, emulatorPorts.functions)
    // eslint-disable-next-line no-console
    console.info(
      `[firebase] Emulator mode active -> auth:${emulatorPorts.auth} db:${emulatorPorts.database} storage:${emulatorPorts.storage} fns:${emulatorPorts.functions}`,
    )
  } catch (err) {
    console.error('[firebase] Failed to connect to emulators:', err)
  }
}

export const firebaseEnv = {
  useEmulator,
  projectId,
  region,
}
