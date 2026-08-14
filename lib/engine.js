// Vision engine: two backends, one batched entry point.
//
//  - openai:  one POST {baseUrl}/chat/completions carrying every image as an
//             inline base64 image_url part. Multi-image batch = one request.
//  - minimax: POST {baseUrl}/v1/coding_plan/vlm per image (the native VLM
//             endpoint takes a single image), results joined with per-image
//             headers; per-image failures are collected, never fatal.
//
// Inputs are local absolute paths or http(s) URLs. Local reads are capped by
// config.maxImageBytes; URL fetches are capped at 25 MiB, 30s, and must claim
// an image/* content type. Remote bodies are inlined, never forwarded as URLs
// (no SSRF surface on the vision API).

import { readFile, stat } from 'node:fs/promises'

const URL_FETCH_TIMEOUT_MS = 30_000
const URL_FETCH_MAX_BYTES = 25 * 1024 * 1024

function truncate(text, max = 1024) {
  const s = String(text ?? '')
  return s.length > max ? `${s.slice(0, max)}… [truncated, ${s.length} bytes total]` : s
}

function mimeFromPath(p) {
  const ext = (p.split('.').pop() || '').toLowerCase()
  return {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
  }[ext] || 'image/png'
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
  try {
    const info = await stat(path)
    if (!info.isFile()) return { ok: false, error: 'not a regular file' }
    if (info.size > maxBytes) {
      return { ok: false, error: `file is ${(info.size / 1024 / 1024).toFixed(1)}MB, over the ${(maxBytes / 1024 / 1024).toFixed(0)}MB limit` }
    }
    const buffer = await readFile(path)
    return { ok: true, buffer, mediaType: mimeFromPath(path) }
  } catch (error) {
    return { ok: false, error: error?.code === 'ENOENT' ? 'no such file' : error?.message }
  }
}

/**
 * Resolve every input into { label, mime, dataUrl }. Rejections are collected
 * per-image; a batch fails only when nothing resolves.
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
    const mime = loaded.mediaType === 'image/jpeg' ? 'image/jpeg' : loaded.mediaType
    const dataUrl = `data:${mime};base64,${loaded.buffer.toString('base64')}`
    images.push({ label, source, mime, dataUrl })
  }
  return { images, errors }
}

function defaultPrompt(count) {
  if (count <= 1) return 'Please describe this image in detail.'
  return `These are ${count} images. Describe each image in detail, labeling every description with its image number and file name (Image 1, Image 2, …).`
}

async function postJson(url, headers, body, config, signal) {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
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

async function callOpenAI(config, images, question) {
  const apiUrl = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const content = [{ type: 'text', text: question || defaultPrompt(images.length) }]
  for (const image of images) {
    content.push({ type: 'image_url', image_url: { url: image.dataUrl } })
  }
  const response = await postJson(
    apiUrl,
    { Authorization: `Bearer ${config.apiKey}` },
    { model: config.model, messages: [{ role: 'user', content }], max_tokens: config.maxTokens },
    config,
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

async function callMiniMax(config, images, question) {
  const apiUrl = `${config.baseUrl.replace(/\/+$/, '')}/v1/coding_plan/vlm`
  const parts = []
  for (const image of images) {
    try {
      const response = await postJson(
        apiUrl,
        { Authorization: `Bearer ${config.apiKey}` },
        { prompt: question || 'Please describe this image in detail', image_url: image.dataUrl },
        config,
      )
      if (!response.ok) {
        parts.push(`[Error for ${image.label}]: API ${response.status} — ${truncate(await response.text(), 300)}`)
        continue
      }
      let data
      try {
        data = await response.json()
      } catch {
        parts.push(`[Error for ${image.label}]: response is not valid JSON`)
        continue
      }
      if (data?.base_resp?.status_code && data.base_resp.status_code !== 0) {
        parts.push(`[Error for ${image.label}]: ${data.base_resp.status_msg || `status_code ${data.base_resp.status_code}`}`)
        continue
      }
      parts.push(data?.content || 'No description returned.')
    } catch (error) {
      parts.push(`[Error for ${image.label}]: ${truncate(error?.message || String(error))}`)
    }
  }
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
  const limited = paths.slice(0, config.maxBatch)
  const { images, errors } = await loadImages(limited, config, signal)
  if (images.length === 0) {
    const reasons = errors.length > 0 ? `\n  ${errors.join('\n  ')}` : ''
    return `Error: none of the specified images could be read.${reasons}`
  }
  const result = config.apiType === 'minimax'
    ? await callMiniMax(config, images, question)
    : await callOpenAI(config, images, question)
  if (errors.length === 0) return result
  return `${result}\n\n[Could not read ${errors.length} input(s):]\n  ${errors.join('\n  ')}`
}
