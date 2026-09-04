import { redirect } from 'next/navigation'

import { readSessionCookie } from '@/server/session'
import { listClients, verifySession } from '@/server/sso-api'

/** The signed-in landing page — and the only home `traiectus_sso` can be revoked from. */
export default async function Home() {
  const token = await readSessionCookie()
  const session = token ? await verifySession(token) : { verified: false as const }

  // Nothing for an anonymous visitor to do here but sign in — so this is /login, not a
  // page whose one link is /login.
  if (!session.verified) {
    redirect('/login')
  }

  const { clients } = await listClients()

  return (
    <main>
      <p className="eyebrow">traiectus &middot; identity</p>
      <h1>Signed in as {session.email}</h1>
      <p className="lede">Connected products, one session behind all of them.</p>

      <ul>
        {clients.map((client) => (
          <li key={client.id}>
            <a href={client.homeUrl}>{client.name}</a>
          </li>
        ))}
      </ul>

      <form method="post" action="/logout">
        <button type="submit">Sign out</button>
      </form>
    </main>
  )
}
