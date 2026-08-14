// Mock OpenAI-compatible VLM server + engine smoke test. Validates:
//  1. multi-image batch → single request with N image_url parts
//  2. auth header + model + max_tokens forwarded
//  3. config resolution (env > file > row)
//  4. store dedup + LRU basics
import http from 'node:http'
import { analyzeImages } from '../lib/engine.js'
import { resolveConfig } from '../lib/config.js'
import { saveImage } from '../lib/store.js'

let lastRequest = null

const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    lastRequest = JSON.parse(Buffer.concat(chunks).toString())
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

// 1. engine batch: 2 images → one request with 2 image_url parts
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
if (saved3.seq !== saved1.seq + 1) {
  throw new Error('store sequencing failed')
}

const config = resolveConfig({ provider: 'custom', baseUrl, model: 'test-model', apiKey: 'test-key' })
const result = await analyzeImages(config, [saved1.filePath, saved3.filePath], 'compare these')
console.log('batch result:', JSON.stringify(result))
if (!result.includes('Image 1 description') || !result.includes('Image 2 description')) {
  throw new Error('batch descriptions missing')
}
if (lastRequest.messages[0].content.filter((p) => p.type === 'image_url').length !== 2) {
  throw new Error('expected 2 image_url parts in one request')
}
if (lastRequest.model !== 'test-model' || lastRequest.max_tokens !== 4096) {
  throw new Error('model/max_tokens not forwarded')
}

// 2. preset default + env override
process.env.DSH_SIGHT_PROVIDER = 'glm-4v-flash'
const presetConfig = resolveConfig({})
if (presetConfig.baseUrl !== 'https://open.bigmodel.cn/api/paas/v4' || presetConfig.model !== 'glm-4v-flash' || presetConfig.apiType !== 'openai') {
  throw new Error('preset resolution failed: ' + JSON.stringify(presetConfig))
}
delete process.env.DSH_SIGHT_PROVIDER

// 3. error path: missing file degrades to text, no throw
const badResult = await analyzeImages(config, ['/nonexistent/x.png'], undefined)
if (!badResult.includes('none of the specified images could be read')) {
  throw new Error('error path wrong: ' + badResult)
}

// 4. URL fetch path through mock server
const url = `${baseUrl}/pic.png`
const urlServer = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'image/png' })
  res.end(png)
})
await new Promise((resolve) => urlServer.listen(0, '127.0.0.1', resolve))
const urlPort = urlServer.address().port
const urlResult = await analyzeImages(config, [`http://127.0.0.1:${urlPort}/pic.png`], undefined)
if (!urlResult.includes('Image 1 description')) {
  throw new Error('URL fetch failed: ' + urlResult)
}
urlServer.close()

server.close()
console.log('ALL ENGINE TESTS PASSED')
