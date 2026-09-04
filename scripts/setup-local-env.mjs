#!/usr/bin/env node
/**
 * Writes the local environment files the six services need, once.
 *
 * Plain Node with no dependencies, same as check-boundaries.mjs — this has to run before
 * anyone has a working environment, which is the whole point of it.
 *
 * Each `.env.example` stays the source of truth for *names*: this copies the example
 * verbatim, comments and all, and fills in only the values it left blank or marked
 * `replace-me`. Adding a key to an example is therefore all it takes for that key to
 * appear here too.
 *
 * Nothing it writes is committable — .gitignore covers .env and .env.local at any depth.
 *
 * Usage: pnpm setup:local [--force]
 */

import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FORCE = process.argv.includes('--force')

/** A `-web` is a Next.js app, which reads .env.local itself; the rest read --env-file. */
const APPS = ['sso-api', 'sso-web', 'harbor-api', 'harbor-web', 'beacon-api', 'beacon-web']
const targetFor = (app) => (app.endsWith('-web') ? '.env.local' : '.env')

const hex = (bytes) => randomBytes(bytes).toString('hex')
const base64 = (bytes) => randomBytes(bytes).toString('base64')

/** The examples' own placeholders. A value that is neither is already a working default. */
const isPlaceholder = (value) => value === '' || value === 'replace-me'

function parseExample(app) {
  const path = join(ROOT, 'apps', app, '.env.example')
  if (!existsSync(path)) throw new Error(`apps/${app}/.env.example is missing`)

  const lines = readFileSync(path, 'utf8').split('\n')
  const values = {}
  for (const line of lines) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (match) values[match[1]] = match[2]
  }
  return { lines, values }
}

const examples = Object.fromEntries(APPS.map((app) => [app, parseExample(app)]))

/**
 * One key pair, one internal key, one secret per client — the halves have to match across
 * services or nothing works, so they are generated together, here, exactly once.
 */
const { publicKey, privateKey } = generateKeyPairSync('ed25519')

const clientOf = (app, name) => {
  const base = examples[`${app}-web`].values['APP_BASE_URL']
  if (!base) throw new Error(`apps/${app}-web/.env.example has no APP_BASE_URL to build on`)
  return {
    id: app,
    secret: hex(24),
    // Exactly the path the BFF route handles — apps/<app>-web/src/app/api/auth/[...traiectus].
    redirectUris: [`${base}/api/auth/callback`],
    name,
    homeUrl: base,
  }
}

const harbor = clientOf('harbor', 'Harbor')
const beacon = clientOf('beacon', 'Beacon')

const shared = {
  INTERNAL_API_KEY: hex(32),
  ACCESS_TOKEN_PRIVATE_KEY: JSON.stringify(privateKey.export({ format: 'jwk' })),
  ACCESS_TOKEN_PUBLIC_KEY: JSON.stringify({ ...publicKey.export({ format: 'jwk' }), alg: 'EdDSA' }),
  REFRESH_SUCCESSOR_ENCRYPTION_KEY: base64(32),
  CLIENTS: JSON.stringify([harbor, beacon]),
}

const perApp = {
  'harbor-web': { TRAIECTUS_CLIENT_SECRET: harbor.secret, SESSION_SEAL_KEY: base64(32) },
  'beacon-web': { TRAIECTUS_CLIENT_SECRET: beacon.secret, SESSION_SEAL_KEY: base64(32) },
}

function valueFor(app, key) {
  const generated = perApp[app]?.[key] ?? shared[key]
  if (generated === undefined) {
    throw new Error(`apps/${app}/.env.example asks for ${key}, which this script cannot generate`)
  }
  return generated
}

/** Quoted because JSON and base64 carry characters a bare dotenv value should not. */
const render = (key, value) => `${key}='${value}'`

function fill(app) {
  const { lines, values } = examples[app]
  return lines
    .map((line) => {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line)
      if (!match) return line
      const key = match[1]
      return isPlaceholder(values[key]) ? render(key, valueFor(app, key)) : line
    })
    .join('\n')
}

const targets = APPS.map((app) => ({
  app,
  file: join('apps', app, targetFor(app)),
  path: join(ROOT, 'apps', app, targetFor(app)),
}))

const existing = targets.filter((target) => existsSync(target.path))

if (existing.length === targets.length && !FORCE) {
  console.log('setup:local: every file is already there, nothing written.')
  console.log('  Regenerate the whole set with: pnpm setup:local --force')
  process.exit(0)
}

// Half a set is worse than none: the halves of the key pair, the internal key and each
// client secret have to agree across services, and a partial fill would generate values
// that disagree with the ones already on disk.
if (existing.length > 0 && !FORCE) {
  console.error('setup:local: some files exist and some do not, so the set cannot be consistent:\n')
  for (const target of targets) {
    console.error(`  ${existsSync(target.path) ? 'exists ' : 'missing'}  ${target.file}`)
  }
  console.error('\nRegenerate all six together: pnpm setup:local --force')
  process.exit(1)
}

for (const target of targets) {
  writeFileSync(target.path, fill(target.app))
  console.log(`  wrote  ${target.file}`)
}

console.log('\nsetup:local: done. These files are gitignored and throwaway — regenerate any time.')
console.log('Next: pnpm dev   (sso-web on :4100, sso-api on :4000)')
