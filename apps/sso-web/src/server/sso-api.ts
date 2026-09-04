import 'server-only'

import {
  clientsResponseSchema,
  createSessionResponseSchema,
  issueCodeResponseSchema,
  registerResponseSchema,
  verifyCredentialsResponseSchema,
  verifySessionResponseSchema,
} from '@traiectus/contracts'

import { env } from './env'

/**
 * The only reader of the internal key, and the only caller of sso-api. Answers are parsed
 * rather than trusted: a shape that changed across the network should fail here.
 */
async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  const { SSO_API_URL, INTERNAL_API_KEY } = env()

  const response = await fetch(`${SSO_API_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-traiectus-internal-key': INTERNAL_API_KEY,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })

  // A failed password check is a 200 whose body says no, so anything else is a fault.
  if (!response.ok) throw new Error(`sso-api answered ${response.status} to ${method} ${path}`)

  return response.status === 204 ? null : await response.json()
}

export async function verifyCredentials(email: string, password: string) {
  return verifyCredentialsResponseSchema.parse(
    await call('POST', '/v1/credentials/verify', { email, password }),
  )
}

/**
 * Not built on `call()`: `/v1/users` answers a truthful `409` for a taken address (the
 * backend's own design — an internal API lying to its only caller buys nothing), and that
 * has to reach the caller as a real outcome, not the generic "sso-api answered a bad
 * status" fault `call()` throws for everything else.
 */
export async function registerUser(
  email: string,
  password: string,
): Promise<{ outcome: 'created'; userId: string } | { outcome: 'email_taken' }> {
  const { SSO_API_URL, INTERNAL_API_KEY } = env()

  const response = await fetch(`${SSO_API_URL}/v1/users`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-traiectus-internal-key': INTERNAL_API_KEY,
    },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  })

  if (response.status === 409) return { outcome: 'email_taken' }
  if (!response.ok) throw new Error(`sso-api answered ${response.status} to POST /v1/users`)

  const { id } = registerResponseSchema.parse(await response.json())
  return { outcome: 'created', userId: id }
}

export async function openSession(userId: string) {
  return createSessionResponseSchema.parse(await call('POST', '/v1/sessions', { userId }))
}

export async function verifySession(token: string) {
  return verifySessionResponseSchema.parse(await call('POST', '/v1/sessions/verify', { token }))
}

export async function issueCode(request: {
  sessionToken: string
  clientId: string
  redirectUri: string
  codeChallenge: string
}) {
  return issueCodeResponseSchema.parse(
    await call('POST', '/v1/authorization-codes', request),
  )
}

export async function revokeSession(token: string): Promise<void> {
  await call('DELETE', '/v1/sessions', { token })
}

export async function listClients() {
  return clientsResponseSchema.parse(await call('GET', '/v1/clients'))
}
