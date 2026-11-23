// Uploads a zip to the Chrome Web Store and submits it for review, for the Release workflow's
// Chrome job (README.md, Releases). Chrome Web Store API v2, signed in as a service account.
//
//   node .github/scripts/publish-chrome.mjs kemlock-0.1.0-chrome.zip
//
// The credentials come from the environment and are never printed: CWS_PUBLISHER_ID and
// CWS_EXTENSION_ID, and CWS_SERVICE_ACCOUNT_KEY, the service account's JSON key. The service
// account is added under Account in the Chrome Web Store developer dashboard, and the Chrome Web
// Store API is enabled in its Google Cloud project. The API cannot create an item: its first
// version is uploaded by hand.
import { createSign } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const need = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

const item = `publishers/${need('CWS_PUBLISHER_ID')}/items/${need('CWS_EXTENSION_ID')}`
const key = JSON.parse(need('CWS_SERVICE_ACCOUNT_KEY'))
const zip = await readFile(process.argv[2] ?? '')
const api = 'https://chromewebstore.googleapis.com'
const scope = 'https://www.googleapis.com/auth/chromewebstore'

/** Reads a response as JSON, failing with the store's own words when it is not a success. */
async function json(response, what) {
  const text = await response.text()
  if (!response.ok) throw new Error(`${what}: HTTP ${response.status} ${text}`)
  return text ? JSON.parse(text) : {}
}

const base64url = (value) => Buffer.from(value).toString('base64url')

/** An access token for the service account: a signed JWT, exchanged at Google's token URL. */
async function accessToken() {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(
    JSON.stringify({
      iss: key.client_email,
      scope,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  )
  const signature = createSign('RSA-SHA256')
    .update(`${header}.${claims}`)
    .sign(key.private_key)
    .toString('base64url')
  const response = await json(
    await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${header}.${claims}.${signature}`,
      }),
    }),
    'Google sign-in',
  )
  return response.access_token
}

const headers = { Authorization: `Bearer ${await accessToken()}` }

const upload = await json(
  await fetch(`${api}/upload/v2/${item}:upload`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/zip' },
    body: zip,
  }),
  'Upload',
)
let state = upload.uploadState
// A large upload may still be processed: ask again for a while
for (let tries = 0; state === 'IN_PROGRESS' && tries < 30; tries++) {
  await new Promise((resolve) => setTimeout(resolve, 10_000))
  const status = await json(await fetch(`${api}/v2/${item}:fetchStatus`, { headers }), 'Status')
  state = status.lastAsyncUploadState
}
if (state !== 'SUCCEEDED') throw new Error(`Upload ended as ${state}`)
console.log('Chrome Web Store: uploaded')

const published = await json(
  await fetch(`${api}/v2/${item}:publish`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: '{}',
  }),
  'Publish',
)
if (!['PENDING_REVIEW', 'STAGED', 'PUBLISHED', 'PUBLISHED_TO_TESTERS'].includes(published.state)) {
  throw new Error(`Publish ended as ${published.state}`)
}
console.log(`Chrome Web Store: ${published.state}`)
