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

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.turbo', '.git', 'coverage'])
const SOURCE_EXT = /\.(?:m|c)?[jt]sx?$/
const ENV_EXAMPLE = '.env.example'

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

const CLIENT_APPS = ['harbor-web', 'harbor-api', 'beacon-web', 'beacon-api']
const ALL_APPS = ['sso-web', 'sso-api', ...CLIENT_APPS]

/**
 * A relative specifier resolved to a repo-relative posix path; null for a bare one.
 *
 * Matching the specifier as written is not enough. Every application lives in one
 * checkout, so a sibling is reachable as '../../../sso-api/src/env' — a path that
 * names no `apps/` segment and so matches none of the patterns below while pointing
 * straight through the boundary. Resolving it first is what makes these rules about
 * the file being imported rather than about how it happened to be spelled.
 */
const resolveSpec = (file, spec) =>
  spec.startsWith('.') ? posix(relative(ROOT, resolve(dirname(join(ROOT, file)), spec))) : null

const refersTo = (spec, resolved, app) =>
  spec === `@traiectus/${app}` ||
  spec.startsWith(`@traiectus/${app}/`) ||
  new RegExp(`(^|/)apps/${app}(/|$)`).test(spec) ||
  (resolved !== null && new RegExp(`^apps/${app}(/|$)`).test(resolved))

