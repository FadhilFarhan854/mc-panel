import { NextRequest } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { sendCommand, getStatus } from '@/lib/minecraft-server'

export const runtime = 'nodejs'

function getServerDir(): string {
  return process.env.MINECRAFT_DIR ?? '/opt/minecraft'
}

function parseProperties(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.substring(0, idx).trim()
    const value = trimmed.substring(idx + 1)
    result[key] = value
  }
  return result
}

function serializeProperties(original: string, updates: Record<string, string>): string {
  const lines = original.split('\n')
  const result: string[] = []
  const touched = new Set<string>()

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      result.push(line)
      continue
    }
    const idx = trimmed.indexOf('=')
    if (idx === -1) {
      result.push(line)
      continue
    }
    const key = trimmed.substring(0, idx).trim()
    if (key in updates) {
      result.push(`${key}=${updates[key]}`)
      touched.add(key)
    } else {
      result.push(line)
    }
  }

  // Append any new keys not present in original
  for (const [key, value] of Object.entries(updates)) {
    if (!touched.has(key)) {
      result.push(`${key}=${value}`)
    }
  }

  return result.join('\n')
}

export async function GET() {
  const filePath = path.join(getServerDir(), 'server.properties')
  if (!fs.existsSync(filePath)) {
    return Response.json({ success: false, message: 'server.properties not found' }, { status: 404 })
  }
  const content = fs.readFileSync(filePath, 'utf8')
  return Response.json({ success: true, properties: parseProperties(content) })
}

export async function PUT(req: NextRequest) {
  const body = await req.json()
  const properties = body?.properties

  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    return Response.json({ success: false, message: 'Invalid payload' }, { status: 400 })
  }

  // Validate all keys: only lowercase alphanumeric, hyphens, dots
  for (const key of Object.keys(properties)) {
    if (!/^[a-z0-9\-.]+$/.test(key)) {
      return Response.json({ success: false, message: `Invalid property key: ${key}` }, { status: 400 })
    }
  }

  // Strip newlines from values to prevent property file injection
  const sanitized: Record<string, string> = {}
  for (const [k, v] of Object.entries(properties)) {
    sanitized[k] = String(v).replace(/[\r\n]/g, '')
  }

  const filePath = path.join(getServerDir(), 'server.properties')
  if (!fs.existsSync(filePath)) {
    return Response.json({ success: false, message: 'server.properties not found' }, { status: 404 })
  }

  const original = fs.readFileSync(filePath, 'utf8')
  const updated = serializeProperties(original, sanitized)
  fs.writeFileSync(filePath, updated, 'utf8')

  // For Bedrock: show-coordinates and keepInventory in server.properties only affects new worlds.
  // Existing worlds require the gamerule to be set at runtime.
  if (getStatus() === 'online') {
    if ('show-coordinates' in sanitized) {
      const value = sanitized['show-coordinates'] === 'true' ? 'true' : 'false'
      sendCommand(`gamerule showcoordinates ${value}`)
    }
    if ('keep-inventory' in sanitized) {
      const value = sanitized['keep-inventory'] === 'true' ? 'true' : 'false'
      sendCommand(`gamerule keepInventory ${value}`)
    }
  }

  return Response.json({ success: true, message: 'Configuration saved. Restart the server for all changes to take effect.' })
}
