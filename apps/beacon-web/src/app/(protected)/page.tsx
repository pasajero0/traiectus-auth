import { headers } from 'next/headers'

import { env } from '@/server/env'

type Message = { id: string; subject: string }

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

  const response = await fetch(new URL('/v1/messages', env().BEACON_API_URL), {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  })

  const body = (await response.json()) as { messages?: Message[] }

  return (
    <main>
      <p className="eyebrow">Beacon</p>
      <h1>Inbox</h1>
      <p className="status">
        {response.ok
          ? `Signed in. ${body.messages?.length ?? 0} messages.`
          : 'beacon-api did not answer.'}
      </p>
      <form method="post" action="/api/auth/logout">
        <button type="submit">Sign out</button>
      </form>
    </main>
  )
}
