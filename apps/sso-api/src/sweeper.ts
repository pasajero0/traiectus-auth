import type { Database } from './db/client'
import { sweepExpiredCodes } from './domain/authorization-code'
import { sweepRefreshRows } from './domain/refresh'
import { sweepExpiredSessions } from './domain/session'

const HOUR_MS = 60 * 60 * 1000

/**
 * Module state on purpose — ADR-0015's throttle is process-wide, not per request. Starts an
 * hour out rather than at epoch: "at most once an hour" bounds the ceiling, not a promise to
 * fire on the very first request, and a fresh process — including every test file that
 * assembles a server without a real database, relying on postgres-js connecting lazily —
 * must not have its first response reach for a connection nobody asked for.
 */
let nextEligibleAt = Date.now() + HOUR_MS

/** Test-only: each test assembles its own server, and this gate must not remember the last one. */
export function resetSweepGate(): void {
  nextEligibleAt = 0
}

type Logger = { error(payload: Record<string, unknown>, message: string): void }

/**
 * ADR-0015: a lazy in-process sweeper, started by an ordinary request but not awaited by
 * it, at most once an hour. The gate advances before the sweep runs rather than after it
 * succeeds, so a failure is retried on the next hour rather than on the next request.
 * Returns the sweep's promise — unused by the caller that starts it, but there for a test
 * that wants to await the one it triggered on purpose.
 */
export function maybeSweep(db: Database, log: Logger): Promise<void> | undefined {
  const now = Date.now()
  if (now < nextEligibleAt) return undefined
  nextEligibleAt = now + HOUR_MS

  return sweepAll(db).catch((error: unknown) => {
    log.error({ err: error }, 'a sweep failed; the next one is not due for another hour')
  })
}

export async function sweepAll(db: Database): Promise<void> {
  await sweepExpiredSessions(db)
  await sweepRefreshRows(db)
  await sweepExpiredCodes(db)
}
