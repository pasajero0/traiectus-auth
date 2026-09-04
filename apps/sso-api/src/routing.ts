import { timingSafeEqual } from 'node:crypto'

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerAsyncHookHandler,
  RouteHandlerMethod,
} from 'fastify'

import { findClient, presentsSecret, type Client } from './clients'
import type { Env } from './env'

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `clientRouter` and by nothing else. Absent on every other audience. */
    client?: Client
  }
}

/**
 * A route cannot be registered without naming its audience — see ADR-0007.
 *
 * The dangerous failure is not a weak check but an absent one: a handler that
 * forgot its check is indistinguishable from one that never needed it, and review
 * confirms what is present while staying blind to what is missing. Here the choice
 * of audience is the same line that creates the route, so it cannot be skipped —
 * only made wrongly, which is a mistake review can see.
 *
 * `routing.test.ts` walks the assembled application and fails on any path that did
 * not arrive through one of these constructors, which is what covers the routes
 * nobody has written yet.
 */

export type Audience = 'public' | 'internal' | 'client'

export type DeclaredRoute = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  audience: Audience
}

/**
 * Routes are declared when their module is imported, so this registry is
 * module-level of necessity. `resetRouteTable()` exists for tests that assemble
 * the application more than once.
 */
const declared: DeclaredRoute[] = []
const registered: Array<{ method: string; url: string }> = []

export const declaredRoutes = (): readonly DeclaredRoute[] => declared
export const registeredRoutes = (): ReadonlyArray<{ method: string; url: string }> =>
  registered

export function resetRouteTable(): void {
  declared.length = 0
  registered.length = 0
}

/**
 * Records what Fastify actually mounted, which is the ground truth the test
 * compares against. Installed once, before any route is registered.
 */
export function recordRoutes(app: FastifyInstance): void {
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method]
    for (const method of methods) registered.push({ method, url: route.url })
  })
}

const unauthorized = { error: 'unauthorized' } as const

/**
 * The shared secret `sso-web` presents. Compared in constant time: a plain `===`
 * returns as soon as two bytes differ, which tells a patient caller how much of a
 * guess was right. A missing key and a wrong one are answered identically.
 */
/**
 * Exported because a rate limit has to answer the same question before this guard runs —
 * `keyGenerator` fires on `onRequest`, ahead of every `preHandler` — and a rule written
 * twice is a rule that will one day disagree with itself. ADR-0023.
 */
export function presentsInternalKey(env: Env, request: FastifyRequest): boolean {
  const expected = Buffer.from(env.INTERNAL_API_KEY, 'utf8')
  const presented = request.headers['x-traiectus-internal-key']
  const given = typeof presented === 'string' ? Buffer.from(presented, 'utf8') : null

  // timingSafeEqual throws on a length mismatch, so length is checked first.
  // The length of a rejected key is not a secret worth protecting.
  return given !== null && given.length === expected.length && timingSafeEqual(given, expected)
}

function requireInternalKey(env: Env): preHandlerAsyncHookHandler {
  return async function verify(request, reply): Promise<void> {
    if (!presentsInternalKey(env, request)) await reply.code(401).send(unauthorized)
  }
}

/** Anything a route wants attached that is not the audience's own concern — e.g. a
 * plugin-specific `config`, read by that plugin alone. */
export type RouteOptions = { config?: Record<string, unknown> }

export interface AudienceRouter {
  get(url: string, handler: RouteHandlerMethod, options?: RouteOptions): AudienceRouter
  post(url: string, handler: RouteHandlerMethod, options?: RouteOptions): AudienceRouter
  put(url: string, handler: RouteHandlerMethod, options?: RouteOptions): AudienceRouter
  patch(url: string, handler: RouteHandlerMethod, options?: RouteOptions): AudienceRouter
  delete(url: string, handler: RouteHandlerMethod, options?: RouteOptions): AudienceRouter
  readonly plugin: FastifyPluginAsync
}

function router(audience: Audience, guard: preHandlerAsyncHookHandler | null): AudienceRouter {
  const routes: Array<{
    method: DeclaredRoute['method']
    url: string
    handler: RouteHandlerMethod
    options?: RouteOptions
  }> = []

  const add =
    (method: DeclaredRoute['method']) =>
    (url: string, handler: RouteHandlerMethod, options?: RouteOptions) => {
      declared.push({ method, url, audience })
      routes.push({ method, url, handler, options })
      return api
    }

  const api: AudienceRouter = {
    get: add('GET'),
    post: add('POST'),
    put: add('PUT'),
    patch: add('PATCH'),
    delete: add('DELETE'),
    plugin: async (app) => {
      for (const { method, url, handler, options } of routes) {
        app.route({
          method,
          url,
          ...(guard ? { preHandler: guard } : {}),
          ...(options?.config ? { config: options.config } : {}),
          handler,
        })
      }
    },
  }

  return api
}

/**
 * The client's own credentials, over HTTP Basic as RFC 6749 asks. A client id is not a
 * secret — it travels in redirect URLs — so no effort is spent hiding which ids exist; the
 * secret itself is compared in constant time.
 */
function requireClientCredentials(env: Env): preHandlerAsyncHookHandler {
  return async function authenticate(request, reply): Promise<void> {
    const client = fromBasic(env, request.headers.authorization)

    if (!client) {
      await reply
        .code(401)
        .header('www-authenticate', 'Basic realm="traiectus"')
        .send(unauthorized)
      return
    }

    request.client = client
  }
}

function fromBasic(env: Env, header: string | undefined): Client | null {
  if (!header?.startsWith('Basic ')) return null

  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8')
  const separator = decoded.indexOf(':')
  if (separator < 0) return null

  const client = findClient(env, decoded.slice(0, separator))
  if (!client) return null

  return presentsSecret(client, decoded.slice(separator + 1)) ? client : null
}

/** Unauthenticated, and said out loud. The only way to serve an open request. */
export const publicRouter = (): AudienceRouter => router('public', null)

/** Reachable only by sso-web, over the internal shared secret. */
export const internalRouter = (env: Env): AudienceRouter =>
  router('internal', requireInternalKey(env))

/** Reachable by a registered client's own server, over its client credentials. */
export const clientRouter = (env: Env): AudienceRouter =>
  router('client', requireClientCredentials(env))
