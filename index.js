// dsh-sight — plug-in vision for text-only dsh models.
//
// A dsh port of the opencode "vision-helper" design, with two additions:
//
//  1. Built-in VLM presets (GLM-4V-Flash, MiMo-V2.5, Gemini Flash, OpenCode
//     Zen, GPT-4o-mini, custom) — fill one key, no baseUrl/model assembly.
//  2. Multi-image batch analysis — the `vision` tool takes N paths and
//     describes them in ONE request.
//
// Wiring:
//  - `vision` tool (raw JSON-Schema, zero dsh imports) reads local files or
//    http(s) URLs and answers through the configured VLM backend.
//  - A vision provider wrapper (default on) registers a `deepseek-vision`
//    model variant that admits image pastes (the upstream DeepSeek adapter
//    refuses them at intake), then converts each image block into a temp-file
//    hint at request time and delegates the stream back upstream. The
//    durable log keeps the real image; only the wire messages change.
//  - A system-prompt section teaches the model the hint → vision tool flow.
//
// Everything is configurable via env (DSH_SIGHT_*), the config file
// (~/.config/dsh-sight/config.json), or the plugin row config.

import { ensureTmpDir, saveImage } from './lib/store.js'
import { resolveConfig, describeConfig } from './lib/config.js'
import { buildVisionTool } from './lib/tool.js'

export const name = 'dsh-sight'
export const inject = ['tools', 'attachments', 'llm', 'systemPrompt']

const MEDIA_EXT_OK = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/heic', 'image/heif']

export function apply(ctx, rowConfig = {}) {
  const config = resolveConfig(rowConfig)
  ensureTmpDir()
  console.log(
    `[dsh-sight] loaded: ${config.label} (model ${config.model || '(unset)'}) — ${config.ready ? 'api key set' : 'NO api key, set ' + (config.preset.keyEnv || 'DSH_SIGHT_API_KEY')}`,
  )

  if (config.systemPrompt !== false) registerSystemPrompt(ctx, config)
  registerVisionTool(ctx, config)
  if (config.visionProvider !== false) registerVisionProvider(ctx, config)
}

function registerSystemPrompt(ctx, config) {
  if (typeof ctx.systemPrompt?.section !== 'function') return
  ctx.systemPrompt.section({
    name: 'dsh-sight:instructions',
    order: 110,
    text: [
      'The active model is text-only and CANNOT process images directly.',
      `When a user message contains an image, this plugin saves it under ${'/tmp/dsh-sight'} and injects a hint like "[Image #N auto-saved to /tmp/dsh-sight/imageN/hash.png]".`,
      `To analyze the image, call the \`${config.toolName}\` tool with that exact path. Do NOT claim you can see the image directly, and do NOT claim the image failed to load.`,
    ].join('\n'),
  })
}

function registerVisionTool(ctx, config) {
  const preferred = config.toolName || 'vision'
  const tryRegister = (toolName) => {
    try {
      ctx.tools.register(buildVisionTool(config, toolName))
      return true
    } catch (error) {
      return error
    }
  }
  const first = tryRegister(preferred)
  if (first === true) return
  const fallback = 'dsh_vision'
  if (preferred !== fallback && /already|duplicate/i.test(String(first))) {
    const second = tryRegister(fallback)
    if (second === true) {
      console.error(`[dsh-sight] tool name "${preferred}" is taken by the host; registered as "${fallback}" instead`)
      return
    }
  }
  console.error(`[dsh-sight] vision tool registration skipped: ${first}`)
}

// ── Vision provider wrapper ────────────────────────────────────────────────

