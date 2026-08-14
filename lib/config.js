// Runtime config resolution. Priority (highest wins):
//   1. environment variables (DSH_VISION_*)
//   2. config file  (~/.config/dsh-vision-helper/config.json, 0600; path
//      overridable via DSH_VISION_CONFIG)
//   3. plugin row config (cordis.patch.yml `config:` block)
//   4. preset defaults
//
// The file is re-read when its mtime changes, so `dsh-vision-helper doctor`-
// free edits apply on the next tool call without restarting the session.

import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, statSync } from 'node:fs'
import { PRESETS } from './presets.js'

const DEFAULT_CONFIG_PATH = join(
  process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config'),
  'dsh-vision-helper',
  'config.json',
)

const NUM_FIELDS = ['timeoutMs', 'maxTokens', 'maxImageBytes', 'maxImages']
const STR_FIELDS = ['provider', 'apiKey', 'model', 'baseUrl', 'apiType', 'toolName', 'upstream', 'providerId']
const BOOL_FIELDS = ['visionProvider', 'systemPrompt']

let fileCache = { path: '', mtimeMs: 0, data: {} }

function readConfigFile() {
  const filePath = process.env['DSH_VISION_CONFIG'] || DEFAULT_CONFIG_PATH
  let mtimeMs = 0
  try {
    mtimeMs = statSync(filePath).mtimeMs
  } catch {
    fileCache = { path: filePath, mtimeMs: 0, data: {} }
    return fileCache.data
  }
  if (fileCache.path === filePath && fileCache.mtimeMs === mtimeMs) return fileCache.data
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'))
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      fileCache = { path: filePath, mtimeMs, data }
      return data
    }
  } catch (error) {
    console.error(`[dsh-vision-helper] config file ${filePath} is not valid JSON: ${error.message}`)
  }
  fileCache = { path: filePath, mtimeMs, data: {} }
  return fileCache.data
}

function envValue(name) {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

function coerce(raw, kind) {
  if (raw === undefined || raw === null) return undefined
  if (kind === 'number') {
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : undefined
  }
  if (kind === 'boolean') {
    if (typeof raw === 'boolean') return raw
    if (raw === 'true' || raw === '1' || raw === 1) return true
    if (raw === 'false' || raw === '0' || raw === 0) return false
    return undefined
  }
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim()
  return undefined
}

function pick(value, raw, kind) {
  const coerced = coerce(raw, kind)
  return coerced === undefined ? value : coerced
}

/**
 * Merge everything into one resolved config object.
 * @param {object} rowConfig - the `config:` block from the plugin row.
 */
export function resolveConfig(rowConfig = {}) {
  const file = readConfigFile()
  const raw = (field) => file[field] ?? rowConfig[field]

  let provider = pick(envValue('DSH_VISION_PROVIDER'), raw('provider'), 'string')
  if (!provider) provider = 'glm-4v-flash'

  let preset = PRESETS[provider]
  if (!preset) {
    // Unknown provider id → treat as custom with its own baseUrl/model.
    preset = { label: `custom (${provider})`, type: 'openai', baseUrl: '', model: '', keyEnv: null }
  }

  const config = {
    provider,
    preset,
    apiType: preset.type,
    baseUrl: preset.baseUrl || '',
    model: preset.model || '',
    label: preset.label,
    timeoutMs: 120_000,
    maxTokens: 4096,
    maxImageBytes: 25 * 1024 * 1024,
    maxImages: 200,
    maxBatch: 10,
    toolName: 'vision',
    upstream: 'deepseek-official',
    providerId: 'deepseek-vision',
    visionProvider: true,
    systemPrompt: true,
    filePath: fileCache.path,
  }

  for (const field of NUM_FIELDS) {
    config[field] = pick(config[field], envValue(`DSH_VISION_${camelToUpper(field)}`), 'number') ?? pick(config[field], raw(field), 'number')
  }
  for (const field of BOOL_FIELDS) {
    const env = envValue(`DSH_VISION_${camelToUpper(field)}`)
    config[field] = env !== undefined ? coerce(env, 'boolean') : (raw(field) !== undefined ? coerce(raw(field), 'boolean') : config[field])
  }
  for (const field of STR_FIELDS) {
    const value = pick(envValue(`DSH_VISION_${camelToUpper(field)}`), raw(field), 'string')
    if (value !== undefined && value !== '') config[field] = value
  }

  // apiType only matters when overriding; keep it in sync with the preset.
  if (config.apiType && config.apiType !== 'openai' && config.apiType !== 'minimax') {
    console.error(`[dsh-vision-helper] unknown apiType "${config.apiType}"; falling back to the preset's type`)
    config.apiType = preset.type
  }

  // Resolve the API key: explicit config > preset-specific env > generic env.
  const keyEnv = preset.keyEnv ? envValue(preset.keyEnv) : undefined
  const genericEnv = envValue('DSH_VISION_API_KEY')
  const apiKey = config.apiKey || keyEnv || genericEnv || ''
  config.apiKey = apiKey

  // Custom provider without explicit baseUrl/model is a configuration error
  // we surface on tool use (so plugin load never fails).
  config.ready = !!(apiKey && config.baseUrl && config.model)

  return config
}

function camelToUpper(field) {
  return field.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()
}

// Legacy-safe export kept out of the plugin surface.
export function describeConfig(config) {
  return {
    provider: config.provider,
    label: config.label,
    model: config.model,
    baseUrl: config.baseUrl,
    apiType: config.apiType,
    key: config.apiKey ? '***set***' : '(missing)',
    ready: config.ready,
  }
}
