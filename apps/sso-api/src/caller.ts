import type { FastifyRequest } from 'fastify'

import type { Env } from './env'
import { presentsInternalKey } from './routing'

/** Set by sso-web, never by a browser: the internal channel is the only one it means anything on. */
export const CLIENT_IP_HEADER = 'x-traiectus-client-ip'

/** Longer than any address; a key is a label, and an unbounded one is a way to spend memory. */
const MAX_LENGTH = 45

/**
 * Who is asking, for the purpose of counting them — ADR-0023.
 *
 * sso-web reaches this service server-to-server, so `request.ip` is sso-web's own address
 * on every browser-driven request: one bucket for the entire internet, which is what
 * ADR-0021 had to settle for. It now forwards the browser's address, and this reads it
 * only from a caller that has proved it holds the internal key — unchecked, the header
 * would let anyone spend a stranger's quota by claiming to be them.
 */
export function callerAddress(env: Env, request: FastifyRequest): string {
  if (!presentsInternalKey(env, request)) return request.ip

  const forwarded = request.headers[CLIENT_IP_HEADER]
  if (typeof forwarded !== 'string') return request.ip

  const address = forwarded.trim()
  return address.length > 0 && address.length <= MAX_LENGTH ? address : request.ip
}

/**
 * What a counter answers.
 *
 * `isExceeded` is the field to read, and the plugin's `isAllowed` is not: it stays `false`
 * on every call, including the first one against an empty counter, so treating it as
 * permission refuses everything. Verified against the plugin rather than its typings.
 *
 * Optional because the plugin omits it on the branch that means "not subject to a limit",
 * which is exactly the branch that should pass.
 */
type Verdict = {
  isAllowed: boolean
  isExceeded?: boolean
  remaining?: number
  ttlInSeconds?: number
}

/**
 * Asking and spending need different fields, and mixing them costs one attempt either way.
 * A read that did not spend reports `remaining: 0` while `isExceeded` is still false — the
 * flag only rises on the spend that goes over — so a peek asks whether anything is left,
 * and a spend asks whether it went over.
 */
export const nothingLeft = (verdict: Verdict): boolean =>
  verdict.isExceeded === true || verdict.remaining === 0

export const wentOver = (verdict: Verdict): boolean => verdict.isExceeded === true

/**
 * The service-wide argon2id budget, created in `server.ts` and shared with every route
 * that hashes. Answers whether this request may spend one.
 */
export type HashBudget = (request: FastifyRequest) => Promise<Verdict>

/**
 * A counter that is read and spent separately, so that only failures count against it —
 * `{ increment: false }` asks without spending.
 */
export type FailureCounter = (
  request: FastifyRequest,
  options?: { increment?: boolean },
) => Promise<Verdict>
