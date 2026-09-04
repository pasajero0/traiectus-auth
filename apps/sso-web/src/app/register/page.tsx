import { PasswordFields } from './PasswordFields'

const ERROR_MESSAGES: Record<string, string> = {
  mismatch: 'Those two passwords do not match.',
  // Honest by design, unlike login's uniform failure message — the backend already treats
  // a taken address as no secret worth hiding from its only caller.
  email_taken: 'An account with that email already exists.',
}

/** Server-rendered, same as `login/page.tsx` — only PasswordFields is a client island. */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; email?: string }>
}) {
  const { error, email } = await searchParams

  return (
    <main>
      <p className="eyebrow">traiectus</p>
      <h1>Create an account</h1>

      {error ? (
        <p className="error" role="alert">
          {ERROR_MESSAGES[error] ?? 'Something went wrong. Try again.'}
        </p>
      ) : null}

      <form method="post" action="/register/submit">
        <fieldset>
          <legend>Account</legend>
          <label htmlFor="email">Email</label>
          {/* Carried back by the submit route so a rejected attempt does not cost the
              address as well. The passwords are never carried anywhere. */}
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={email ?? ''}
            required
          />
        </fieldset>

        <fieldset>
          <legend>Password</legend>
          <PasswordFields />
        </fieldset>

        <button type="submit">Create account</button>
      </form>

      <p>
        <a href="/login">Already have an account? Sign in</a>
      </p>
    </main>
  )
}
