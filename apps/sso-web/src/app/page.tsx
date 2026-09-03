import { readSessionCookie } from '@/server/session'
import { listClients, verifySession } from '@/server/sso-api'

/** The signed-in landing page — and the only home `traiectus_sso` can be revoked from. */
export default async function Home() {
  const token = await readSessionCookie()
  const session = token ? await verifySession(token) : { verified: false as const }

  if (!session.verified) {
    return (
      <main>
        <p className="eyebrow">traiectus &middot; identity</p>
        <h1>The crossing</h1>
        <p className="lede">Where an anonymous request becomes an identified session.</p>
        <p className="status">
          <a href="/login">Sign in</a>
        </p>
      </main>
    )
  }

  const { clients } = await listClients()

  return (
    <main>
      <p className="eyebrow">traiectus &middot; identity</p>
      <h1>Signed in</h1>
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
