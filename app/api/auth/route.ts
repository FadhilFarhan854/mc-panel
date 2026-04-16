import { NextRequest } from 'next/server'
import { getPassword, createToken, verifyToken, COOKIE_NAME, TOKEN_MAX_AGE } from '@/lib/auth'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const password = body?.password

  if (typeof password !== 'string') {
    return Response.json({ success: false, message: 'Password is required' }, { status: 400 })
  }

  const expected = getPassword()
  if (!expected) {
    return Response.json({ success: false, message: 'PANEL_PASSWORD not configured' }, { status: 500 })
  }

  // Constant-time-ish comparison to avoid timing attacks
  if (password.length !== expected.length || !timingSafeEqual(password, expected)) {
    return Response.json({ success: false, message: 'Wrong password' }, { status: 401 })
  }

  const token = createToken()
  const res = Response.json({ success: true, message: 'Logged in' })

  res.headers.append(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TOKEN_MAX_AGE}`
  )

  return res
}

export async function DELETE() {
  const res = Response.json({ success: true, message: 'Logged out' })
  res.headers.append(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  )
  return res
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value
  if (token && verifyToken(token)) {
    return Response.json({ authenticated: true })
  }
  return Response.json({ authenticated: false }, { status: 401 })
}
