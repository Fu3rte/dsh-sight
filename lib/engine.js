// Vision engine: two backends, one batched entry point.
//
//  - openai:  one POST {baseUrl}/chat/completions carrying every image as an
//             inline base64 image_url part. Multi-image batch = one request.
//  - minimax: POST {baseUrl}/v1/coding_plan/vlm per image (the native VLM
//             endpoint takes a single image), run with bounded concurrency
//             (3); results are joined with per-image headers and per-image
//             failures are collected, never fatal.
//
// Inputs are local absolute paths or http(s) URLs. Local reads are capped by
// config.maxImageBytes; URL fetches are capped at 25 MiB, 30s, and must claim
// an image/* content type. Remote bodies are inlined, never forwarded as URLs
// (no SSRF surface on the vision API). Keyless presets send no Authorization
// header at all.

import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'

const URL_FETCH_TIMEOUT_MS = 30_000
const URL_FETCH_MAX_BYTES = 25 * 1024 * 1024
const MINIMAX_CONCURRENCY = 3

const EXT_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

function truncate(text, max = 1024) {
  const s = String(text ?? '')
  return s.length > max ? `${s.slice(0, max)}… [truncated, ${s.length} bytes total]` : s
}

async function loadFromUrl(url, signal) {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status} ${truncate(await response.text(), 300)}` }
    }
    const mediaType = (response.headers.get('content-type') || '').split(';')[0].trim()
    if (!mediaType.startsWith('image/')) {
      return { ok: false, error: `URL does not serve an image (content-type: ${mediaType || 'none'})` }
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > URL_FETCH_MAX_BYTES) {
      return { ok: false, error: `image over the ${URL_FETCH_MAX_BYTES / 1024 / 1024}MB URL limit` }
    }
    if (buffer.length === 0) {
      return { ok: false, error: 'empty response body' }
    }
    return { ok: true, buffer, mediaType }
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? `URL fetch timed out after ${URL_FETCH_TIMEOUT_MS}ms`
      : error?.message || 'network request failed'
    return { ok: false, error: message }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

async function loadFromFile(path, maxBytes) {
  const mime = EXT_MIME[extname(path).toLowerCase()]
  if (!mime) {
    return { ok: false, error: `unsupported image extension (supported: ${Object.keys(EXT_MIME).join(' ')})` }
  }
  try {
    const info = await stat(path)
    if (!info.isFile()) return { ok: false, error: 'not a regular file' }
    if (info.size > maxBytes) {
      return { ok: false, error: `file is ${(info.size / 1024 / 1024).toFixed(1)}MB, over the ${(maxBytes / 1024 / 1024).toFixed(0)}MB limit` }
    }
    const buffer = await readFile(path)
    return { ok: true, buffer, mediaType: mime }
  } catch (error) {
    return { ok: false, error: error?.code === 'ENOENT' ? 'no such file' : error?.message }
  }
}

/**
 * Resolve every input into { label, source, mime, dataUrl }. Rejections are
 * collected per-image; a batch fails only when nothing resolves.
 */
async function loadImages(paths, config, signal) {
  const images = []
  const errors = []
  for (const raw of paths) {
    const source = String(raw).trim()
    if (!source) continue
    const label = source.split(/[\\/]/).pop() || source
    let loaded
    if (/^https?:\/\//i.test(source)) {
      loaded = await loadFromUrl(source, signal)
    } else {
      loaded = await loadFromFile(source, config.maxImageBytes)
    }
    if (!loaded.ok) {
      errors.push(`[${label}]: ${loaded.error}`)
      continue
    }
    const dataUrl = `data:${loaded.mediaType};base64,${loaded.buffer.toString('base64')}`
    images.push({ label, source, mime: loaded.mediaType, dataUrl })
  }
  return { images, errors }
}

function defaultPrompt(count) {
  if (count <= 1) return 'Please describe this image in detail.'
  return `These are ${count} images. Describe each image in detail, labeling every description with its image number and file name (Image 1, Image 2, …).`
}

function authHeaders(config) {
  return config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}
}

async function postJson(url, headers, body, config, signal) {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(config), ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`vision API request timed out after ${config.timeoutMs}ms`)
    }
    throw new Error(error?.message || 'network request failed')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

async function callOpenAI(config, images, question, signal) {
  const apiUrl = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const content = [{ type: 'text', text: question || defaultPrompt(images.length) }]
  for (const image of images) {
    content.push({ type: 'image_url', image_url: { url: image.dataUrl } })
  }
  const response = await postJson(
    apiUrl,
    {},
    { model: config.model, messages: [{ role: 'user', content }], max_tokens: config.maxTokens },
    config,
    signal,
  )
  if (!response.ok) {
    throw new Error(`vision API error (${response.status}): ${truncate(await response.text())}`)
  }
  let data
  try {
    data = await response.json()
  } catch {
    throw new Error(`vision API response is not valid JSON: ${truncate(await response.text().catch(() => '(unreadable body)'), 300)}`)
  }
  const message = data?.choices?.[0]?.message
  const contentOut = message?.content
  if (typeof contentOut === 'string') return contentOut || 'No description returned.'
  if (Array.isArray(contentOut)) {
    const text = contentOut
      .filter((part) => part?.type === 'text' || typeof part?.text === 'string')
      .map((part) => part.text)
      .join('')
    return text || 'No description returned.'
  }
  return 'No description returned.'
}

/** Bounded-concurrency map: preserves input order, limits in-flight calls. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

async function callMiniMax(config, images, question, signal) {
  const apiUrl = `${config.baseUrl.replace(/\/+$/, '')}/v1/coding_plan/vlm`
  const parts = await mapLimit(images, MINIMAX_CONCURRENCY, async (image) => {
    try {
      const response = await postJson(
        apiUrl,
        {},
        { prompt: question || 'Please describe this image in detail', image_url: image.dataUrl },
        config,
        signal,
      )
      if (!response.ok) {
        return `[Error for ${image.label}]: API ${response.status} — ${truncate(await response.text(), 300)}`
      }
      let data
      try {
        data = await response.json()
      } catch {
        return `[Error for ${image.label}]: response is not valid JSON`
      }
      if (data?.base_resp?.status_code && data.base_resp.status_code !== 0) {
        return `[Error for ${image.label}]: ${data.base_resp.status_msg || `status_code ${data.base_resp.status_code}`}`
      }
      return data?.content || 'No description returned.'
    } catch (error) {
      return `[Error for ${image.label}]: ${truncate(error?.message || String(error))}`
    }
  })
  if (parts.length === 0) throw new Error('no images were processed')
  if (parts.length === 1) return parts[0]
  return parts.map((part, i) => `--- Image ${i + 1} ---\n${part}`).join('\n\n')
}

/**
 * Analyze one or more images. Returns a plain-text description; per-image
 * load failures are appended as bracketed notes so partial batches still
 * report what they could see.
 */
export async function analyzeImages(config, paths, question, signal) {
  const limited = paths.slice(0, config.maxBatch ?? 10)
  const { images, errors } = await loadImages(limited, config, signal)
  if (images.length === 0) {
    const reasons = errors.length > 0 ? `\n  ${errors.join('\n  ')}` : ''
    return `Error: none of the specified images could be read.${reasons}`
  }
  const result = config.apiType === 'minimax'
    ? await callMiniMax(config, images, question, signal)
    : await callOpenAI(config, images, question, signal)
  if (errors.length === 0) return result
  return `${result}\n\n[Could not read ${errors.length} input(s):]\n  ${errors.join('\n  ')}`
}
