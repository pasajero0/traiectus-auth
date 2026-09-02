# Routes

Two audiences, kept apart on purpose (ADR-0004).

## Public — called by other machines

| Route | Caller | Day |
|---|---|---|
| `GET /health` | uptime pinger | 1 |
| `POST /v1/token` | a client's server, exchanging a code or rotating a refresh token | 5 |

## Internal — called only by `sso-web`, over a shared secret

| Route | Purpose | Day |
|---|---|---|
| `POST /v1/users` | register | 2 |
| `POST /v1/credentials/verify` | check a password, rate limited | 3 |
| `POST /v1/sessions` | open an SSO session | 3 |
| `POST /v1/sessions/verify` | validate and slide it | 3 |
| `DELETE /v1/sessions` | revoke it, and every refresh family with it | 8 |
| `POST /v1/authorization-codes` | issue a single-use code for a client | 5 |

A session identifier is a bearer secret, so it travels in the body and never in the
path: a path reaches `req.url`, and from there the Fastify and Render logs, where it
would outlive the session it names. Redaction covers headers, not the path. ADR-0008.

Nothing here renders HTML. The browser never reaches this service.

## Response codes

Only the routes that exist. The rest get their codes when they are written, not before.

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
