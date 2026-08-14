// Image landing store: the dsh side-channel for pasted images.
//
// When the vision provider wrapper (or another path) hands us pasted image
// bytes, they land in /tmp/dsh-vision/image{N}/{hash}.{ext} and the message
// block is replaced by a hint text like:
//
//   [Image #3 auto-saved to /tmp/dsh-vision/image3/1a2b3c4d.png]
//
// The model then calls the `vision` tool with that path. Dedup is MD5 over
// the full bytes; global sequence numbers keep the first paste's number
// stable across a session. An LRU cap (default 200 dirs) bounds disk use.

import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const TMP_DIR = join(tmpdir(), 'dsh-vision')

const MEDIA_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/heic': '.heic',
  'image/heif': '.heif',
}

const registry = new Map() // hash → seq
const reverseRegistry = new Map() // seq → hash
let nextSeq = 1
const lruQueue = []

export function hintForPath(filePath, seq) {
  return `[Image #${seq} auto-saved to ${filePath}]`
}

function touchLRU(seqDir) {
  const idx = lruQueue.indexOf(seqDir)
  if (idx !== -1) lruQueue.splice(idx, 1)
  lruQueue.push(seqDir)
  const maxImages = Number(process.env['DSH_VISION_MAX_IMAGES'] || 200)
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
