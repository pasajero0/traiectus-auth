/**
 * The shared vocabulary. Schemas live here and types are derived from them, so
 * the validator and the type cannot drift apart.
 *
 * Two families:
 *   - the identity protocol: credentials, authorization codes, token responses,
 *     error shapes. sso-api validates with them; auth-client is typed by them.
 *   - each product's API: what harbor-api returns, what beacon-api returns —
 *     so a web client and a mobile client cannot disagree about the shape.
 *
 * Filled in from day 2 onward.
 */

export const HEALTH_PATH = '/health'
