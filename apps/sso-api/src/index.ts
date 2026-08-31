import { loadEnv } from './env'
import { buildServer } from './server'

const env = loadEnv()
const app = await buildServer(env)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down')
    void app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    )
  })
}

try {
  await app.listen({ host: env.HOST, port: env.PORT })
} catch (error) {
  app.log.error(error, 'failed to start')
  process.exit(1)
}
