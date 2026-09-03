import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resetClients } from '../clients'
import { loadEnv } from '../env'
import { resetRouteTable } from '../routing'
import { buildServer } from '../server'
import { createDatabase } from '../db/client'

const INTERNAL_KEY = 'test-internal-key'
const withKey = { 'x-traiectus-internal-key': INTERNAL_KEY }

let teardown: () => Promise<unknown> = async () => undefined

async function assemble(clientsJson: string) {
  const env = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    INTERNAL_API_KEY: INTERNAL_KEY,
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    CLIENTS: clientsJson,
  } as NodeJS.ProcessEnv)
  const { db, close } = createDatabase(env)
  const app = await buildServer(env, db)
  await app.ready()
  teardown = async () => {
    await app.close()
    await close()
  }
  return app
}

beforeEach(() => {
  resetRouteTable()
  resetClients()
})

afterEach(async () => {
  await teardown()
})

describe('GET /v1/clients', () => {
  it('refuses a caller without the internal key', async () => {
    const app = await assemble(
      JSON.stringify([
        { id: 'harbor', secret: 'x'.repeat(32), redirectUris: ['https://h.example/cb'], name: 'Harbor', homeUrl: 'https://h.example' },
      ]),
    )

    const response = await app.inject({ method: 'GET', url: '/v1/clients' })

    expect(response.statusCode).toBe(401)
  })

  it('lists id, name and homeUrl — never the secret or redirectUris', async () => {
    const app = await assemble(
      JSON.stringify([
        {
          id: 'harbor',
          secret: 'a-very-secret-value-nobody-should-see',
          redirectUris: ['https://h.example/api/auth/callback'],
          name: 'Harbor',
          homeUrl: 'https://h.example',
        },
      ]),
    )

    const response = await app.inject({ method: 'GET', url: '/v1/clients', headers: withKey })
    const body = response.json()

    expect(response.statusCode).toBe(200)
    expect(body).toEqual({ clients: [{ id: 'harbor', name: 'Harbor', homeUrl: 'https://h.example' }] })
    expect(JSON.stringify(body)).not.toContain('secret')
    expect(JSON.stringify(body)).not.toContain('callback')
  })
})
