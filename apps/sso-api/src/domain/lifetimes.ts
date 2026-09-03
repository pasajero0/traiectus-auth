import { sql, type SQL } from 'drizzle-orm'

/**
 * Every lifetime this service decides, in one file. ADR-0001 states them as one set —
 * access five minutes, refresh fourteen days, SSO session seven days hard and twenty-four
 * hours sliding — and a set spread across modules is one that drifts apart.
 *
 * Each is an interval rather than a number, so the unit is bound to the value where it is
 * decided and no call site names a unit. Changing `days` to `hours` at a call site is a
 * mistake that can no longer be made, because there is no unit at the call site.
 *
 * They are intervals for Postgres rather than milliseconds for Node on purpose: every
 * timestamp in this service is the database's, and a lifetime computed here would put a
 * second clock in charge of a window the first one measures.
 */
const days = (count: number): SQL => sql`make_interval(days => ${count})`
const hours = (count: number): SQL => sql`make_interval(hours => ${count})`
const seconds = (count: number): SQL => sql`make_interval(secs => ${count})`

/** The SSO session, from creation, never extended. ADR-0001 ①. */
export const SSO_SESSION_HARD = days(7)

/** The SSO session, from last use. ADR-0001 ①. */
export const SSO_SESSION_IDLE = hours(24)

/** A refresh family, from the sign-in that opened it, never extended. ADR-0013. */
export const REFRESH_FAMILY = days(30)

/** One refresh token, capped by its family. ADR-0001. */
export const REFRESH_TOKEN = days(14)

/** How long a losing concurrent refresh may still claim the successor. ADR-0009 ②. */
export const REPLAY_WINDOW = seconds(10)

/** An authorization code, from issue to redemption. ADR-0001 ②. */
export const AUTHORIZATION_CODE = seconds(60)

/**
 * The access token, in seconds rather than an interval: it is signed and self-contained, so
 * its expiry is carried in the token and computed by whoever signs it, not by Postgres. The
 * exception is kept in this file so that no lifetime is decided anywhere else. ADR-0001.
 */
export const ACCESS_TOKEN_SECONDS = 300
