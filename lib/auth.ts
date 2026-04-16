import { createHmac, randomBytes } from 'node:crypto'

const COOKIE_NAME = 'mc_panel_token'
const TOKEN_MAX_AGE = 60 * 60 * 24 * 7 // 7 days in seconds

function getSecret(): string {
  return process.env.PANEL_SECRET ?? 'mc-panel-default-secret-change-me'
}

export function getPassword(): string {
  return process.env.PANEL_PASSWORD ?? ''
}

export function isAuthEnabled(): boolean {
  return getPassword().length > 0
}

export function createToken(): string {
  const payload = `${Date.now()}:${randomBytes(16).toString('hex')}`
  const hmac = createHmac('sha256', getSecret()).update(payload).digest('hex')
  return `${payload}:${hmac}`
}

export function verifyToken(token: string): boolean {
  const parts = token.split(':')
  if (parts.length !== 3) return false
  const [timestamp, nonce, signature] = parts
  const payload = `${timestamp}:${nonce}`
  const expected = createHmac('sha256', getSecret()).update(payload).digest('hex')

  // Constant-time comparison
  if (expected.length !== signature.length) return false
  let mismatch = 0
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  if (mismatch !== 0) return false

  // Check expiry
  const ts = parseInt(timestamp, 10)
  if (isNaN(ts)) return false
  if (Date.now() - ts > TOKEN_MAX_AGE * 1000) return false

  return true
}

export { COOKIE_NAME, TOKEN_MAX_AGE }
