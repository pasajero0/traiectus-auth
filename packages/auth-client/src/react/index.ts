/**
 * Hooks for a web client: who is signed in, and the calls that keep that answer
 * fresh. There is deliberately no access-token hook — no token reaches the
 * browser at all. `<client>-web`'s server holds both and attaches the bearer
 * itself, so everything here talks to the application's own origin carrying
 * nothing but an HttpOnly cookie.
 *
 * See docs/decisions/0008-no-token-reaches-the-browser.md.
 *
 * Day 6.
 */

export {}
