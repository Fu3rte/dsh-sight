// Fake-services smoke test: boots the plugin entry against stub Cordis
// services and verifies the registrations it performs (tool schema, adapter
// routes, system-prompt section, image conversion pipeline).
import { apply } from '../index.js'
import { TMP_DIR, saveImage } from '../lib/store.js'

const registrations = { tools: [], sections: [], adapters: [] }
const fakeLlm = {
  listModels: async (provider) => [{ id: 'deepseek-chat', name: 'deepseek-chat' }],
  resolveModelInfo: async (_provider, model) => ({ id: model, name: model }),
  stream: async function* (options) {
    yield { type: 'x', options }
  },
}
const fakeCtx = {
  tools: { register: (def) => registrations.tools.push(def) },
  systemPrompt: { section: (s) => registrations.sections.push(s) },
  llm: {
    registerAdapter: (providers, adapter) => registrations.adapters.push({ providers, adapter }),
    listModels: fakeLlm.listModels,
    resolveModelInfo: fakeLlm.resolveModelInfo,
    stream: fakeLlm.stream,
  },
  attachments: {
    readImage: async () => ({ ref: { mediaType: 'image/png' }, data: Buffer.from('fake-png-bytes') }),
  },
}

apply(fakeCtx, { toolName: 'vision' })

// 1. tool registered with batch schema
if (registrations.tools.length !== 1) throw new Error('vision tool not registered')
const tool = registrations.tools[0]
if (tool.name !== 'vision') throw new Error('tool name wrong')
if (!tool.parameters?.properties?.paths?.items) throw new Error('paths array schema missing')
if (tool.parameters.required?.[0] !== 'paths') throw new Error('paths not required')

// 2. system prompt section
if (registrations.sections.length !== 1) throw new Error('system prompt section missing')
if (!registrations.sections[0].text.includes('vision')) throw new Error('section text wrong')

// 3. adapter registered on deepseek-vision route
if (registrations.adapters.length !== 1) throw new Error('adapter not registered')
const { providers, adapter } = registrations.adapters[0]
if (providers[0] !== 'deepseek-vision') throw new Error('adapter route wrong')

// 4. listModels wraps + renames + declares image input
const models = await adapter.listModels('deepseek-vision')
if (models[0].inputModalities?.join(',') !== 'text,image') throw new Error('inputModalities not set')
if (!models[0].name.includes('dsh-sight')) throw new Error('model not renamed')

// 5. stream() converts pasted image blocks to hints, delegates upstream
const messages = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'look at this' },
      { type: 'image', attachment: { ref: 'x', mediaType: 'image/png' } },
    ],
  },
]
const chunks = []
for await (const chunk of adapter.stream({ provider: 'deepseek-vision', model: 'deepseek-chat', messages, signal: undefined })) {
  chunks.push(chunk)
}
const delegated = chunks[0].options
if (delegated.provider !== 'deepseek-official') throw new Error('stream not delegated upstream')
const hintBlock = delegated.messages[0].content[1]
if (hintBlock.type !== 'text' || !hintBlock.text.includes('auto-saved to')) throw new Error('image not converted to hint: ' + JSON.stringify(hintBlock))
if (!hintBlock.text.includes(TMP_DIR)) throw new Error('hint path wrong')
const stored = saveImage(Buffer.from('fake-png-bytes'), 'image/png')
if (!stored) throw new Error('store save failed')

// 6. tool execute runs the engine against a live mock backend
const http = await import('node:http')
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const { mkdtempSync, writeFileSync } = await import('node:fs')
const { join } = await import('node:path')
const { tmpdir } = await import('node:os')
const dir = mkdtempSync(join(tmpdir(), 'dshv-test-'))
const imgPath = join(dir, 't.png')
writeFileSync(imgPath, png)

const server = http.createServer((req, res) => {
  req.resume()
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: 'a red pixel' } }] }))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const { resolveConfig } = await import('../lib/config.js')
const config = resolveConfig({ provider: 'custom', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm', apiKey: 'k' })
const { buildVisionTool } = await import('../lib/tool.js')
const testTool = buildVisionTool(config, 'vision')
const execResult = await testTool.execute({ paths: [imgPath] }, {})
if (execResult !== 'a red pixel') throw new Error('tool execute failed: ' + execResult)

// tool.execute against the unconfigured preset must throw helpfully
const unready = buildVisionTool(resolveConfig({ provider: 'glm-4v-flash' }), 'vision')
let threw = false
try {
  await unready.execute({ paths: [imgPath] }, {})
} catch (e) {
  threw = true
  if (!String(e.message).includes('ZHIPU_API_KEY')) throw new Error('unready error should name the missing key')
}
if (!threw) throw new Error('unready config should throw')

server.close()
console.log('ALL PLUGIN REGISTRATION TESTS PASSED')
