// The `vision` tool: a raw JSON-Schema tool definition (zero dsh-tools
// dependency). Owns its argument validation inside execute(). Reads config
// through a thunk on every call so hot-reloaded settings apply immediately.

import { analyzeImages } from './engine.js'
import { deriveConfig } from './config.js'

const MAX_BATCH = 10

// Worst-case backstop: MiniMax runs images with bounded concurrency (3), so a
// full batch is ~ceil(n/3) sequential waves of `timeoutMs` each.
const TOOL_TIMEOUT_WAVES = Math.ceil(MAX_BATCH / 3) + 1

export function buildVisionTool(getConfig, toolName) {
  return {
    name: toolName,
    description: [
      'Analyze one or more images through an external vision-language model (VLM) and return a plain-text description.',
      'Use whenever the active model is text-only and cannot see an image directly: pass absolute local file paths or http(s) URLs of screenshots, photos, charts, diagrams, or document scans.',
      'MULTI-IMAGE BATCH: pass several paths in one call — they are analyzed in a single request and the result labels each description.',
      'Pasted images land in /tmp/dsh-sight/ and their hint text carries the exact path to pass here.',
      'The VLM backend (preset, model, API key) is configured in the dsh settings page under "dsh-sight", or via DSH_SIGHT_* env vars / ~/.config/dsh-sight/config.json.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: `Absolute local file paths and/or http(s) URLs of the images to analyze (${MAX_BATCH} max per call).`,
        },
        question: {
          type: 'string',
          description: 'Optional specific question about the image(s).',
        },
      },
      required: ['paths'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    // Backstop computed at registration from the initial timeoutMs; per-request
    // timeouts inside the engine stay dynamic (hot-reloaded).
    timeoutMs: deriveConfig(getConfig()).timeoutMs * TOOL_TIMEOUT_WAVES + 30_000,
    isConcurrencySafe: () => true,
    presentCall: (args) => {
      const paths = Array.isArray(args?.paths) ? args.paths : []
      return {
        card: 'generic',
        title: toolName,
        kind: 'read',
        rawInput: args,
        ...(paths.length > 0
          ? { locations: paths.filter((p) => typeof p === 'string' && !/^https?:\/\//i.test(p)).map((path) => ({ path })) }
          : {}),
      }
    },
    async execute(args, exec) {
      const paths = Array.isArray(args?.paths)
        ? args.paths.map((p) => String(p).trim()).filter(Boolean)
        : []
      if (paths.length === 0) {
        throw new Error('"paths" must be a non-empty array of image paths or http(s) URLs.')
      }
      if (paths.length > MAX_BATCH) {
        throw new Error(`too many images: ${paths.length} (max ${MAX_BATCH} per call).`)
      }
      const config = deriveConfig(getConfig())
      if (!config.ready) {
        const keyHint = config.keyless
          ? ''
          : ` Set the API key in Settings → dsh-sight (or ${config.preset?.keyEnv || 'DSH_SIGHT_API_KEY'}).`
        throw new Error(
          `No vision backend configured: provider="${config.provider}", apiKey ${config.apiKey ? 'set' : 'MISSING'}, baseUrl ${config.baseUrl ? 'set' : 'MISSING'}, model ${config.model ? 'set' : 'MISSING'}.${keyHint}`,
        )
      }
      return analyzeImages(config, paths, args?.question, exec?.signal)
    },
  }
}
