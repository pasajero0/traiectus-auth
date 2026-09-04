import { headers } from 'next/headers'

import { env } from '@/server/env'

import { BeaconArt } from './BeaconArt'

/**
 * The token behind this render is already fresh: middleware.ts refreshed it before this
 * page ever ran, so this reaches beacon-api directly with no rotation logic of its own.
 */
export default async function InboxPage() {
  const store = await headers()
  const token = store.get('x-beacon-access-token')

  // middleware.ts is what gates this route; a missing token here means it did not run —
  // a misconfiguration, not a normal state — so this says so rather than claiming success.
  if (!token) {
    return (
      <main>
        <p className="eyebrow">Beacon</p>
        <h1>Inbox</h1>
        <p className="status">No access token reached this page. middleware.ts did not run.</p>
      </main>
    )
  }

  // The body goes unread on purpose: that beacon-api answers at all is the proof.
  const response = await fetch(new URL('/v1/messages', env().BEACON_API_URL), {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  })

  return (
    <main>
      <p className="eyebrow">Beacon</p>
      <h1>Welcome ashore</h1>
      <p className="lede">Signed in through traiectus.</p>

      <BeaconArt />

      <p className="status">{response.ok ? 'beacon-api response ok' : 'beacon-api did not answer'}</p>

      <form method="post" action="/api/auth/logout">
        <button type="submit">Sign out</button>
      </form>
    </main>
  )
}
