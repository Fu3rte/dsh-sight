// The `vision` tool: a raw JSON-Schema tool definition (zero dsh package
// imports, mirroring the modlens precedent so out-of-tree resolution is never
// a factor). Owns its argument validation inside execute().

import { analyzeImages } from './engine.js'

const MAX_BATCH = 10

export function buildVisionTool(config, toolName) {
  const backendLine = config.ready
    ? `Current backend: ${config.label} (model "${config.model}").`
    : `NO backend configured yet: provider "${config.provider}" is missing its API key or base URL. Set ${config.preset.keyEnv || 'DSH_VISION_API_KEY'} or fill ~/.config/dsh-vision-helper/config.json.`

  return {
    name: toolName,
    description: [
      'Analyze one or more images through an external vision-language model (VLM) and return a plain-text description.',
      'Use whenever the active model is text-only and cannot see an image directly: pass absolute local file paths or http(s) URLs of screenshots, photos, charts, diagrams, or document scans.',
      'MULTI-IMAGE BATCH: pass several paths in one call — they are analyzed in a single request and the result labels each description.',
      'Pasted images land in /tmp/dsh-vision/ and their hint text carries the exact path to pass here.',
      backendLine,
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
    timeoutMs: config.timeoutMs + 30_000,
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
      if (!config.ready) {
        throw new Error(
          `No vision backend configured. provider="${config.provider}", apiKey ${config.apiKey ? 'set' : 'MISSING'}, baseUrl ${config.baseUrl ? 'set' : 'MISSING'}, model ${config.model ? 'set' : 'MISSING'}. Set ${config.preset.keyEnv || 'DSH_VISION_API_KEY'} or write ~/.config/dsh-vision-helper/config.json.`,
        )
      }
      if (paths.length > MAX_BATCH) {
        throw new Error(`too many images: ${paths.length} (max ${MAX_BATCH} per call).`)
      }
      return analyzeImages(config, paths, args?.question, exec?.signal)
    },
  }
}
