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
| `GET /v1/sessions/:id` | validate and slide it | 3 |
| `DELETE /v1/sessions/:id` | revoke it, and every refresh family with it | 8 |
| `POST /v1/authorization-codes` | issue a single-use code for a client | 5 |

Nothing here renders HTML. The browser never reaches this service.
