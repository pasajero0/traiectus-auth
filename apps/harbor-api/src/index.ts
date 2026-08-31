import { serve } from '@hono/node-server'

import { buildApp } from './app'
import { loadEnv } from './env'

const env = loadEnv()

serve({ fetch: buildApp(env).fetch, port: env.PORT }, ({ port }) => {
  console.warn(`harbor-api listening on ${port}`)
})
