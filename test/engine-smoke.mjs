// Mock VLM server + engine smoke test. Validates:
//  1. multi-image batch → single request with N image_url parts
//  2. auth header + model + max_tokens forwarded
//  3. keyless preset → no Authorization header, ready=true without key
//  4. unsupported extension (heic) → clear per-image error, no mislabel
//  5. env override beats preset default
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

// 4. heic/unknown extension rejected clearly
const badResult = await analyzeImages(config, ['/tmp/x.heic'], undefined)
if (!badResult.includes('unsupported image extension')) throw new Error('heic must be rejected clearly: ' + badResult)

// 5. env override beats preset default
process.env.DSH_SIGHT_PROVIDER = 'gemini-flash'
const base = buildBaseConfig({})
if (base.provider !== 'gemini-flash') throw new Error('env override failed')
delete process.env.DSH_SIGHT_PROVIDER
setMaxImages(5)
if (buildBaseConfig({ maxImages: 9 }).maxImages !== 9) throw new Error('row config maxImages failed')

// 6. boot sweep: stale image dirs (mtime older than max age) are reclaimed,
//    fresh ones and non-image* dirs are left alone
const { ensureTmpDir } = await import('../lib/store.js')
const { mkdirSync, utimesSync, existsSync, rmSync } = await import('node:fs')
const { join } = await import('node:path')
const stale = join(TMP_DIR, 'image999')
mkdirSync(stale, { recursive: true })
utimesSync(stale, new Date(Date.now() - 10 * 24 * 3600 * 1000), new Date(Date.now() - 10 * 24 * 3600 * 1000))
const fresh = join(TMP_DIR, 'image998')
mkdirSync(fresh, { recursive: true })
const other = join(TMP_DIR, 'not-an-image-dir')
mkdirSync(other, { recursive: true })
ensureTmpDir()
if (existsSync(stale)) throw new Error('stale image dir must be swept')
if (!existsSync(fresh)) throw new Error('fresh image dir must survive the sweep')
if (!existsSync(other)) throw new Error('non-image* dir must survive the sweep')
rmSync(stale, { recursive: true, force: true })
rmSync(fresh, { recursive: true, force: true })
rmSync(other, { recursive: true, force: true })

server.close()
console.log('ALL ENGINE TESTS PASSED')
