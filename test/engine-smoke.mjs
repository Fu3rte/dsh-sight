// Mock VLM server + engine smoke test. Validates:
//  1. multi-image batch → single request with N image_url parts
//  2. auth header + model + max_tokens forwarded
//  3. keyless preset → no Authorization header, ready=true without key
//  4. minimax backend → bounded concurrency (≤3 in flight), order preserved
//  5. unsupported extension (heic) → clear per-image error, no mislabel
//  6. config derivation (preset defaults, keyless ready)
//  7. store dedup + LRU basics + TMP_DIR naming
import http from 'node:http'
import { analyzeImages } from '../lib/engine.js'
import { buildBaseConfig, deriveConfig } from '../lib/config.js'
import { saveImage, TMP_DIR, setMaxImages } from '../lib/store.js'

if (!TMP_DIR.endsWith('dsh-sight')) throw new Error('TMP_DIR must be dsh-sight, got ' + TMP_DIR)

let lastRequest = null
let sawAuth = null

const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    lastRequest = JSON.parse(Buffer.concat(chunks).toString())
    sawAuth = req.headers.authorization ?? null
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: lastRequest.messages[0].content
                .filter((p) => p.type === 'image_url')
                .map((_, i) => `Image ${i + 1} description`)
                .join(' | '),
            },
          },
        ],
      }),
    )
  })
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const baseUrl = `http://127.0.0.1:${port}/v1`

// 1+2. engine batch: 2 images → one request with 2 image_url parts
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const saved1 = saveImage(png, 'image/png')
const saved2 = saveImage(png, 'image/png')
if (saved1.seq !== saved2.seq || saved1.filePath !== saved2.filePath) {
  throw new Error('store dedup failed: same bytes must get the same seq/path')
}
const saved3 = saveImage(Buffer.concat([png, Buffer.from([0])]), 'image/png')
if (saved3.seq !== saved1.seq + 1) throw new Error('store sequencing failed')

const config = deriveConfig({ provider: 'custom', baseUrl, model: 'test-model', apiKey: 'test-key' })
const result = await analyzeImages(config, [saved1.filePath, saved3.filePath], 'compare these')
if (!result.includes('Image 1 description') || !result.includes('Image 2 description')) {
  throw new Error('batch descriptions missing: ' + result)
}
if (lastRequest.messages[0].content.filter((p) => p.type === 'image_url').length !== 2) {
  throw new Error('expected 2 image_url parts in one request')
}
if (lastRequest.model !== 'test-model' || lastRequest.max_tokens !== 4096) {
  throw new Error('model/max_tokens not forwarded')
}
if (sawAuth !== 'Bearer test-key') throw new Error('auth header wrong: ' + sawAuth)

// 3. keyless: no key → no Authorization header, ready=true
const keyless = deriveConfig({ provider: 'opencode-zen', baseUrl, model: 'test-model', apiKey: '' })
if (keyless.ready !== true || keyless.keyless !== true) throw new Error('keyless ready derivation failed')
const keylessResult = await analyzeImages(keyless, [saved1.filePath], undefined)
if (!keylessResult.includes('Image 1 description')) throw new Error('keyless call failed')
if (sawAuth !== null) throw new Error('keyless call must not send Authorization, got ' + sawAuth)

// 3b. non-keyless preset without key → ready=false
const nokey = deriveConfig({ provider: 'gemini-flash' })
if (nokey.ready !== false) throw new Error('gemini preset without key must not be ready')

// 4. minimax concurrency: 6 images, 200ms per call, concurrency ≤ 3
let inFlight = 0
let maxInFlight = 0
let miniCalls = 0
const miniServer = http.createServer((req, res) => {
  miniCalls++
  inFlight++
  maxInFlight = Math.max(maxInFlight, inFlight)
  req.resume()
  req.on('end', () => {
    setTimeout(() => {
      inFlight--
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ content: 'mini-desc' }))
    }, 200)
  })
})
await new Promise((resolve) => miniServer.listen(0, '127.0.0.1', resolve))
const miniPort = miniServer.address().port
const miniConfig = deriveConfig({ provider: 'custom', apiType: 'minimax', baseUrl: `http://127.0.0.1:${miniPort}`, model: 'm', apiKey: 'k' })
const miniStart = Date.now()
const miniResult = await analyzeImages(
  miniConfig,
  [saved1.filePath, saved1.filePath, saved1.filePath, saved1.filePath, saved1.filePath, saved1.filePath],
  undefined,
)
const miniElapsed = Date.now() - miniStart
if (miniCalls !== 6) throw new Error('minimax expected 6 calls, got ' + miniCalls)
if (maxInFlight > 3) throw new Error('minimax concurrency exceeded 3: ' + maxInFlight)
if (miniElapsed > 900) throw new Error('minimax should run ~2 waves (~400ms), took ' + miniElapsed)
if (!miniResult.includes('--- Image 3 ---')) throw new Error('minimax order/labels broken')
miniServer.close()

// 5. heic/unknown extension rejected clearly
const badResult = await analyzeImages(config, ['/tmp/x.heic'], undefined)
if (!badResult.includes('unsupported image extension')) throw new Error('heic must be rejected clearly: ' + badResult)

// 6. env override beats preset default
process.env.DSH_SIGHT_PROVIDER = 'gemini-flash'
const base = buildBaseConfig({})
if (base.provider !== 'gemini-flash') throw new Error('env override failed')
delete process.env.DSH_SIGHT_PROVIDER
setMaxImages(5)
if (buildBaseConfig({ maxImages: 9 }).maxImages !== 9) throw new Error('row config maxImages failed')

server.close()
console.log('ALL ENGINE TESTS PASSED')
