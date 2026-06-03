#!/usr/bin/env node
// Grants `allUsers` the `roles/run.invoker` role on the Cloud Run services
// that back our Gen 2 Cloud Functions, so the browser CORS preflight stops
// receiving 403 Forbidden from Google Frontend.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/service-account.json \
//   node scripts/grant-public-invoker.mjs
//
// or:
//   npm run grant:public

import { GoogleAuth } from 'google-auth-library'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ID = process.env.SEED_PROJECT_ID || 'servr-7d3f7'
const REGION = process.env.SEED_REGION || 'us-central1'

// Gen 2 Cloud Functions are backed by Cloud Run services whose names are the
// lowercased function name (no separators). e.g. createCompanyAdmin -> createcompanyadmin
const FUNCTIONS = [
  'createCompanyAdmin',
  'deleteCompany',
  'updateCompanyAdmin',
  'setSuperAdminClaim',
  'getTerminalConnectionToken',
  'createKioskPaymentIntent',
  'createKioskOrder',
  'getKioskOrder',
].map((n) => n.toLowerCase())

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_KEY_PATH = path.resolve(
  __dirname,
  '../../../servr-7d3f7-firebase-adminsdk-fbsvc-28d5525432.json',
)
const KEY_PATH =
  process.env.GOOGLE_APPLICATION_CREDENTIALS || DEFAULT_KEY_PATH

if (!fs.existsSync(KEY_PATH)) {
  console.error(
    'Service account key not found. Set GOOGLE_APPLICATION_CREDENTIALS or place the key at:',
    DEFAULT_KEY_PATH,
  )
  process.exit(1)
}

const auth = new GoogleAuth({
  keyFile: KEY_PATH,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
})

async function grantOne(serviceName) {
  const base =
    `https://run.googleapis.com/v1/projects/${PROJECT_ID}` +
    `/locations/${REGION}/services/${serviceName}`

  const client = await auth.getClient()

  const { data: current } = await client.request({
    url: `${base}:getIamPolicy`,
    method: 'GET',
  })

  const bindings = Array.isArray(current?.bindings) ? current.bindings : []
  const invokerBinding = bindings.find((b) => b.role === 'roles/run.invoker')

  if (invokerBinding) {
    const members = new Set(invokerBinding.members || [])
    if (members.has('allUsers')) {
      console.log(`  - ${serviceName}: already public, skipping.`)
      return
    }
    members.add('allUsers')
    invokerBinding.members = [...members]
  } else {
    bindings.push({ role: 'roles/run.invoker', members: ['allUsers'] })
  }

  await client.request({
    url: `${base}:setIamPolicy`,
    method: 'POST',
    data: {
      policy: {
        etag: current?.etag,
        bindings,
      },
    },
  })

  console.log(`  + ${serviceName}: granted allUsers -> roles/run.invoker`)
}

async function main() {
  console.log(`Project: ${PROJECT_ID}  Region: ${REGION}\n`)
  console.log('Granting public invoker on Cloud Run services:')

  for (const fn of FUNCTIONS) {
    try {
      await grantOne(fn)
    } catch (err) {
      const status = err?.response?.status
      const body = err?.response?.data
      console.error(`  ! ${fn}: FAILED (${status || 'unknown'})`)
      if (body) console.error('     ', JSON.stringify(body))

      if (
        typeof JSON.stringify(body) === 'string' &&
        JSON.stringify(body).includes('iam.allowedPolicyMemberDomains')
      ) {
        console.error(
          '\n  Your Google Cloud org has Domain Restricted Sharing enforced.\n' +
            '  Disable it for this project, or add an exception, then retry.\n' +
            '  Console: https://console.cloud.google.com/iam-admin/orgpolicies?project=' +
            PROJECT_ID,
        )
      }
    }
  }

  console.log('\nDone. Try the request again in your app.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
