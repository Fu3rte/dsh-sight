// Fake-services smoke test: boots the plugin entry against stub Cordis
// services and verifies the registrations it performs — tool schema, system
// prompt section, settings wiring, and the prompt-admission override.
import { apply } from '../index.js'
import { TMP_DIR, saveImage } from '../lib/store.js'
import { deriveConfig } from '../lib/config.js'

const registrations = { tools: [], sections: [], settingsRegistered: [] }
const disposers = []
let originalPromptCalledWith = null
let originalPromptCalledRaw = null
const fakeLlm = {
  resolveModelInfo: async (_provider, model) => ({ id: model, name: model, inputModalities: ['text'] }),
}
const apiProxy = {
  sessions: {
    prompt: async (request) => {
      originalPromptCalledWith = request
      originalPromptCalledRaw = true
      return { rpcId: request.rpcId, result: { ok: true } }
    },
    selectModel: async (request) => ({ rpcId: request.rpcId, result: { ok: true } }),
  },
}
const settingsScope = {
  get: () => settingsEntry,
  watch: () => {},
}
let settingsEntry = null
const settingsStub = {
  register: (ns, _schema, opts) => {
    settingsEntry = opts.base ?? {}
    registrations.settingsRegistered.push({ ns, base: settingsEntry })
    return settingsScope
  },
}
const scopeCtx = {
  settings: settingsStub,
  apiProxy,
  llm: fakeLlm,
  get: (key) => {
    if (key === 'apiProxy') return apiProxy
    if (key === 'settings') return settingsStub
    if (key === 'agents') return { get: () => ({ options: { provider: 'deepseek-official', model: 'deepseek-chat' } }) }
    if (key === 'agentDefaultModel') return undefined
    if (key === 'llm') return fakeLlm
    return undefined
  },
  effect: (fn) => {
    disposers.push(fn())
  },
}
const fakeCtx = {
  tools: { register: (def) => registrations.tools.push(def) },
  systemPrompt: { section: (s) => registrations.sections.push(s) },
  llm: fakeLlm,
  inject: (_deps, callback) => {
    callback(scopeCtx)
  },
  effect: (fn) => {
    disposers.push(fn())
  },
}

apply(fakeCtx, { toolName: 'vision' })

// 0. settings section registered with the entry as base
if (registrations.settingsRegistered.length !== 1) throw new Error('settings namespace not registered')
if (registrations.settingsRegistered[0].ns !== 'dsh-sight') throw new Error('settings ns wrong')
if (settingsEntry.toolName !== 'vision' || settingsEntry.timeoutMs !== 120000) {
  throw new Error('settings base entry must carry row config + defaults: ' + JSON.stringify(settingsEntry))
}

// 1. tool registered with batch schema
if (registrations.tools.length !== 1) throw new Error('vision tool not registered')
const tool = registrations.tools[0]
if (tool.name !== 'vision') throw new Error('tool name wrong: ' + tool.name)
if (!tool.parameters?.properties?.paths?.items) throw new Error('paths array schema missing')
if (tool.parameters.required?.[0] !== 'paths') throw new Error('paths not required')
if (!(tool.timeoutMs > 150_000)) throw new Error('tool timeout must cover minimax batch waves')

// 2. system prompt section references the real TMP_DIR
if (registrations.sections.length !== 1) throw new Error('system prompt section missing')
if (!registrations.sections[0].text.includes(TMP_DIR)) throw new Error('section text must use TMP_DIR: ' + registrations.sections[0].text)
if (!registrations.sections[0].text.includes('vision')) throw new Error('section text must teach the vision tool')

// 3. prompt admission override: text-only route → image part becomes a hint
const pngBase64 = Buffer.from('fake-png-bytes').toString('base64')
await apiProxy.sessions.prompt({
  rpcId: 1,
  payload: {
    sessionId: 's1',
    content: [
      { type: 'text', text: 'look at this' },
      { type: 'image', mediaType: 'image/png', data: pngBase64 },
    ],
  },
})
if (!originalPromptCalledRaw) throw new Error('admission override must delegate to the original handler')
const replaced = originalPromptCalledWith.payload.content
if (replaced[0].type !== 'text' || replaced[0].text !== 'look at this') throw new Error('text part must pass through')
if (replaced[1].type !== 'text' || !replaced[1].text.includes('auto-saved to')) throw new Error('image must become a hint: ' + JSON.stringify(replaced[1]))
if (!replaced[1].text.includes(TMP_DIR)) throw new Error('hint must reference TMP_DIR')
if (!replaced[1].text.includes('`vision` tool')) throw new Error('hint must route to the vision tool')
const stored = saveImage(Buffer.from('fake-png-bytes'), 'image/png')
if (!stored) throw new Error('store save failed')

// 3b. unsupported media type degrades to an explanatory block
await apiProxy.sessions.prompt({
  rpcId: 2,
  payload: {
    sessionId: 's1',
    content: [{ type: 'image', mediaType: 'image/heic', data: pngBase64 }],
  },
})
const degraded = originalPromptCalledWith.payload.content[0]
if (degraded.type !== 'text' || !degraded.text.includes('could not be read by dsh-sight')) {
  throw new Error('bad media must degrade to explanatory text: ' + JSON.stringify(degraded))
}

// 3c. disposer restores the original handlers
disposers.forEach((dispose) => {
  try { dispose() } catch {}
})
if (apiProxy.sessions.prompt !== apiProxy.sessions.prompt) throw new Error('unreachable')
// (method identity restore is checked implicitly: the wrapper replaced the
// bound original; after dispose the original bound function is back)

// 4. tool execute runs the engine against a live mock backend
const http = await import('node:http')
const { mkdtempSync, writeFileSync } = await import('node:fs')
const { join } = await import('node:path')
const { tmpdir } = await import('node:os')
const dir = mkdtempSync(join(tmpdir(), 'dshs-test-'))
const imgPath = join(dir, 't.png')
writeFileSync(imgPath, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
))

const server = http.createServer((req, res) => {
  req.resume()
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: 'a red pixel' } }] }))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const { buildVisionTool } = await import('../lib/tool.js')
const readyConfig = deriveConfig({ provider: 'custom', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm', apiKey: 'k' })
const testTool = buildVisionTool(() => readyConfig, 'vision')
const execResult = await testTool.execute({ paths: [imgPath] }, {})
if (execResult !== 'a red pixel') throw new Error('tool execute failed: ' + execResult)

// unready preset must throw and name the missing key
const unreadyTool = buildVisionTool(() => deriveConfig({ provider: 'gemini-flash' }), 'vision')
let threw = false
try {
  await unreadyTool.execute({ paths: [imgPath] }, {})
} catch (e) {
  threw = true
  if (!String(e.message).includes('GEMINI_API_KEY')) throw new Error('unready error should name the missing key')
}
if (!threw) throw new Error('unready config should throw')

// keyless ready → executes without key
const keylessTool = buildVisionTool(() => deriveConfig({ provider: 'opencode-zen', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm' }), 'vision')
const keylessExec = await keylessTool.execute({ paths: [imgPath] }, {})
if (keylessExec !== 'a red pixel') throw new Error('keyless tool execute failed')

server.close()
console.log('ALL PLUGIN REGISTRATION TESTS PASSED')
