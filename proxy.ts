import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, isAuthEnabled, COOKIE_NAME } from '@/lib/auth'

export function proxy(request: NextRequest) {
  // If no PANEL_PASSWORD is set, skip auth entirely
  if (!isAuthEnabled()) {
    return NextResponse.next()
  }

  const { pathname } = request.nextUrl

  // Allow access to login page and auth API without token
  if (pathname === '/login' || pathname.startsWith('/api/auth')) {
    return NextResponse.next()
  }

  // Allow static assets
  if (pathname.startsWith('/_next/') || pathname.startsWith('/favicon')) {
    return NextResponse.next()
  }

  const token = request.cookies.get(COOKIE_NAME)?.value

  if (!token || !verifyToken(token)) {
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
