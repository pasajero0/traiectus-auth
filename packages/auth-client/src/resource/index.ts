import { errors, importJWK, jwtVerify, type CryptoKey, type JWK } from 'jose'

/**
 * The resource-server half: what a product's API needs to protect its own data.
 *
 * A bearer token and nothing else. No browser calls a resource server — the page talks to
 * its own origin carrying one sealed cookie, and `<client>-web` unseals it and attaches the
 * bearer on the way out (ADR-0008). There is no cookie to read here.
 *
 * This is the file that makes a product a resource server rather than a front end: the
 * token is checked by someone other than the service that issued it, with no call back on
 * the request path. Plain Node — nothing from `next` or `react`, so a Fastify service or the
 * mobile client's own backend can use it unchanged. The guard enforces that.
 */

export type ResourceConfig = {
  /** The identity service's issuer identifier. Must equal the token's `iss`. */
  issuer: string
  /** This API's own client id. Must equal the token's `aud` — see `wrong_audience`. */
  audience: string
  /** The public half of the signing key, as a one-line JWK. */
  publicKey: string
}

export type Principal = {
  userId: string
  clientId: string
  expiresAt: Date
}

export type Verification =
  | { verified: true; principal: Principal }
  | { verified: false; reason: VerificationFailure }

export type VerificationFailure =
  | 'malformed'
  | 'algorithm'
  | 'signature'
  | 'expired'
  | 'wrong_audience'
  | 'wrong_issuer'

const keys = new Map<string, Promise<CryptoKey | Uint8Array>>()

/**
 * `aud` is not a formality. Every product's token is signed by the same key, so an API that
 * checks only the signature accepts the token of every other product in the system.
 */
export async function verifyAccessToken(
  config: ResourceConfig,
  token: string,
): Promise<Verification> {
  let key: CryptoKey | Uint8Array

  try {
    key = await keyFor(config.publicKey)
  } catch (error) {
    throw error instanceof Error ? error : new Error('the configured public key is unusable')
  }

  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: config.issuer,
      audience: config.audience,
      // Named, so a token announcing any other algorithm is refused before its signature is
      // examined. This is the whole of the algorithm-confusion defence.
      algorithms: ['EdDSA'],
    })

    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') {
      return { verified: false, reason: 'malformed' }
    }

    return {
      verified: true,
      principal: {
        userId: payload.sub,
        clientId: config.audience,
        expiresAt: new Date(payload.exp * 1000),
      },
    }
  } catch (error) {
    return { verified: false, reason: failureFor(error) }
  }
}

/** `Authorization: Bearer …`, and nothing else. */
export async function requirePrincipal(
  config: ResourceConfig,
  authorization: string | null | undefined,
): Promise<Verification> {
  if (!authorization?.startsWith('Bearer ')) return { verified: false, reason: 'malformed' }

  const token = authorization.slice('Bearer '.length).trim()
  if (!token) return { verified: false, reason: 'malformed' }

  return verifyAccessToken(config, token)
}

function failureFor(error: unknown): VerificationFailure {
  if (error instanceof errors.JWTExpired) return 'expired'
  if (error instanceof errors.JOSEAlgNotAllowed) return 'algorithm'
  if (error instanceof errors.JWSSignatureVerificationFailed) return 'signature'

  if (error instanceof errors.JWTClaimValidationFailed) {
    if (error.claim === 'aud') return 'wrong_audience'
    if (error.claim === 'iss') return 'wrong_issuer'
    return 'malformed'
  }

  return 'malformed'
}

function keyFor(publicKey: string): Promise<CryptoKey | Uint8Array> {
  const cached = keys.get(publicKey)
  if (cached) return cached

  const jwk = parse(publicKey)
  const imported = importJWK(jwk, 'EdDSA')
  keys.set(publicKey, imported)

  return imported
}

function parse(publicKey: string): JWK {
  let jwk: JWK

  try {
    jwk = JSON.parse(publicKey) as JWK
  } catch {
    throw new Error('the configured access-token public key is not a one-line JWK')
  }

  // A private key here would verify perfectly well, and would mean this API can mint the
  // tokens it is supposed to be checking. Refused rather than tolerated.
  if ('d' in jwk) {
    throw new Error('the configured access-token public key is a private key')
  }

  return jwk
}
