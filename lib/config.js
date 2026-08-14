// Runtime config, resolved in layers (highest wins): settings.yaml
// `dsh-sight:` (hot-reloaded) > DSH_SIGHT_* env > ~/.config/dsh-sight/
// config.json > plugin row config > preset defaults. buildBaseConfig is the
// settings section's base layer; deriveConfig resolves presets + keys on the
// authoritative value at tool-call time.

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

export const Config = z.object({
  provider: z.string().default('opencode-zen'),
  apiKey: z.string().role('secret'),
  model: z.string().default(''),
  baseUrl: z.string().default(''),
  timeoutMs: z.number().default(120_000),
  maxTokens: z.number().default(4096),
  toolName: z.string().default('vision'),
  systemPrompt: z.boolean().default(true),
  maxImages: z.number().default(200),
})

export const CONFIG_FIELDS = Object.keys(Config.dict ?? {})

const NUM_FIELDS = ['timeoutMs', 'maxTokens', 'maxImages']
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
  // Fold the preset-scoped key env (e.g. GEMINI_API_KEY) into the base.
  const provider = base.provider ?? 'opencode-zen'
  const preset = PRESETS[provider]
  if (preset?.keyEnv && base.apiKey === undefined) {
    const key = envValue(preset.keyEnv)
    if (key) base.apiKey = key
  }
  return Config(base)
}

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

export function deriveConfig(config = {}) {
  const provider = config.provider || 'opencode-zen'
  const preset = PRESETS[provider] ?? null
  const keyless = preset?.keyless === true
  const apiKey =
    config.apiKey ||
    (preset?.keyEnv ? envValue(preset.keyEnv) || '' : '') ||
    envValue('DSH_SIGHT_API_KEY') ||
    ''
  const baseUrl = config.baseUrl || preset?.baseUrl || ''
  const model = config.model || preset?.model || ''
  const ready = !!(baseUrl && model && (apiKey || keyless))
  return {
    ...config,
    provider,
    preset,
    keyless,
    apiKey,
    baseUrl,
    model,
    timeoutMs: config.timeoutMs ?? 120_000,
    maxTokens: config.maxTokens ?? 4096,
    maxImages: config.maxImages ?? 200,
    toolName: config.toolName || 'vision',
    ready,
  }
}
