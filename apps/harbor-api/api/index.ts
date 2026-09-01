import { handle } from 'hono/vercel'

import { buildApp } from '../src/app.js'
import { loadEnv } from '../src/env.js'

/**
 * The Vercel entry point. `src/index.ts` starts a Node server for local
 * development; this hands the same app to Vercel's runtime instead. Both are a
 * handful of lines around `buildApp` — the host is a file, not an architecture.
 *
 * Named method exports, not a default one: Vercel calls a default export with
 * the Node signature `(req, res)` and ignores whatever it returns, while
 * `handle()` answers by returning a Response. Every verb is exported so routing
 * stays entirely Hono's — a verb left unexported would be refused by the
 * platform before the router ever saw the request.
 *
 * The environment is validated here too, so a missing ACCESS_TOKEN_PUBLIC_KEY
 * fails loudly instead of letting the service answer without verifying anything.
 */
export const config = { runtime: 'nodejs' }

const handler = handle(buildApp(loadEnv()))

export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
export const HEAD = handler
export const OPTIONS = handler
