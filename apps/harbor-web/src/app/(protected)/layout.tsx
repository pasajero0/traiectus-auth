import type { ReactNode } from 'react'

/**
 * The gate. No session → redirect to the identity service, come back signed in.
 * Day 6.
 */
export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
