import { headers } from 'next/headers'

import { env } from '@/server/env'

import { HarborArt } from './HarborArt'

/**
 * The token behind this render is already fresh: middleware.ts refreshed it before this
 * page ever ran, so this reaches harbor-api directly with no rotation logic of its own.
 */
export default async function DashboardPage() {
  const store = await headers()
  const token = store.get('x-harbor-access-token')

  // middleware.ts is what gates this route; a missing token here means it did not run —
  // a misconfiguration, not a normal state — so this says so rather than claiming success.
  if (!token) {
    return (
      <main>
        <p className="eyebrow">Harbor</p>
        <h1>Dashboard</h1>
        <p className="status">No access token reached this page. middleware.ts did not run.</p>
      </main>
    )
  }

  // The body goes unread on purpose: that harbor-api answers at all is the proof.
  const response = await fetch(new URL('/v1/projects', env().HARBOR_API_URL), {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  })

  return (
    <main>
      <p className="eyebrow">Harbor</p>
      <h1>Welcome aboard</h1>
      <p className="lede">Signed in through traiectus.</p>

      <HarborArt />

      <p className="status">{response.ok ? 'harbor-api response ok' : 'harbor-api did not answer'}</p>

      <form method="post" action="/api/auth/logout">
        <button type="submit">Sign out</button>
      </form>
    </main>
  )
}
