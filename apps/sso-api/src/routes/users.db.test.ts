import { randomBytes } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { resetRouteTable } from '../routing'
import { buildServer } from '../server'
import { testDatabase, testEnv, truncateAll } from '../test/database'

const { db, close } = testDatabase()
const KEY = 'test-internal-key'

let app: Awaited<ReturnType<typeof buildServer>>

const register = (email: string, password = 'correct horse battery staple') =>
  app.inject({
    method: 'POST',
    url: '/v1/users',
    headers: { 'x-traiectus-internal-key': KEY },
    payload: { email, password },
  })

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
 * The 409 was found by hand in July and had no test until the database arrived. It is
 * matched on the constraint by name, so a rename has to fail loudly here rather than start
 * answering "taken" for some other collision.
 */
describe('POST /v1/users', () => {
  it('creates an account', async () => {
    const response = await register(`new-${randomBytes(4).toString('hex')}@example.com`)

    expect(response.statusCode).toBe(201)
    expect(response.json().id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('answers 409 to an address already registered', async () => {
    const email = `twice-${randomBytes(4).toString('hex')}@example.com`
    await register(email)

    const again = await register(email)

    expect(again.statusCode).toBe(409)
    expect(again.json()).toEqual({ error: 'email_taken' })
  })

  it('treats a differently-cased address as the same one', async () => {
    const email = `case-${randomBytes(4).toString('hex')}@example.com`
    await register(email)

    expect((await register(email.toUpperCase())).statusCode).toBe(409)
  })

  it('refuses a password shorter than twelve characters', async () => {
    const response = await register(`short-${randomBytes(4).toString('hex')}@example.com`, 'eleven-char')

    expect(response.statusCode).toBe(400)
  })
})
