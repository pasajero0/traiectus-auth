import { randomBytes } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { resetRouteTable } from '../routing'
import { buildServer } from '../server'
import { testDatabase, testEnv, truncateAll } from '../test/database'

const { db, close } = testDatabase()
const KEY = 'test-internal-key'
const PASSWORD = 'correct horse battery staple'

let app: Awaited<ReturnType<typeof buildServer>>

const register = (email: string) =>
  app.inject({
    method: 'POST',
    url: '/v1/users',
    headers: { 'x-traiectus-internal-key': KEY },
    payload: { email, password: PASSWORD },
  })

/** Each attempt arrives from a different address, the way a distributed attack would. */
const attempt = (email: string, password: string, address: string) =>
  app.inject({
    method: 'POST',
    url: '/v1/credentials/verify',
    headers: { 'x-traiectus-internal-key': KEY, 'x-traiectus-client-ip': address },
    payload: { email, password },
  })

const fresh = () => `signin-${randomBytes(6).toString('hex')}@example.com`

beforeEach(async () => {
  resetRouteTable()
  await truncateAll(db)
  app = await buildServer(testEnv(), db)
  await app.ready()
})

afterAll(async () => {
  await close()
})

/**
 * The counter OWASP calls primary and NIST SP 800-63B requires: failures against one
 * account, however many addresses they arrive from. Reaching a *failed* check needs a real
 * password to compare against, which is why this cannot live beside the address-limit
 * tests in `credentials.test.ts`.
 */
describe('the account limit on /v1/credentials/verify', () => {
  const CAP = 20

  it('stops guessing at one account however many addresses it comes from', async () => {
    const email = fresh()
    await register(email)

    for (let i = 0; i < CAP; i += 1) {
      const response = await attempt(email, 'wrong password', `203.0.113.${i}`)
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ verified: false })
    }

    // A twenty-first address buys nothing: the account is what is counted.
    const blocked = await attempt(email, 'wrong password', '198.51.100.7')

    expect(blocked.statusCode).toBe(429)
    expect(blocked.headers['retry-after']).toBeDefined()
  })

  /** One account's spent budget must not answer for another's. */
  it('leaves a different account untouched', async () => {
    const attacked = fresh()
    const bystander = fresh()
    await register(attacked)
    await register(bystander)

    for (let i = 0; i < CAP + 1; i += 1) await attempt(attacked, 'wrong password', `203.0.113.${i}`)

    const response = await attempt(bystander, PASSWORD, '203.0.113.1')

    expect(response.statusCode).toBe(200)
    expect(response.json().verified).toBe(true)
  })

  /**
   * Failures only — OWASP warns that a counter which also counts successes is a way to
   * lock someone out of their own account by guessing at it.
   */
  it('never spends the budget on someone who keeps getting it right', async () => {
    const email = fresh()
    await register(email)

    for (let i = 0; i < CAP + 5; i += 1) {
      const response = await attempt(email, PASSWORD, '203.0.113.1')
      expect(response.statusCode).toBe(200)
      expect(response.json().verified).toBe(true)
    }
  })
})
