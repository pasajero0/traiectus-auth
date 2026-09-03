import { clients } from '../clients'
import type { Env } from '../env'
import { internalRouter } from '../routing'

/** What sso-web's own dashboard lists — id, name, homeUrl. Never a secret. */
export function clientRoutes(env: Env) {
  return internalRouter(env).get('/v1/clients', async (_request, reply) =>
    reply.code(200).send({
      clients: clients(env).map(({ id, name, homeUrl }) => ({ id, name, homeUrl })),
    }),
  ).plugin
}
