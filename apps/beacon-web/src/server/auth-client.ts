import 'server-only'

import type { AuthClientConfig } from '@traiectus/auth-client/server'

import { env } from './env'

/** The one place this application's SDK configuration is assembled. */
export function authClientConfig(): AuthClientConfig {
  const e = env()

  return {
    ssoWebUrl: e.SSO_WEB_URL,
    ssoApiUrl: e.SSO_API_URL,
    clientId: e.TRAIECTUS_CLIENT_ID,
    clientSecret: e.TRAIECTUS_CLIENT_SECRET,
    redirectUri: new URL('/api/auth/callback', e.APP_BASE_URL).toString(),
    sealKey: e.SESSION_SEAL_KEY,
  }
}
