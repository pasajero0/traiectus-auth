import { serve } from '@hono/node-server'

import { buildApp } from './app.js'
import { loadEnv } from './env.js'

const env = loadEnv()

serve({ fetch: buildApp(env).fetch, port: env.PORT }, ({ port }) => {
  console.warn(`harbor-api listening on ${port}`)
})
