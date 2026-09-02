import { timingSafeEqual } from 'node:crypto'

import type {
  FastifyInstance,
  FastifyPluginAsync,
  preHandlerAsyncHookHandler,
  RouteHandlerMethod,
} from 'fastify'

import type { Env } from './env'

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

export type Audience = 'public' | 'internal'

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
function requireInternalKey(env: Env): preHandlerAsyncHookHandler {
  const expected = Buffer.from(env.INTERNAL_API_KEY, 'utf8')

  return async function verify(request, reply): Promise<void> {
    const presented = request.headers['x-traiectus-internal-key']
    const given = typeof presented === 'string' ? Buffer.from(presented, 'utf8') : null

    // timingSafeEqual throws on a length mismatch, so length is checked first.
    // The length of a rejected key is not a secret worth protecting.
    const ok =
      given !== null && given.length === expected.length && timingSafeEqual(given, expected)

    if (!ok) await reply.code(401).send(unauthorized)
  }
}

export interface AudienceRouter {
  get(url: string, handler: RouteHandlerMethod): AudienceRouter
  post(url: string, handler: RouteHandlerMethod): AudienceRouter
  put(url: string, handler: RouteHandlerMethod): AudienceRouter
  patch(url: string, handler: RouteHandlerMethod): AudienceRouter
  delete(url: string, handler: RouteHandlerMethod): AudienceRouter
  readonly plugin: FastifyPluginAsync
}

function router(audience: Audience, guard: preHandlerAsyncHookHandler | null): AudienceRouter {
  const routes: Array<{ method: DeclaredRoute['method']; url: string; handler: RouteHandlerMethod }> =
    []

  const add = (method: DeclaredRoute['method']) => (url: string, handler: RouteHandlerMethod) => {
    declared.push({ method, url, audience })
    routes.push({ method, url, handler })
    return api
  }

  const api: AudienceRouter = {
    get: add('GET'),
    post: add('POST'),
    put: add('PUT'),
    patch: add('PATCH'),
    delete: add('DELETE'),
    plugin: async (app) => {
      for (const { method, url, handler } of routes) {
        app.route({
          method,
          url,
          ...(guard ? { preHandler: guard } : {}),
          handler,
        })
      }
    },
  }

  return api
}

/** Unauthenticated, and said out loud. The only way to serve an open request. */
export const publicRouter = (): AudienceRouter => router('public', null)

/** Reachable only by sso-web, over the internal shared secret. */
export const internalRouter = (env: Env): AudienceRouter =>
  router('internal', requireInternalKey(env))
