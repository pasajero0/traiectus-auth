/**
 * The resource-server half: what a product's API needs to protect its own data.
 *
 *   verifyAccessToken()  check the signature locally against a public key
 *   requirePrincipal()   a bearer token → Principal
 *
 * A bearer token and nothing else. No browser calls a resource server: the page
 * talks to its own origin carrying one sealed cookie, and `<client>-web` unseals
 * it and attaches the bearer on the way out (ADR-0008). So there is no cookie to
 * read here, and an inbound Authorization header from a browser never arrives.
 *
 * This is the file that makes a product a resource server rather than a front
 * end: the token is verified by someone other than the service that issued it,
 * with no call back to the identity service on the request path.
 *
 * It must stay portable — plain Node, no framework, nothing from `next` or
 * `react`. harbor-api uses it today; a Fastify service or the mobile client's
 * own backend must be able to use it unchanged tomorrow. `scripts/check-boundaries.mjs`
 * enforces that.
 *
 * Day 6.
 */

export {}
