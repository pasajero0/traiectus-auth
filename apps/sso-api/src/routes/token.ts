import { tokenRequestSchema } from '@traiectus/contracts'

import type { Database } from '../db/client'
import { requireIssuer, requireSigningKey, signAccessToken } from '../domain/access-token'
import { redeemCode } from '../domain/authorization-code'
import { openFamily, rotateRefreshToken } from '../domain/refresh'
import { successorKey } from '../domain/successor-cipher'
import type { Env } from '../env'
import { clientRouter } from '../routing'

/** RFC 6749's error codes, not ours: a stranger's client reads the RFC, not this file. */
const invalidGrant = { error: 'invalid_grant' } as const
const invalidRequest = { error: 'invalid_request' } as const

/**
 * The exchange, and the only route a client's server calls. The body is the form encoding
 * RFC 6749 §4.1.3 asks for; JSON also parses, because Fastify does that on its own.
 */
export function tokenRoutes(env: Env, db: Database) {
  return clientRouter(env).post('/v1/token', async (request, reply) => {
    // The router refuses before this runs, so a client is always present here.
    const client = request.client!

    const parsed = tokenRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(invalidRequest)

    try {
      const issuer = requireIssuer(env.ISSUER)
      const signingKey = requireSigningKey(env.ACCESS_TOKEN_PRIVATE_KEY)

      if (parsed.data.grant_type === 'authorization_code') {
        const redeemed = await redeemCode(db, {
          code: parsed.data.code,
          clientId: client.id,
          redirectUri: parsed.data.redirect_uri,
          codeVerifier: parsed.data.code_verifier,
        })

        if (!redeemed.redeemed) {
          // A second presentation is an attack, not a retry — ADR-0001 ②.
          if (redeemed.reason === 'replayed') {
            request.log.warn(
              { event: 'authorization_code_replayed', clientId: client.id },
              'an authorization code was presented twice',
            )
          }
          return reply.code(400).send(invalidGrant)
        }

        const family = await openFamily(db, { userId: redeemed.userId, clientId: client.id })
        const access = await signAccessToken(signingKey, {
          issuer,
          userId: redeemed.userId,
          clientId: client.id,
        })

        return reply.code(200).send({
          access_token: access.token,
          token_type: 'Bearer',
          expires_in: access.expiresIn,
          refresh_token: family.token,
        })
      }

      const rotated = await rotateRefreshToken(db, successorKey(env.REFRESH_SUCCESSOR_ENCRYPTION_KEY), {
        token: parsed.data.refresh_token,
        clientId: client.id,
      })

      if (rotated.outcome === 'reuse') {
        // A spent token is the only evidence of theft this design can get, so it is an
        // event and not just another 400. ADR-0009.
        request.log.warn(
          {
            event: 'refresh_reuse_detected',
            familyId: rotated.familyId,
            clientId: client.id,
            reason: rotated.reason,
            secondsSinceConsumed: rotated.secondsSinceConsumed,
          },
          'a refresh token was reused; the family is revoked',
        )
        return reply.code(400).send(invalidGrant)
      }

      if (rotated.outcome === 'refused') return reply.code(400).send(invalidGrant)

      const access = await signAccessToken(signingKey, {
        issuer,
        userId: rotated.userId,
        clientId: client.id,
      })

      return reply.code(200).send({
        access_token: access.token,
        token_type: 'Bearer',
        expires_in: access.expiresIn,
        refresh_token: rotated.token,
      })
    } catch (error) {
      request.log.error({ err: error }, 'failed to answer the token endpoint')
      return reply.code(500).send({ error: 'internal_error' })
    }
  }).plugin
}
