// Uploads a zip to the Microsoft Edge Add-ons store and submits it for review, for the Release
// workflow's Edge job (README.md, Releases). Edge Add-ons API v1.1.
//
//   node .github/scripts/publish-edge.mjs kemlock-0.1.0-chrome.zip "Notes for the reviewers"
//
// The credentials come from the environment and are never printed: EDGE_PRODUCT_ID, EDGE_CLIENT_ID
// and EDGE_API_KEY (Partner Center, Microsoft Edge, Publish API).
import { readFile } from 'node:fs/promises'

const need = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

const product = need('EDGE_PRODUCT_ID')
const zip = await readFile(process.argv[2] ?? '')
const notes = process.argv[3] ?? 'A new release.'
const base = `https://api.addons.microsoftedge.microsoft.com/v1/products/${product}/submissions`
const headers = {
  Authorization: `ApiKey ${need('EDGE_API_KEY')}`,
  'X-ClientID': need('EDGE_CLIENT_ID'),
}

/** Waits for the operation a 202 response names in its Location header. */
async function finish(response, what, operations) {
  if (response.status !== 202) {
    throw new Error(`${what}: HTTP ${response.status} ${await response.text()}`)
  }
  const location = response.headers.get('Location') ?? ''
  const url = location.startsWith('http') ? location : `${operations}/${location.split('/').pop()}`
  for (let tries = 0; tries < 60; tries++) {
    const poll = await fetch(url, { headers })
    if (!poll.ok) throw new Error(`${what}: HTTP ${poll.status} ${await poll.text()}`)
    const operation = await poll.json()
    if (operation.status === 'Succeeded') return
    if (operation.status === 'Failed') {
      const errors = (operation.errors ?? []).map((e) => e.message ?? JSON.stringify(e))
      throw new Error(`${what} failed: ${operation.message ?? ''} ${errors.join('; ')}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000))
  }
  throw new Error(`${what}: not finished after ten minutes`)
}

await finish(
  await fetch(`${base}/draft/package`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/zip' },
    body: zip,
  }),
  'Upload',
  `${base}/draft/package/operations`,
)
console.log('Edge Add-ons: uploaded')

await finish(
  await fetch(base, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes }),
  }),
  'Submission',
  `${base}/operations`,
)
console.log('Edge Add-ons: submitted for review')
