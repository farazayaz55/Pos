#!/usr/bin/env node
// Seeds a Super Admin into the REAL Firebase project (Realtime Database + Firebase Auth).
//
// Usage:
//   npm run seed:super-admin
//
// Optional overrides via env vars:
//   SEED_PROJECT_ID=servr-7d3f7
//   SEED_DATABASE_URL=https://servr-7d3f7-default-rtdb.firebaseio.com
//   SEED_EMAIL=superadmin@pos.com
//   SEED_PASSWORD=admin123
//   SEED_NAME="Super Admin"
//
// AUTH PREREQUISITES (pick ONE):
//   A) Download a Firebase Service Account JSON from
//      Firebase Console -> Project Settings -> Service accounts -> Generate new private key
//      then:
//        export GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/service-account.json
//        (Windows PowerShell: $env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\service-account.json")
//
//   B) Use the gcloud CLI:
//        gcloud auth application-default login
//        gcloud config set project servr-7d3f7
//
// Also make sure Firebase Auth (Email/Password) and Realtime Database are enabled
// in your Firebase project.

import admin from 'firebase-admin'

// ----------------------------------------------------
// CONFIG (resolved from env with sensible defaults)
// ----------------------------------------------------

const PROJECT_ID = process.env.SEED_PROJECT_ID || 'servr-7d3f7'
const DATABASE_URL =
  process.env.SEED_DATABASE_URL ||
  `https://${PROJECT_ID}-default-rtdb.firebaseio.com`

const EMAIL = process.env.SEED_EMAIL || 'superadmin@pos.com'
const PASSWORD = process.env.SEED_PASSWORD || 'admin123'
const NAME = process.env.SEED_NAME || 'Super Admin'

// ----------------------------------------------------
// INITIALIZE FIREBASE ADMIN SDK
// ----------------------------------------------------

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: PROJECT_ID,
  databaseURL: DATABASE_URL,
})

const auth = admin.auth()
const rtdb = admin.database()

// ----------------------------------------------------
// BANNER
// ----------------------------------------------------

const banner = `
---------------------------------------------------------------
  POS Super Admin Seeder (Realtime Database + Auth)
---------------------------------------------------------------
  Project   : ${PROJECT_ID}
  Database  : ${DATABASE_URL}
  Email     : ${EMAIL}
  Password  : ${PASSWORD}
  Name      : ${NAME}
---------------------------------------------------------------
`

// ----------------------------------------------------
// MAIN
// ----------------------------------------------------

async function main() {
  console.log(banner)

  let userRecord

  try {
    userRecord = await auth.getUserByEmail(EMAIL)

    console.log(
      `[1/3] Found existing Auth user (uid=${userRecord.uid}). Updating...`,
    )

    userRecord = await auth.updateUser(userRecord.uid, {
      password: PASSWORD,
      displayName: NAME,
      emailVerified: true,
      disabled: false,
    })
  } catch (err) {
    if (err && err.code === 'auth/user-not-found') {
      console.log('[1/3] Creating new Auth user...')

      userRecord = await auth.createUser({
        email: EMAIL,
        password: PASSWORD,
        displayName: NAME,
        emailVerified: true,
      })

      console.log(`      -> created uid=${userRecord.uid}`)
    } else {
      throw err
    }
  }

  console.log('[2/3] Setting custom claim { role: "super_admin" }...')

  await auth.setCustomUserClaims(userRecord.uid, {
    role: 'super_admin',
  })

  console.log('[3/3] Writing RTDB node users/<uid>...')

  await rtdb.ref(`users/${userRecord.uid}`).update({
    email: EMAIL,
    name: NAME,
    role: 'super_admin',
    createdAt: admin.database.ServerValue.TIMESTAMP,
  })

  console.log('\n✅ Super Admin seeded successfully!\n')

  console.log('Login Credentials:')
  console.log(`  Email    : ${EMAIL}`)
  console.log(`  Password : ${PASSWORD}`)
  console.log(`  UID      : ${userRecord.uid}`)
  console.log(
    '\nNOTE: Custom claims are baked into the ID token. After signing in,',
  )
  console.log(
    '      either sign out & back in, or call getIdToken(true) to refresh.\n',
  )
}

// ----------------------------------------------------
// EXECUTE
// ----------------------------------------------------

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Seed failed:\n')
    console.error(err)
    console.error(`
Common fixes:

1. Credentials not found
   - Set GOOGLE_APPLICATION_CREDENTIALS to your service-account.json, OR
   - Run: gcloud auth application-default login
          gcloud config set project ${PROJECT_ID}

2. Firebase Auth (Email/Password) is not enabled in the console.

3. Realtime Database is not created, or DATABASE_URL is wrong.
   Current: ${DATABASE_URL}

4. Service account is missing the "Firebase Admin" / "Editor" role.
`)
    process.exit(1)
  })
