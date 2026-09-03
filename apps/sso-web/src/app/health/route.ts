import { NextResponse } from 'next/server'

import { env } from '@/server/env'

const startedAt = Date.now()

/**
 * Reads its own environment, unlike a route that only renders once one is already needed —
 * so a Vercel deploy with a missing or malformed variable shows red here instead of staying
 * green until the first sign-in finds out the hard way.
 */
export async function GET(): Promise<Response> {
  try {
    env()
  } catch (error) {
    return NextResponse.json(
      { status: 'misconfigured', error: error instanceof Error ? error.message : 'unknown' },
      { status: 500 },
    )
  }

  return NextResponse.json({
    status: 'ok',
    service: 'sso-web',
    commit: (process.env['VERCEL_GIT_COMMIT_SHA'] ?? 'local').slice(0, 7),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  })
}
