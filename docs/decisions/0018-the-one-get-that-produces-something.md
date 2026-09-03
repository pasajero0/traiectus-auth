# ADR-0018: The one GET that produces something

**Status:** accepted
**Date:** 2026-09-03
**Amends:** [ADR-0008](0008-no-token-reaches-the-browser.md) — the scope of its third
mitigation.

## Context

ADR-0008 names three things holding the CSRF surface closed: `SameSite=Lax`, an `Origin`
check on every state-changing request, and **no state-changing `GET`**. All three were
written about `<client>-web`, where the browser authenticates with a cookie and a `GET`
that changed data would be forgeable from any page carrying an `<img>` tag.

From this block, `GET /authorize` inserts an authorization code row. A reader arriving at
that line with the third mitigation in mind stops there, and is right to.

**It cannot be a `POST`.** `SameSite=Lax` withholds the SSO cookie from a cross-site
`POST` and sends it with a top-level navigation. Arriving at `/authorize` *is* a top-level
navigation from another site — that is the only shape that carries the cookie, and
therefore the only shape single sign-on can take (ADR-0001). Turning it into a `POST` would
break the property this repository exists to demonstrate in order to satisfy a rule about a
different application.

**Nor can an `Origin` check help.** Browsers send no `Origin` on a top-level `GET`
navigation, and coming from another site is the feature rather than the attack. A check
here would either reject everything or pass everything, and the second is worse than none.

## Decision

**`GET /authorize` may create an authorization code.** What protects it is not the method:

- `redirect_uri` is matched against a configured allowlist, exactly. A forged navigation
  therefore delivers a code **to a registered client**, never to whoever forged it.
- The code is single use and lives sixty seconds.
- It is worthless without the client's secret *and* the PKCE verifier, which never left the
  client's own server (ADR-0016).
- `state`, checked by the client, answers login CSRF; `iss` answers mix-up (ADR-0017).

**ADR-0008's third mitigation is restated as what it always was:** a rule for client
applications, where a `GET` must not change the user's data. It is not a rule that the
identity service may never mint a short-lived artifact on a navigation, because the
navigation is the mechanism.

## Consequences

- **An anonymous caller can cause rows to be written.** Rate limiting on `/authorize` is
  therefore required rather than optional, and it lands 07/09 with the rest. Named here so
  that it is a scheduled gap and not a discovery.
- Codes are small and expire in a minute; the sweeper of
  [ADR-0015](0015-expired-rows-have-an-owner.md) collects them on the same terms as
  everything else with a lifetime.
- The code row is bound to the SSO session that produced it, so logging out invalidates
  codes that were issued and never redeemed.
- Nothing belonging to the user changes on this `GET`: no password, no session, no consent,
  no grant that outlives the minute. The state created is an artifact addressed to a party
  named in advance.

## Alternatives considered

**An intermediate page on `sso-web` with a `POST` button.** Satisfies the rule to the
letter. It also puts a click in front of every silent sign-in, which deletes the exact
property being demonstrated — the second application opening without a form. That screen
has a name, consent, and consent is out of scope by decision.

**Issue nothing on the `GET`; let the client ask for the code afterwards.** The client
cannot prove it is the browser whose session was just checked: the cookie is on `sso-web`'s
host and no client can read it. The redirect *is* the proof, which is why the code travels
on it.

**Keep the code in memory and hand it over without a row.** One instance today, several
tomorrow, and no revocation. Rejected on ADR-0001's terms: what has to be revocable is
state, and state lives in the database.
