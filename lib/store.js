// Image landing store: the dsh side-channel for pasted images.
//
// When the prompt-admission override (index.js) accepts a pasted image for a
// text-only model, the bytes land in /tmp/dsh-sight/image{N}/{hash}.{ext}
// and the image block is replaced by a hint text like:
//
//   [Image #3 auto-saved to /tmp/dsh-sight/image3/1a2b3c4d.png]
//
// The model then calls the `vision` tool with that path. Dedup is MD5 over
// the full bytes; global sequence numbers keep the first paste's number
// stable across a session. An LRU cap (config maxImages, env fallback)
// bounds disk use.

import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const TMP_DIR = join(tmpdir(), 'dsh-sight')

// OpenAI-compatible VLM endpoints and the store accept these formats.
export const MEDIA_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
}

const registry = new Map() // hash → seq
const reverseRegistry = new Map() // seq → hash
let nextSeq = 1
const lruQueue = []
let maxImages = Number(process.env['DSH_SIGHT_MAX_IMAGES'] || 200)

/** Update the LRU cap from the resolved config (apply-time injection). */
export function setMaxImages(value) {
  if (Number.isInteger(value) && value > 0) maxImages = value
}

export function hintForPath(filePath, seq) {
  return `[Image #${seq} auto-saved to ${filePath}]`
}

function touchLRU(seqDir) {
  const idx = lruQueue.indexOf(seqDir)
  if (idx !== -1) lruQueue.splice(idx, 1)
  lruQueue.push(seqDir)
  while (lruQueue.length > maxImages) {
    const oldest = lruQueue.shift()
    if (!oldest) break
    const match = oldest.match(/image(\d+)$/)
    if (match) {
      const seq = Number(match[1])
      const hash = reverseRegistry.get(seq)
      if (hash) {
        registry.delete(hash)
        reverseRegistry.delete(seq)
      }
    }
    try {
      rmSync(oldest, { recursive: true, force: true })
    } catch {}
  }
}

export function ensureTmpDir() {
  try {
    mkdirSync(TMP_DIR, { recursive: true })
  } catch {}
  sweepStale()
}

// In-session LRU eviction is write-triggered and only tracks this run's
// directories, so leftovers from earlier boots (crashes, ungraceful exits)
// would never be reclaimed. A boot-time sweep of image* dirs whose mtime is
// older than the max age (default 7 days) closes that gap; only the plugin's
// own image{N} directories are touched.
const DEFAULT_MAX_AGE_DAYS = 7

function sweepStale() {
  const maxAgeDays = Number(process.env['DSH_SIGHT_MAX_AGE_DAYS'] || DEFAULT_MAX_AGE_DAYS)
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) return
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  let entries
  try {
    entries = readdirSync(TMP_DIR, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^image\d+$/.test(entry.name)) continue
    const dir = join(TMP_DIR, entry.name)
    try {
      if (statSync(dir).mtimeMs < cutoff) {
        rmSync(dir, { recursive: true, force: true })
      }
    } catch {}
  }
}

/**
 * Save image bytes to the store. Returns { seq, filePath, hint } or null when
 * the media type is unsupported (caller degrades to an explanatory block).
 */
export function saveImage(data, mediaType) {
  const ext = MEDIA_EXT[mediaType]
  if (!ext || !data || data.length === 0) return null

  const hash = createHash('md5').update(data).digest('hex').slice(0, 16)

  let seq = registry.get(hash)
  if (!seq) {
    seq = nextSeq++
    registry.set(hash, seq)
    reverseRegistry.set(seq, hash)
  }

  const seqDir = join(TMP_DIR, `image${seq}`)
  const filePath = join(seqDir, `${hash}${ext}`)

  try {
    mkdirSync(seqDir, { recursive: true })
    writeFileSync(filePath, data, { flag: 'wx' })
  } catch (error) {
    // wx flag: EEXIST means the identical file is already on disk — fine.
    if (error?.code !== 'EEXIST') throw error
  }

  touchLRU(seqDir)
  return { seq, filePath, hint: hintForPath(filePath, seq) }
}
