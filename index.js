// dsh-sight — plug-in vision for text-only dsh models.
//
// A dsh port of the opencode "vision-helper" design, with two additions:
//
//  1. Built-in VLM presets (GLM-4V-Flash, Gemini Flash, OpenCode Zen,
//     MiMo-V2.5, GPT-4o-mini, custom) — pick one in the web settings page,
//     fill a key, done.
//  2. Multi-image batch analysis — the `vision` tool takes N paths and
//     describes them in ONE request.
//
// Wiring:
//  - `vision` tool (raw JSON-Schema, zero dsh-tools dependency) reads local
//    files or http(s) URLs and answers through the configured VLM backend.
//  - Prompt-admission override: `apiProxy.sessions.prompt` is wrapped so a
//    pasted image is accepted even when the active model is text-only — the
//    bytes land in /tmp/dsh-sight/ and the image block becomes a path hint
//    before the message enters history (the model request never carries
//    image blocks). Works with ANY provider; no model variant to switch.
//  - Settings section: config lives in the `dsh-sight:` namespace of
//    settings.yaml (web page edits it; `role('secret')` API key never rides
//    a response). installSettingsSection hot-reloads it into every tool call.
//
// Config layers: settings.yaml > DSH_SIGHT_* env > ~/.config/dsh-sight/
// config.json > plugin row config > preset defaults.

import { settingsNamespace, installSettingsSection } from '@deepseek-ai/dsh-settings'
import { ensureTmpDir, setMaxImages, saveImage, TMP_DIR, MEDIA_EXT } from './lib/store.js'
import { buildBaseConfig, deriveConfig, validateConfig, Config } from './lib/config.js'
import { buildVisionTool } from './lib/tool.js'

export const name = 'dsh-sight'
export const inject = ['tools', 'attachments', 'llm', 'systemPrompt']

export function apply(ctx, rowConfig = {}) {
  const entry = buildBaseConfig(rowConfig)
  validateConfig(entry)
  ensureTmpDir()
  setMaxImages(entry.maxImages)

  let source = () => entry
  installSettingsSection(ctx, settingsNamespace('dsh-sight'), Config, entry, {
    validate: validateConfig,
    setSource: (current) => {
      source = current
    },
    onChange: () => {},
  })
  // Expose the `dsh-sight:` settings namespace to configuration clients (the
  // web settings page): the api proxy's exposed-namespace set is derived from
  // the configurable-provider directory, so a dormant directory row for our
  // own namespace makes settings.describe / settings.update accept it.
  if (typeof ctx.llm?.registerConfigurableProviders === 'function') {
    try {
      ctx.effect(() => ctx.llm.registerConfigurableProviders([{
        provider: 'dsh-sight',
        displayName: 'dsh-sight (vision config)',
        settingsNs: 'dsh-sight',
        settingsPath: [],
      }]))
    } catch (error) {
      console.error(`[dsh-sight] settings exposure skipped: ${error}`)
    }
  }
  const getConfig = () => deriveConfig(source())

  console.log(
    `[dsh-sight] loaded: ${getConfig().label} (model ${getConfig().model || '(unset)'}) — ${getConfig().ready ? 'backend ready' : 'NO api key, configure in Settings → dsh-sight or set ' + (getConfig().preset?.keyEnv || 'DSH_SIGHT_API_KEY')}`,
  )

  if (entry.systemPrompt !== false) registerSystemPrompt(ctx, getConfig)
  registerVisionTool(ctx, getConfig, entry.toolName)
  installPromptAdmission(ctx, getConfig)
}

function registerSystemPrompt(ctx, getConfig) {
  if (typeof ctx.systemPrompt?.section !== 'function') return
  ctx.systemPrompt.section({
    name: 'dsh-sight:instructions',
    order: 110,
    text: [
      'The active model is text-only and CANNOT process images directly.',
      `When a user message contains an image, this plugin saves it under ${TMP_DIR} and replaces the image with a hint like "[Image #N auto-saved to ${TMP_DIR}/imageN/hash.png]".`,
      `To analyze the image, call the \`${getConfig().toolName}\` tool with that exact path. Do NOT claim you can see the image directly, and do NOT claim the image failed to load.`,
    ].join('\n'),
  })
}

function registerVisionTool(ctx, getConfig, preferred) {
  const tryRegister = (toolName) => {
    try {
      ctx.tools.register(buildVisionTool(getConfig, toolName))
      return true
    } catch (error) {
      return error
    }
  }
  const first = tryRegister(preferred || 'vision')
  if (first === true) return
  const fallback = 'dsh_vision'
  if ((preferred || 'vision') !== fallback && /already|duplicate/i.test(String(first))) {
    const second = tryRegister(fallback)
    if (second === true) {
      console.error(`[dsh-sight] tool name "${preferred}" is taken by the host; registered as "${fallback}" instead`)
      return
    }
  }
  console.error(`[dsh-sight] vision tool registration skipped: ${first}`)
}

// ── Prompt-admission override ──────────────────────────────────────────────

