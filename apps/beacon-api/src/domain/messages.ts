/**
 * What this product does. No HTTP, no framework, no request object — so a server
 * component and a mobile client reach exactly the same code. See ADR-0005.
 *
 * Beacon is deliberately the thinner of the two products: it exists to prove that
 * a session established at Harbor is already good here, not to be a product.
 */

export type Message = {
  id: string
  subject: string
}

export function listMessages(_userId: string): Message[] {
  return []
}
