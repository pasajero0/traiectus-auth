import type { FastifyReply } from 'fastify'

/** What a spent counter looks like when it was checked by hand rather than by the plugin. */
type Spent = { ttlInSeconds?: number }

/**
 * The plugin writes `retry-after` on the limits it enforces itself; a limit checked inside
 * a handler has to say the same thing, or a caller cannot tell how long to wait.
 */
export function tooMany(reply: FastifyReply, spent: Spent): FastifyReply {
  if (typeof spent.ttlInSeconds === 'number') {
    reply.header('retry-after', String(Math.max(1, spent.ttlInSeconds)))
  }
  return reply.code(429).send({ error: 'too_many_requests' })
}
