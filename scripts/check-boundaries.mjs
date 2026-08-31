#!/usr/bin/env node
/**
 * Deterministic architecture and security guard.
 *
 * Runs in two places: as a CI step and as a PostToolUse hook in .claude/settings.json.
 * Plain Node with no dependencies, so it works before `pnpm install` and cannot be
 * silenced by an inline comment the way a lint rule can.
 *
 * Exit code 0 = clean, 1 = violations found (printed with file:line).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.turbo', '.git', 'coverage'])
const SOURCE_EXT = /\.(?:m|c)?[jt]sx?$/

/** Matches `from '…'`, `import('…')`, `import '…'`, `require('…')`. */
const SPECIFIER_RE =
  /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]/g

const posix = (file) => file.split(sep).join('/')
/** `apps/harbor-web/src/x.ts` → `harbor-web`; anything outside apps/ → null. */
const appOf = (file) => {
  const parts = file.split(sep)
  return parts[0] === 'apps' ? (parts[1] ?? null) : null
}
const isSso = (app) => app === 'sso-web' || app === 'sso-api'
const isWeb = (app) => app?.endsWith('-web') ?? false
const isApi = (app) => app?.endsWith('-api') ?? false

const refersTo = (spec, app) =>
  spec === `@traiectus/${app}` ||
  spec.startsWith(`@traiectus/${app}/`) ||
  new RegExp(`(^|/)apps/${app}(/|$)`).test(spec)

const IMPORT_RULES = [
  {
    id: 'boundary/identity-service-is-reached-over-http',
    applies: (file) => !isSso(appOf(file)),
    forbids: (spec) => refersTo(spec, 'sso-api') || refersTo(spec, 'sso-web'),
    message:
      'Applications reach the identity service over HTTP through @traiectus/auth-client, exactly as a third party would. Importing its code would erase the boundary the project exists to demonstrate.',
  },
  {
    id: 'boundary/identity-service-knows-no-clients',
    applies: (file) => isSso(appOf(file)),
    forbids: (spec) =>
      ['harbor-web', 'harbor-api', 'beacon-web', 'beacon-api'].some((app) => refersTo(spec, app)),
    message:
      'The identity service knows nothing about who consumes it. Clients are configured data, never imports.',
  },
  {
    id: 'boundary/web-and-api-are-separate-services',
    applies: (file) => isWeb(appOf(file)) || isApi(appOf(file)),
    forbids: (spec) => {
      const target = /@traiectus\/([a-z]+-(?:web|api))/.exec(spec)?.[1] ?? null
      return target !== null && /(-web|-api)$/.test(target)
    },
    message:
      'A web application and its API are separate deployments. They share types through @traiectus/contracts and speak HTTP — never a direct import.',
  },
  {
    id: 'boundary/resource-sdk-stays-portable',
    applies: (file) => file.startsWith(join('packages', 'auth-client', 'src', 'resource')),
    forbids: (spec) => spec === 'next' || spec.startsWith('next/') || spec === 'react',
    message:
      'The resource half of the SDK must run on any Node server — a Hono API today, a Fastify one or the mobile backend tomorrow. Framework imports would strand it in Next.js.',
  },
  {
    id: 'boundary/api-services-render-nothing',
    applies: (file) => isApi(appOf(file)),
    forbids: (spec) => spec === '@traiectus/ui' || spec.startsWith('@traiectus/ui/'),
    message: 'A resource server returns JSON. It has no user interface to share.',
  },
]

const CONTENT_RULES = [
  {
    id: 'security/no-web-storage',
    applies: (file) => file.startsWith(`apps${sep}`) || file.startsWith(`packages${sep}`),
    pattern: /\b(?:localStorage|sessionStorage|indexedDB)\b/,
    message:
      'Web storage is not used at all — not for tokens, not for anything else. No token reaches the browser: both live in an AEAD-sealed HttpOnly cookie held by the client web server. The rule is blanket on purpose, so that it needs no judgement from someone in a hurry. See docs/decisions/0008-no-token-reaches-the-browser.md.',
  },
  {
    id: 'security/no-weak-randomness',
    applies: (file) => isSso(appOf(file)) || file.startsWith(join('packages', 'auth-client')),
    pattern: /\bMath\s*\.\s*random\s*\(/,
    message:
      'Session ids, authorization codes and state parameters come from node:crypto, never Math.random().',
  },
]

const REQUIRED_RULES = [
  {
    id: 'boundary/server-code-is-marked-server-only',
    applies: (file) => isWeb(appOf(file)) && file.includes(join('src', 'server') + sep),
    pattern: /^\s*import\s+['"]server-only['"]/m,
    message:
      "Files under src/server hold cookies, secrets and data access. Start them with `import 'server-only'` so the build fails if browser code ever pulls one in — that is what makes the boundary real rather than a naming convention.",
  },
]

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (SOURCE_EXT.test(entry)) yield full
  }
}

function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

const violations = []

for (const absolute of walk(ROOT)) {
  const file = relative(ROOT, absolute)
  const text = readFileSync(absolute, 'utf8')

  for (const rule of IMPORT_RULES) {
    if (!rule.applies(file)) continue
    SPECIFIER_RE.lastIndex = 0
    let match
    while ((match = SPECIFIER_RE.exec(text)) !== null) {
      const spec = match[1] ?? match[2] ?? match[3] ?? match[4]
      if (spec && rule.forbids(spec)) {
        violations.push({ file, line: lineOf(text, match.index), rule, detail: `imports '${spec}'` })
      }
    }
  }

  for (const rule of CONTENT_RULES) {
    if (!rule.applies(file)) continue
    const match = rule.pattern.exec(text)
    if (match) {
      violations.push({ file, line: lineOf(text, match.index), rule, detail: match[0].trim() })
    }
  }

  for (const rule of REQUIRED_RULES) {
    if (!rule.applies(file)) continue
    if (!rule.pattern.test(text)) {
      violations.push({ file, line: 1, rule, detail: 'missing' })
    }
  }
}

if (violations.length === 0) {
  console.log('guards: ok')
  process.exit(0)
}

console.error(`\nguards: ${violations.length} violation(s)\n`)
for (const { file, line, rule, detail } of violations) {
  console.error(`  ${posix(file)}:${line}`)
  console.error(`    [${rule.id}] ${detail}`)
  console.error(`    ${rule.message}\n`)
}
process.exit(1)
