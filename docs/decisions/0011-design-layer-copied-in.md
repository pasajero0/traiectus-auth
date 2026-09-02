# ADR-0011: The design layer is copied in, not depended on

**Status:** proposed
**Date:** 2026-09-02

## Context

Four browser-facing applications — `sso-web`, `harbor-web`, `beacon-web`, and whatever
follows — have to look like one system. Signing in at Harbor and landing inside Beacon
without a form is the fact this repository exists to show, and a visible change of design
across that boundary reads as three unrelated demos rather than one session.

`packages/ui` exists for this and is currently an empty `index.ts`. The choice is being made
now, before it is built, because the sign-in page is already scheduled and because a
component library is discovered to be the wrong one at the moment it is most expensive to
replace.

Four constraints narrow the field more than taste does:

- The repository is read as an artifact. A reader should be able to open a component and see
  code written here, not a version number.
- The sign-in page ships zero JavaScript (ADR-0010). A library whose primitives are client
  components takes that away.
- Dependencies are pinned to exact versions.
- The ship date is 10 September 2026 and cross-application sign-in does not work yet.

## Decision

**shadcn/ui**, installed into `packages/ui` on Tailwind and consumed by every web
application. Components are copied into this repository as source rather than imported from
a package.

**Nothing is installed until cross-application sign-in works end to end.** Until then this is
a decision, not a change; the deferral is recorded on the README Roadmap.

## Consequences

- Components are source in this repository: readable, editable, and not subject to anyone
  else's release cycle. The other half of that is real — they are ours to maintain, and
  upstream fixes arrive only if someone goes and gets them.
- `button`, `input`, `label` and `card` are wrappers over native elements rather than Radix
  primitives, so the sign-in page stays a Server Component with no `'use client'` and
  ADR-0010 holds.
- Radix arrives only alongside components that need it — dialogs, dropdowns, popovers. None
  is scheduled.
- The `shadcn` CLI writes dependency ranges with a caret. They get pinned by hand, or
  `pnpm verify` and the repository's version policy disagree.
- Scope is fixed at five components — `button`, `input`, `label`, `card`, `alert`. Anything
  beyond them is a line in the Roadmap.
- Design tokens live in `packages/ui` and nowhere else, so a colour cannot be decided twice.

## Alternatives considered

**Mantine.** The strongest complete library on offer: hundreds of components, a large hook
set, and server rendering that genuinely works under the App Router. It was the serious
alternative. Rejected because it is a dependency whose components a reader cannot inspect
without leaving the repository, and because roughly ten controls are needed here — the
breadth that makes Mantine worth its weight elsewhere is weight without work in this project.

**Ant Design or MUI.** Both are built for applications far larger than this one, both bring a
substantial runtime, and both push components toward `'use client'` — Ant Design additionally
needs a style registry to render correctly under the App Router. For four forms and two
product screens, neither pays for itself.

**HeroUI, formerly NextUI.** Tailwind-based, built for this ecosystem, and the closest
competitor. Rejected for the same reason as Mantine — a dependency rather than source — and
because its animated defaults are aimed at a marketing page, not at a sign-in form.

**No library at all: plain CSS modules.** Entirely viable at this size and the only option
with no dependency cost whatsoever. Nearly chosen. Rejected because consistency across three
applications is the property being demonstrated, and hand-written CSS in four places drifts
apart quietly; shadcn/ui supplies the tokens and a shared form vocabulary for approximately
the same volume of code, which is the part that would otherwise have to be invented twice.
