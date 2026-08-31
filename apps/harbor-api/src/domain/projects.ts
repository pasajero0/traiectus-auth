/**
 * What this product does. No HTTP, no framework, no request object — so a server
 * component and a mobile client reach exactly the same code. See ADR-0005.
 *
 * The data is deliberately trivial and held in memory: products have no database
 * of their own, only the identity service does. What is being demonstrated here
 * is that a bearer token issued by sso-api is verified by a service that is not
 * sso-api — the payload behind it is beside the point.
 */

export type Project = {
  id: string
  title: string
}

export function listProjects(_userId: string): Project[] {
  return []
}
