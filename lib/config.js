// Runtime config: layered resolution + hot-reload derivation.
//
// Layers (highest wins):
//   1. settings.yaml `dsh-sight:` section — written by the web settings page,
//      hot-reloaded through @deepseek-ai/dsh-settings (no restart).
//   2. environment variables (DSH_SIGHT_*)
//   3. config file (~/.config/dsh-sight/config.json, re-read on mtime change)
//   4. plugin row config (cordis.patch.yml `config:` block)
//   5. preset defaults (lib/presets.js)
//
// `buildBaseConfig` produces the composition-entry value that doubles as the
// settings section's base layer (when no settings service is mounted, it IS
// the config). `deriveConfig` applies preset lookup + key resolution on the
// currently authoritative value, so every tool call sees hot-reloaded config.

import z from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, statSync } from 'node:fs'
import { PRESETS } from './presets.js'

const DEFAULT_CONFIG_PATH = join(
  process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config'),
  'dsh-sight',
  'config.json',
)

/** Loader schema; every field carries a default so a sparse row config loads. */
export const Config = z.object({
  provider: z.string().default('glm-4v-flash'),
  apiKey: z.string().role('secret'),
  model: z.string().default(''),
  baseUrl: z.string().default(''),
  apiType: z.string().default(''),
  timeoutMs: z.number().default(120_000),
  maxTokens: z.number().default(4096),
  toolName: z.string().default('vision'),
  systemPrompt: z.boolean().default(true),
  maxImages: z.number().default(200),
})

export const CONFIG_FIELDS = Object.keys(Config.dict ?? {})

const NUM_FIELDS = ['timeoutMs', 'maxTokens', 'maxImages']
const STR_FIELDS = ['provider', 'apiKey', 'model', 'baseUrl', 'apiType', 'toolName']
const BOOL_FIELDS = ['systemPrompt']

let fileCache = { path: '', mtimeMs: 0, data: {} }

function readConfigFile() {
  const filePath = process.env['DSH_SIGHT_CONFIG'] || DEFAULT_CONFIG_PATH
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
    console.error(`[dsh-sight] config file ${filePath} is not valid JSON: ${error.message}`)
  }
  fileCache = { path: filePath, mtimeMs, data: {} }
  return fileCache.data
}

function envValue(name) {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

function camelToUpper(field) {
  return field.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()
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

/**
 * Build the base config value: env > config file > row config > preset
 * defaults. Contains only schema fields (it becomes the settings base layer).
 * @param {object} rowConfig - the `config:` block from the plugin row.
 */
export function buildBaseConfig(rowConfig = {}) {
  const file = readConfigFile()
  const base = {}
  for (const field of CONFIG_FIELDS) {
    const envName = `DSH_SIGHT_${camelToUpper(field)}`
    const kind = NUM_FIELDS.includes(field) ? 'number' : BOOL_FIELDS.includes(field) ? 'boolean' : 'string'
    const value =
      coerce(envValue(envName), kind) ??
      coerce(file[field], kind) ??
      coerce(rowConfig[field], kind)
    if (value !== undefined) base[field] = value
  }
  // Resolve the preset-scoped key env (e.g. ZHIPU_API_KEY) into the base so
  // settings.yaml never needs to know about provider-specific env names.
  const provider = base.provider ?? 'glm-4v-flash'
  const preset = PRESETS[provider]
  if (preset?.keyEnv && base.apiKey === undefined) {
    const key = envValue(preset.keyEnv)
    if (key) base.apiKey = key
  }
  // Schema call applies defaults (so a sparse row config still validates).
  return Config(base)
}

/** Validate constraints the schema DSL cannot express. */
export function validateConfig(config) {
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1) {
    throw new Error('dsh-sight: timeoutMs must be a positive integer')
  }
  if (!Number.isInteger(config.maxTokens) || config.maxTokens < 1) {
    throw new Error('dsh-sight: maxTokens must be a positive integer')
  }
  if (!Number.isInteger(config.maxImages) || config.maxImages < 1) {
    throw new Error('dsh-sight: maxImages must be a positive integer')
  }
  if (config.toolName.trim().length === 0) {
    throw new Error('dsh-sight: toolName must be a non-empty string')
  }
}

/**
 * Derive the fully resolved, ready-to-use config from the currently
 * authoritative value (settings.yaml hot-reloaded or the base). Called on
 * every tool execution, so edits apply without restart.
 * @param {object} config - the authoritative layered config (schema fields).
 */
export function deriveConfig(config = {}) {
  const provider = config.provider || 'glm-4v-flash'
  const preset = PRESETS[provider] ?? null
  const keyless = preset?.keyless === true
  const apiKey =
    config.apiKey ||
    (preset?.keyEnv ? envValue(preset.keyEnv) || '' : '') ||
    envValue('DSH_SIGHT_API_KEY') ||
    ''
  const apiType = config.apiType || preset?.type || 'openai'
  const baseUrl = config.baseUrl || preset?.baseUrl || ''
  const model = config.model || preset?.model || ''
  const ready = !!(baseUrl && model && (apiKey || keyless))
  return {
    ...config,
    provider,
    preset,
    keyless,
    apiKey,
    apiType: apiType === 'minimax' ? 'minimax' : 'openai',
    baseUrl,
    model,
    label: preset ? preset.label : `custom (${provider})`,
    timeoutMs: config.timeoutMs ?? 120_000,
    maxTokens: config.maxTokens ?? 4096,
    maxImages: config.maxImages ?? 200,
    toolName: config.toolName || 'vision',
    ready,
  }
}
