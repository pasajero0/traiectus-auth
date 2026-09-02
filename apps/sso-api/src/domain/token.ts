import { createHash, randomBytes } from 'node:crypto'

/**
 * Bearer strings, and the one place their shape is decided — ADR-0014. The set is closed:
 * a prefix cannot be changed without invalidating every live token of that kind.
 */
export const TOKEN_PREFIXES = {
  session: 'trs_',
  refresh: 'trr_',
  code: 'trc_',
} as const

export type TokenKind = keyof typeof TOKEN_PREFIXES

/** 256 bits from node:crypto. Base64url, so a cookie or a query string carries it unencoded. */
export function mintToken(kind: TokenKind): string {
  return `${TOKEN_PREFIXES[kind]}${randomBytes(32).toString('base64url')}`
}

/** The whole string, prefix included, so two kinds cannot collide even in principle. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

const BODY = /^[A-Za-z0-9_-]{43}$/

/**
 * Checked before any lookup, so a token of the wrong kind never reaches the database and
 * never gets counted as a miss. The separation is mechanical, not procedural.
 */
export function isTokenOfKind(token: string, kind: TokenKind): boolean {
  const prefix = TOKEN_PREFIXES[kind]
  return token.startsWith(prefix) && BODY.test(token.slice(prefix.length))
}
