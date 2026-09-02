import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const IV_BYTES = 12
const TAG_BYTES = 16

/**
 * AES-256-GCM over the one column that makes a live token recoverable, for the ten seconds
 * ADR-0009 ③ allows. The key lives in the environment and never in the database, so a dump
 * on its own reveals nothing.
 */
export function sealSuccessor(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
}

/** Null on anything that does not authenticate: a wrong key, a truncated or edited row. */
export function openSuccessor(key: Buffer, sealed: string): string | null {
  try {
    const raw = Buffer.from(sealed, 'base64')
    if (raw.length <= IV_BYTES + TAG_BYTES) return null

    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES))
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))

    return Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}

/**
 * The configured key as bytes. Rotation cannot run without it, and saying so here means the
 * failure names the variable rather than surfacing as a cipher error three frames down.
 */
export function successorKey(configured: string | undefined): Buffer {
  if (!configured) {
    throw new Error('refresh rotation needs REFRESH_SUCCESSOR_ENCRYPTION_KEY, which is unset')
  }

  const key = Buffer.from(configured, 'base64')
  if (key.length !== 32) {
    throw new Error('REFRESH_SUCCESSOR_ENCRYPTION_KEY must decode to 32 bytes')
  }

  return key
}
