/**
 * The BFF half: what a web application's server needs to authenticate a person.
 *
 *   startSignIn()      build the redirect to the identity service
 *   completeSignIn()   exchange the authorization code, open the app's session
 *   refresh()          rotate the refresh token
 *   signOut()          revoke, then clear the cookie
 *
 * Runs only on a server, and only for cookie-bearing web clients. A mobile app
 * uses `/native` instead — it cannot hold an HttpOnly cookie.
 *
 * Day 6.
 */

export {}
