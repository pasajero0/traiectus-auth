import { z } from 'zod'

/**
 * The sealed cookie both tokens live in — ADR-0008. AES-256-GCM through Web Crypto rather
 * than `node:crypto`, so the SDK runs on any runtime a client's server might use, edge
 * included, and so this package needs no Node types at all.
 */
const VERSION = 't1'
const IV_BYTES = 12

export const sessionSchema = z.object({
  accessToken: z.string().min(1),
  /** Epoch milliseconds. Read before every proxied call, so refresh can happen early. */
  accessExpiresAt: z.number().int().positive(),
  refreshToken: z.string().min(1),
})

export type Session = z.infer<typeof sessionSchema>

export const transactionSchema = z.object({
  state: z.string().min(1),
  codeVerifier: z.string().min(1),
  /** Where in the application the person was going before they were sent to sign in. */
  returnTo: z.string().min(1),
  expiresAt: z.number().int().positive(),
})

export type Transaction = z.infer<typeof transactionSchema>

export async function seal(sealKey: string, payload: unknown): Promise<string> {
  const key = await importKey(sealKey)
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))

  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify(payload)),
    ),
  )

  const joined = new Uint8Array(iv.length + sealed.length)
  joined.set(iv)
  joined.set(sealed, iv.length)

  return `${VERSION}.${base64urlEncode(joined)}`
}

/** Null on anything that does not authenticate — a wrong key, an edited cookie, a new format. */
export async function open<T>(
  sealKey: string,
  envelope: string | undefined | null,
  schema: z.ZodType<T>,
): Promise<T | null> {
  if (!envelope?.startsWith(`${VERSION}.`)) return null

  try {
    const raw = base64urlDecode(envelope.slice(VERSION.length + 1))
    if (raw.length <= IV_BYTES) return null

    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: raw.subarray(0, IV_BYTES) },
      await importKey(sealKey),
      raw.subarray(IV_BYTES),
    )

    const parsed = schema.safeParse(JSON.parse(new TextDecoder().decode(plain)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function importKey(sealKey: string): Promise<CryptoKey> {
  const raw = base64urlDecode(sealKey.replaceAll('+', '-').replaceAll('/', '_'))

  if (raw.length !== 32) {
    throw new Error('the session seal key must decode to 32 bytes')
  }

  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

// Annotated over ArrayBuffer rather than ArrayBufferLike: Web Crypto will not take a view
// that might sit on a SharedArrayBuffer.
function base64urlDecode(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)

  return bytes
}
