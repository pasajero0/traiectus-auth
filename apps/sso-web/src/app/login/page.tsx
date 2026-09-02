/** Server-rendered on the origin that owns the cookie — ADR-0004, ADR-0010. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const { error, next } = await searchParams

  return (
    <main>
      <p className="eyebrow">traiectus</p>
      <h1>Sign in</h1>

      {error ? (
        // One message for every failure: whether the address exists is not this page's to say.
        <p className="error" role="alert">
          That email and password do not match an account.
        </p>
      ) : null}

      <form method="post" action="/login/submit">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />

        {next ? <input type="hidden" name="next" value={next} /> : null}

        <button type="submit">Sign in</button>
      </form>
    </main>
  )
}
