// Vision engine: OpenAI-compatible backend, one batched entry point. One POST
// {baseUrl}/chat/completions carries every image as an inline base64
// image_url part. Local/remote bodies capped at 25 MiB; URL fetches get a 30s
// timeout and must claim image/*. Remote bodies are inlined (no SSRF).

import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'

const URL_FETCH_TIMEOUT_MS = 30_000
const MAX_IMAGE_BYTES = 25 * 1024 * 1024

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
    if (buffer.length > MAX_IMAGE_BYTES) {
      return { ok: false, error: `image over the ${MAX_IMAGE_BYTES / 1024 / 1024}MB URL limit` }
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

async function loadFromFile(path) {
  const mime = EXT_MIME[extname(path).toLowerCase()]
  if (!mime) {
    return { ok: false, error: `unsupported image extension (supported: ${Object.keys(EXT_MIME).join(' ')})` }
  }
  try {
    const info = await stat(path)
    if (!info.isFile()) return { ok: false, error: 'not a regular file' }
    if (info.size > MAX_IMAGE_BYTES) {
      return { ok: false, error: `file is ${(info.size / 1024 / 1024).toFixed(1)}MB, over the ${(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0)}MB limit` }
    }
    const buffer = await readFile(path)
    return { ok: true, buffer, mediaType: mime }
  } catch (error) {
    return { ok: false, error: error?.code === 'ENOENT' ? 'no such file' : error?.message }
  }
}

async function loadImages(paths, signal) {
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
      loaded = await loadFromFile(source)
    }
    if (!loaded.ok) {
      errors.push(`[${label}]: ${loaded.error}`)
      continue
    }
    const dataUrl = `data:${loaded.mediaType};base64,${loaded.buffer.toString('base64')}`
    images.push({ dataUrl })
  }
  return { images, errors }
}

function defaultPrompt(count) {
  if (count <= 1) return 'Please describe this image in detail.'
  return `These are ${count} images. Describe each image in detail, labeling every description with its image number and file name (Image 1, Image 2, …).`
}

async function callOpenAI(config, images, question, signal) {
  const apiUrl = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const content = [{ type: 'text', text: question || defaultPrompt(images.length) }]
  for (const image of images) {
    content.push({ type: 'image_url', image_url: { url: image.dataUrl } })
  }
  const headers = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  let response
  try {
    response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content }], max_tokens: config.maxTokens }),
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

export async function analyzeImages(config, paths, question, signal) {
  const { images, errors } = await loadImages(paths, signal)
  if (images.length === 0) {
    const reasons = errors.length > 0 ? `\n  ${errors.join('\n  ')}` : ''
    return `Error: none of the specified images could be read.${reasons}`
  }
  const result = await callOpenAI(config, images, question, signal)
  if (errors.length === 0) return result
  return `${result}\n\n[Could not read ${errors.length} input(s):]\n  ${errors.join('\n  ')}`
}
