# Routes

Three audiences, kept apart on purpose — ADR-0004 for why they are separated, ADR-0007 for
why a route cannot be registered without naming one.

Every route here exists. This is a state document, not a plan: what is scheduled lives in
the working plan, and what has been decided lives in an ADR. ADR-0012.

## Public — called by anyone

| Route | Caller |
|---|---|
| `GET /health` | the uptime pinger, and Render's own probe |

## Internal — called only by `sso-web`, over a shared secret

| Route | Purpose |
|---|---|
| `POST /v1/users` | register |
| `POST /v1/credentials/verify` | check a password |
| `POST /v1/sessions` | open an SSO session |
| `POST /v1/sessions/verify` | validate it and slide its idle window |
| `DELETE /v1/sessions` | revoke it |
| `POST /v1/authorization-codes` | issue a single-use code for a client |

## Client — called by a registered client's own server, over HTTP Basic

| Route | Purpose |
|---|---|
| `POST /v1/token` | exchange an authorization code, or rotate a refresh token |

A session identifier is a bearer secret, so it travels in the body and never in the
path: a path reaches `req.url`, and from there the Fastify and Render logs, where it
would outlive the session it names. Redaction covers headers, not the path. ADR-0008.

Nothing here renders HTML. The browser never reaches this service.

## Response codes

### POST /v1/users

Internal. Registers an account.

- **201 Created** — account created; body carries `{ id }`
- **400 Bad Request** — malformed body, or a password shorter than twelve characters
- **401 Unauthorized** — internal key missing or wrong
- **409 Conflict** — the address is already registered

### POST /v1/credentials/verify

Internal. Checks an email and password against the store.

- **200 OK** — the check ran; body says whether it passed
- **400 Bad Request** — malformed body
- **401 Unauthorized** — internal key missing or wrong

### POST /v1/sessions

Internal. Opens an SSO session for a user.

- **201 Created** — session opened; body carries `{ token, expiresAt }`
- **400 Bad Request** — malformed body
- **401 Unauthorized** — internal key missing or wrong

### POST /v1/sessions/verify

Internal. Checks a session token and slides its idle window.

- **200 OK** — the check ran; body says whether it passed
- **400 Bad Request** — malformed body
- **401 Unauthorized** — internal key missing or wrong

### DELETE /v1/sessions

Internal. Revokes a session. Idempotent — an unknown, expired or already revoked token is
answered the same as a live one.

- **204 No Content** — nothing more to say
- **400 Bad Request** — malformed body
- **401 Unauthorized** — internal key missing or wrong

### POST /v1/authorization-codes

Internal. Issues a single-use authorization code for a client.

- **200 OK** — the request was answered; body says whether a code was issued, and if not why
- **400 Bad Request** — malformed body
- **401 Unauthorized** — internal key missing or wrong

### POST /v1/token

Client. Exchanges an authorization code, or rotates a refresh token. The body is form
encoded, as RFC 6749 §4.1.3 specifies.

- **200 OK** — body carries `access_token`, `token_type`, `expires_in` and `refresh_token`
- **400 Bad Request** — `invalid_request` for a malformed body; `invalid_grant` for a code
  or token that is spent, expired, bound to something else, or in a revoked family
- **401 Unauthorized** — client credentials missing or wrong
