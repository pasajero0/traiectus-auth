import { randomUUID } from 'node:crypto'

import { importJWK, SignJWT, type JWK } from 'jose'

import { ACCESS_TOKEN_SECONDS } from './lifetimes'

/** Verified by a product's own API against a public key, never by calling back — ADR-0001. */
export async function signAccessToken(
  privateKeyJwk: string,
  claims: { issuer: string; userId: string; clientId: string },
): Promise<{ token: string; expiresIn: number }> {
  const key = await importJWK(parseKey(privateKeyJwk), 'EdDSA')

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setIssuer(claims.issuer)
    .setSubject(claims.userId)
    .setAudience(claims.clientId)
    .setIssuedAt()
    // Without it two tokens minted in the same second are byte-identical. RFC 9068.
    .setJti(randomUUID())
    .setExpirationTime(`${ACCESS_TOKEN_SECONDS}s`)
    .sign(key)

  return { token, expiresIn: ACCESS_TOKEN_SECONDS }
}

function parseKey(configured: string): JWK {
  try {
    return JSON.parse(configured) as JWK
  } catch {
    throw new Error('ACCESS_TOKEN_PRIVATE_KEY is not a one-line JWK')
  }
}

/** Named here so a missing key fails by name rather than three frames into jose. */
export function requireSigningKey(configured: string | undefined): string {
  if (!configured) {
    throw new Error('issuing an access token needs ACCESS_TOKEN_PRIVATE_KEY, which is unset')
  }
  return configured
}

export function requireIssuer(configured: string | undefined): string {
  if (!configured) throw new Error('issuing an access token needs ISSUER, which is unset')
  return configured
}