const IMPORT_RULES = [
  {
    id: 'boundary/identity-service-is-reached-over-http',
    applies: (file) => !isSso(appOf(file)),
    forbids: (spec, resolved) =>
      refersTo(spec, resolved, 'sso-api') || refersTo(spec, resolved, 'sso-web'),
    message:
      'Applications reach the identity service over HTTP through @traiectus/auth-client, exactly as a third party would. Importing its code would erase the boundary the project exists to demonstrate.',
  },
  {
    id: 'boundary/identity-service-knows-no-clients',
    applies: (file) => isSso(appOf(file)),
    forbids: (spec, resolved) => CLIENT_APPS.some((app) => refersTo(spec, resolved, app)),
    message:
      'The identity service knows nothing about who consumes it. Clients are configured data, never imports.',
  },
  {
    id: 'boundary/web-and-api-are-separate-services',
    applies: (file) => isWeb(appOf(file)) || isApi(appOf(file)),
    // Any application other than the one doing the importing, minus whatever the two
    // rules above already report — a client hears about sso-* from the first, an sso
    // file hears about clients from the second — so nothing is listed twice. What is
    // left is precisely an application reaching for its own counterpart, and that
    // includes sso-web into sso-api, which ADR-0004 splits for the same reason.
    forbids: (spec, resolved, file) => {
      const self = appOf(file)
      const reportedElsewhere = isSso(self) ? CLIENT_APPS : ['sso-web', 'sso-api']
      return ALL_APPS.some(
        (app) =>
          app !== self && !reportedElsewhere.includes(app) && refersTo(spec, resolved, app),
      )
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
    forbids: (spec, resolved) =>
      spec === '@traiectus/ui' ||
      spec.startsWith('@traiectus/ui/') ||
      (resolved !== null && /^packages\/ui(\/|$)/.test(resolved)),
    message: 'A resource server returns JSON. It has no user interface to share.',
  },
]

/**
 * Everything that ships. Both security rules apply to all of it, with no per-application
 * carve-out: a client's web server seals its own session cookie and checks its own Origin,
 * so it needs real randomness exactly as much as the identity service does. ADR-0008.
 */
const isShippedCode = (file) =>
  (file.startsWith(`apps${sep}`) || file.startsWith(`packages${sep}`)) && SOURCE_EXT.test(file)

const isEnvExample = (file) => file.endsWith(ENV_EXAMPLE)

/** Anywhere a credential could be pasted: shipped source, and the env examples. */
const isCommittedText = (file) => isShippedCode(file) || isEnvExample(file)

const CONTENT_RULES = [
  {
    id: 'security/no-web-storage',
    applies: isShippedCode,
    pattern: /\b(?:localStorage|sessionStorage|indexedDB)\b/g,
    message:
      'Web storage is not used at all — not for tokens, not for anything else. No token reaches the browser: both live in an AEAD-sealed HttpOnly cookie held by the client web server. The rule is blanket on purpose, so that it needs no judgement from someone in a hurry. See docs/decisions/0008-no-token-reaches-the-browser.md.',
  },
  {
    id: 'security/no-embedded-credential',
    applies: isCommittedText,
    pattern:
      /-----BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[osu]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|"d"\s*:\s*"[A-Za-z0-9_-]{20,}"/g,
    message:
      'This looks like a real credential. Nothing secret is committed — keys live in the deployment platform, and locally in a .env that git ignores.',
  },
  {
    id: 'security/no-weak-randomness',
    applies: isShippedCode,
    pattern: /\bMath\s*\.\s*random\s*\(/g,
    message:
      'Session ids, authorization codes, state parameters and anything else that must be unguessable come from node:crypto, never Math.random().',
  },
]

/**
 * An example file documents which variables exist. Its values are placeholders by
 * definition, so the rule is stated that way round — a secret-shaped name must carry a
 * placeholder — rather than as a guess at what a real secret looks like. Deciding
 * "does this look secret enough" is exactly the judgement nobody makes correctly in a
 * hurry.
 */
const SECRET_NAME = /(?:^|_)(KEYS?|SECRETS?|TOKENS?|PASSWORDS?|PASS|CREDENTIALS?)(?:$|_)/
const PLACEHOLDERS = new Set(['', 'replace-me', 'change-me', 'changeme', 'todo'])
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', 'postgres', 'db'])

const LINE_RULES = [
  {
    id: 'security/no-value-behind-a-secret-name',
    applies: isEnvExample,
    check(line) {
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
      if (!match) return null
      const [, name, value] = match
      if (!SECRET_NAME.test(name) || PLACEHOLDERS.has(value.trim())) return null
      return `${name}=${value.trim().slice(0, 12)}…`
    },
    message:
      'A variable whose name says secret must carry a placeholder here, not a value. Put the real one in the deployment platform, or in a .env that git ignores.',
  },
  {
    id: 'security/no-remote-database-url',
    applies: isEnvExample,
    check(line) {
      const match = /postgres(?:ql)?:\/\/[^@\s]*@([^:/\s]+)/.exec(line)
      if (!match || LOCAL_HOSTS.has(match[1])) return null
      return match[0]
    },
    message:
      'An example points at a local database. A host that is not local carries credentials for something real.',
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

/**
 * A variable a deployment platform sets on its own — Render's own build metadata, say.
 * Nothing a developer copies into a local .env, so its absence from .env.example is not
 * drift.
 */
const PLATFORM_INJECTED_ENV_VARS = new Set(['RENDER_GIT_COMMIT'])

const ENV_SCHEMA_ID = 'env/schema-and-example-agree'
const ENV_SCHEMA_MESSAGE =
  'A variable the schema reads and a variable the example documents must be the same set. One the schema requires and the example never mentions is a deploy with no way to know it exists; one the example lists and the schema never reads is a stale line nobody will notice going wrong.'

/** The schema's own field names — `KEY: z....` at the object literal's top level, so a
 * `.refine()` continuation on the next line is never mistaken for a second field. */
function envSchemaKeys(text) {
  const body = /z\.object\(\{([\s\S]*?)\n\}\)/.exec(text)?.[1]
  if (body === undefined) return null
  return new Set([...body.matchAll(/^\s+([A-Z][A-Z0-9_]*):/gm)].map(([, name]) => name))
}

function envExampleKeys(text) {
  return new Set([...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(([, name]) => name))
}

/**
 * Cross-file by nature — an env.ts read against its app's own .env.example — so this is a
 * pass of its own rather than a per-file rule in the walk below.
 */
function checkEnvSchemasMatchExamples() {
  for (const app of readdirSync(join(ROOT, 'apps'))) {
    const appDir = join('apps', app)
    const envPath = [join(appDir, 'src', 'env.ts'), join(appDir, 'src', 'server', 'env.ts')].find(
      (candidate) => existsSync(join(ROOT, candidate)),
    )
    const examplePath = join(appDir, ENV_EXAMPLE)
    if (!envPath || !existsSync(join(ROOT, examplePath))) continue

    const schemaKeys = envSchemaKeys(readFileSync(join(ROOT, envPath), 'utf8'))
    if (!schemaKeys) continue
    const exampleKeys = envExampleKeys(readFileSync(join(ROOT, examplePath), 'utf8'))

    for (const key of schemaKeys) {
      if (PLATFORM_INJECTED_ENV_VARS.has(key) || exampleKeys.has(key)) continue
      violations.push({
        file: examplePath,
        line: 1,
        rule: { id: ENV_SCHEMA_ID, message: ENV_SCHEMA_MESSAGE },
        detail: `${posix(envPath)} requires ${key}; missing here`,
      })
    }

    for (const key of exampleKeys) {
      if (schemaKeys.has(key)) continue
      violations.push({
        file: examplePath,
        line: 1,
        rule: { id: ENV_SCHEMA_ID, message: ENV_SCHEMA_MESSAGE },
        detail: `${key} is documented here; ${posix(envPath)} never reads it`,
      })
    }
  }
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (SOURCE_EXT.test(entry) || entry === ENV_EXAMPLE) yield full
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
      if (spec && rule.forbids(spec, resolveSpec(file, spec), file)) {
        violations.push({ file, line: lineOf(text, match.index), rule, detail: `imports '${spec}'` })
      }
    }
  }

  // Every occurrence, not the first: a file that reaches for web storage twice is
  // two things to fix, and reporting one of them invites a second run to find the rest.
  for (const rule of CONTENT_RULES) {
    if (!rule.applies(file)) continue
    rule.pattern.lastIndex = 0
    let match
    while ((match = rule.pattern.exec(text)) !== null) {
      violations.push({ file, line: lineOf(text, match.index), rule, detail: match[0].trim() })
    }
  }

  for (const rule of LINE_RULES) {
    if (!rule.applies(file)) continue
    text.split('\n').forEach((line, index) => {
      const detail = rule.check(line)
      if (detail) violations.push({ file, line: index + 1, rule, detail })
    })
  }

  for (const rule of REQUIRED_RULES) {
    if (!rule.applies(file)) continue
    if (!rule.pattern.test(text)) {
      violations.push({ file, line: 1, rule, detail: 'missing' })
    }
  }
}

checkEnvSchemasMatchExamples()

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
