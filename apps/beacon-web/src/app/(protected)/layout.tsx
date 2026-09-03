import type { ReactNode } from 'react'

/**
 * The gate itself lives in middleware.ts — it is the only place that can both read the
 * session cookie and rewrite it after a rotation, since a Server Component cannot set one.
 */
export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