/**
 * Override the host `session.prompt` admission so pasted images are accepted
 * even when the active model is text-only: each image block is saved to the
 * landing store and replaced by a path hint before the message enters
 * history, so the model request never carries image blocks and the
 * provider's modality gate cannot reject the turn. Image-capable routes pass
 * through untouched. The wrapper installs as a plain method replacement on
 * the apiProxy sessions object and restores the original on dispose.
 *
 * `session.selectModel` is wrapped as well: the host keeps the in-process
 * model switch in a private map, so this plugin mirrors each session's switch
 * to decide the admission path accurately even right after a switch, before
 * any request header is logged.
 */
function installPromptAdmission(ctx, getConfig) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['apiProxy'], (apiCtx) => {
    ctx.effect(() => installPromptAdmissionOverride(apiCtx, getConfig))
  })
}

function installPromptAdmissionOverride(ctx, getConfig) {
  const apiProxy = ctx.get('apiProxy')
  if (apiProxy === undefined || apiProxy.sessions === undefined || typeof apiProxy.sessions.prompt !== 'function') {
    return () => {}
  }
  const agents = ctx.get('agents')
  const agentDefaultModel = ctx.get('agentDefaultModel')
  const pickedBySession = new Map()
  const originalPrompt = apiProxy.sessions.prompt.bind(apiProxy.sessions)
  const originalSelectModel = typeof apiProxy.sessions.selectModel === 'function'
    ? apiProxy.sessions.selectModel.bind(apiProxy.sessions)
    : undefined

  if (originalSelectModel !== undefined) {
    apiProxy.sessions.selectModel = async (request) => {
      const result = await originalSelectModel(request)
      if (result?.result?.ok === true) {
        const payload = request?.payload
        if (payload?.provider !== undefined && payload?.model !== undefined && payload?.sessionId !== undefined) {
          pickedBySession.set(payload.sessionId, { provider: payload.provider, model: payload.model })
        }
      }
      return result
    }
  }

  apiProxy.sessions.prompt = async (request) => {
    try {
      const payload = request?.payload
      const content = payload?.content
      if (!Array.isArray(content)) return originalPrompt(request)
      const imageParts = content.filter((part) => part?.type === 'image')
      if (imageParts.length === 0) return originalPrompt(request)

      const route = currentModelOf(agents?.get(payload.sessionId), agentDefaultModel, pickedBySession.get(payload.sessionId))
      const llm = ctx.get('llm')
      if (route === undefined || llm === undefined) return originalPrompt(request)
      let imageCapable = false
      try {
        const info = await llm.resolveModelInfo(route.provider, route.model)
        imageCapable = info?.inputModalities !== undefined && info.inputModalities.includes('image')
      } catch {
        imageCapable = false
      }
      if (imageCapable) return originalPrompt(request)

      const replaced = content.map((part) => {
        if (part?.type !== 'image') return part
        const stored = savePastedImage(part)
        if (stored.ok) {
          return {
            type: 'text',
            text: `${stored.hint}\nThe active model is text-only and cannot view this image directly. Call the \`${getConfig().toolName}\` tool with the path above to get a description.`,
          }
        }
        return {
          type: 'text',
          text: `[A pasted image could not be read by dsh-sight: ${stored.error}. Tell the user.]`,
        }
      })
      return originalPrompt({ ...request, payload: { ...payload, content: replaced } })
    } catch (error) {
      return {
        rpcId: request?.rpcId,
        result: {
          ok: false,
          error: { code: 'attachment-error', message: error instanceof Error ? error.message : String(error) },
        },
      }
    }
  }

  return () => {
    apiProxy.sessions.prompt = originalPrompt
    if (originalSelectModel !== undefined) {
      apiProxy.sessions.selectModel = originalSelectModel
    }
    pickedBySession.clear()
  }
}

/** Save one pasted image part (base64 payload) into the landing store. */
function savePastedImage(part) {
  const mediaType = part?.mediaType
  if (typeof part?.data !== 'string' || part.data.length === 0) {
    return { ok: false, error: 'image part carries no data' }
  }
  if (!Object.prototype.hasOwnProperty.call(MEDIA_EXT, mediaType)) {
    return { ok: false, error: `unsupported pasted media type ${mediaType ?? '(none declared)'} (png/jpeg/webp/gif/bmp only)` }
  }
  const buffer = Buffer.from(part.data, 'base64')
  const saved = saveImage(buffer, mediaType)
  if (!saved) {
    return { ok: false, error: `could not store pasted image (${mediaType})` }
  }
  return { ok: true, ...saved }
}

/** The active route of one session, mirroring the admission gate's precedence. */
function currentModelOf(agent, agentDefaultModel, picked) {
  if (picked !== undefined && picked.provider !== undefined && picked.model !== undefined) {
    return picked
  }
  const logged = agent?.session?.requestHeader?.()?.config
  if (logged !== undefined && logged.provider !== undefined && logged.model !== undefined) {
    return { provider: logged.provider, model: logged.model }
  }
  const options = agent?.options
  if (options !== undefined && options.provider !== undefined && options.model !== undefined) {
    return { provider: options.provider, model: options.model }
  }
  const selection = agentDefaultModel?.currentSelection?.()
  if (selection !== undefined && selection.provider !== undefined && selection.model !== undefined) {
    return { provider: selection.provider, model: selection.model }
  }
  return undefined
}
