import { issueCodeRequestSchema } from '@traiectus/contracts'

import { allowsRedirect, findClient } from '../clients'
import type { Database } from '../db/client'
import { issueCode } from '../domain/authorization-code'
import { verifySession } from '../domain/session'
import type { Env } from '../env'
import { internalRouter } from '../routing'

/**
 * Issuing a code — ADR-0001 ②, ADR-0018. The session is verified here rather than taken
 * from the body (ADR-0007), and verifying is also what slides its idle window.
 */
export function authorizationCodeRoutes(env: Env, db: Database) {
  return internalRouter(env).post('/v1/authorization-codes', async (request, reply) => {
    const parsed = issueCodeRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' })

    const { sessionToken, clientId, redirectUri, codeChallenge } = parsed.data

    try {
      const client = findClient(env, clientId)
      if (!client) return reply.code(200).send({ issued: false, reason: 'unknown_client' })

      if (!allowsRedirect(client, redirectUri)) {
        request.log.warn({ clientId }, 'redirect_uri outside the allowlist')
        return reply.code(200).send({ issued: false, reason: 'redirect_not_allowed' })
      }

      const session = await verifySession(db, sessionToken)
      if (!session) return reply.code(200).send({ issued: false, reason: 'no_session' })

      const issued = await issueCode(db, {
        clientId,
        redirectUri,
        userId: session.userId,
        ssoSessionId: session.id,
        codeChallenge,
      })

      return reply.code(200).send({
        issued: true,
        code: issued.code,
        expiresAt: issued.expiresAt.toISOString(),
      })
    } catch (error) {
      request.log.error({ err: error }, 'failed to issue an authorization code')
      return reply.code(500).send({ error: 'internal_error' })
    }
  }).plugin
}