function registerVisionProvider(ctx, config) {
  const upstream = config.upstream || 'deepseek-official'
  const providerId = config.providerId || 'deepseek-vision'
  const families = ['deepseek']
  const VISION_ID = /(deepseek-(vl|ocr)|janus)/i

  const shouldWrap = (info) => {
    const id = String(info?.id ?? '').toLowerCase()
    if (!families.some((family) => id.startsWith(family))) return false
    if (VISION_ID.test(id)) return false
    if (Array.isArray(info?.inputModalities) && info.inputModalities.includes('image')) return false
    return true
  }
  const withVision = (info) => ({ ...info, provider: providerId, inputModalities: ['text', 'image'] })

  if (typeof ctx.llm?.registerAdapter !== 'function' || typeof ctx.llm?.stream !== 'function') return

  try {
    ctx.llm.registerAdapter([providerId], {
      providerInfo(provider) {
        return { id: provider, name: 'DeepSeek (dsh-sight)' }
      },
      providerRetryPolicy() {
        return undefined
      },
      async listModels(_provider, signal) {
        try {
          const models = await ctx.llm.listModels(upstream, signal)
          return models.filter(shouldWrap).map((model) => ({
            ...withVision(model),
            name: `${model.name ?? model.id} (dsh-sight)`,
          }))
        } catch {
          return []
        }
      },
      async resolveModel(_provider, model, signal) {
        const info = await ctx.llm.resolveModelInfo(upstream, model, signal)
        if (!shouldWrap(info)) {
          throw new Error(`model "${model}" is outside the dsh-sight wrap scope`)
        }
        return { ...withVision(info), id: model }
      },
      stream(options) {
        const self = this
        return (async function* () {
          const messages = await convertImagesToHints(ctx, options.messages, options.signal, self)
          yield* ctx.llm.stream({ ...options, provider: upstream, messages })
        })()
      },
      hintCache: new Map(),
    })
  } catch (error) {
    console.error(`[dsh-sight] vision provider registration skipped: ${error}`)
  }
}

function contentHasImage(blocks) {
  return (
    Array.isArray(blocks) &&
    blocks.some((b) => b?.type === 'image' || (b?.type === 'tool-result' && contentHasImage(b.content)))
  )
}

async function convertBlocks(blocks, convertOne) {
  const out = []
  for (const block of blocks) {
    if (block?.type === 'image') {
      out.push(await convertOne(block))
    } else if (block?.type === 'tool-result' && contentHasImage(block.content)) {
      out.push({ ...block, content: await convertBlocks(block.content, convertOne) })
    } else {
      out.push(block)
    }
  }
  return out
}

async function convertImagesToHints(ctx, messages, signal, adapter) {
  const out = []
  for (const message of messages) {
    if (!contentHasImage(message.content)) {
      out.push(message)
      continue
    }
    const content = await convertBlocks(message.content, (block) =>
      hintForBlock(ctx, block, adapter),
    )
    out.push({ ...message, content })
  }
  return out
}

// Same attachment rides every later step of its session; cache the hint so
// the (cheap but repeated) read+write is done once. Failures are NOT cached.
const HINT_CACHE_LIMIT = 64

async function hintForBlock(ctx, block, adapter) {
  const key = JSON.stringify(block.attachment ?? block)
  const hit = adapter.hintCache.get(key)
  if (hit !== undefined) {
    adapter.hintCache.delete(key)
    adapter.hintCache.set(key, hit)
    return hit
  }
  const pending = (async () => {
    try {
      const stored = await ctx.attachments.readImage(block.attachment)
      if (!stored?.data) {
        throw new Error("attachments.readImage returned no 'data' bytes; the dsh attachment shape may have changed")
      }
      const mediaType = stored.ref?.mediaType ?? block.attachment?.mediaType
      if (!MEDIA_EXT_OK.includes(mediaType)) {
        throw new Error(`unsupported pasted media type ${mediaType ?? '(none declared)'}`)
      }
      const saved = saveImage(Buffer.from(stored.data), mediaType)
      if (!saved) {
        throw new Error(`could not store pasted image (${mediaType})`)
      }
      return {
        type: 'text',
        text: `${saved.hint}\nThe active model is text-only and cannot view this image directly. Call the \`vision\` tool with the path above to get a description.`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : String(error)
      adapter.hintCache.delete(key)
      return {
        type: 'text',
        text: `[A pasted image could not be read by dsh-sight: ${message}. Tell the user, and check DSH_SIGHT_* / ~/.config/dsh-sight/config.json.]`,
      }
    }
  })()
  adapter.hintCache.set(key, pending)
  while (adapter.hintCache.size > HINT_CACHE_LIMIT) {
    adapter.hintCache.delete(adapter.hintCache.keys().next().value)
  }
  return pending
}
