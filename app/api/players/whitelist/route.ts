import { NextRequest } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { sendCommand, getStatus } from '@/lib/minecraft-server'

export const runtime = 'nodejs'

// Minecraft usernames: 2-16 chars, alphanumeric + underscore
const VALID_USERNAME = /^[a-zA-Z0-9_]{2,16}$/

type WhitelistEntry = { uuid: string; name: string }

function getWhitelistPath(): string {
  return path.join(process.env.MINECRAFT_DIR ?? '/opt/minecraft', 'whitelist.json')
}

function readWhitelist(): WhitelistEntry[] {
  const p = getWhitelistPath()
  if (!fs.existsSync(p)) return []
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as WhitelistEntry[]
  } catch {
    return []
  }
}

function writeWhitelist(list: WhitelistEntry[]): void {
  fs.writeFileSync(getWhitelistPath(), JSON.stringify(list, null, 2), 'utf8')
}

export async function GET() {
  return Response.json({ success: true, players: readWhitelist() })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const name = body?.name

  if (typeof name !== 'string' || !VALID_USERNAME.test(name)) {
    return Response.json({ success: false, message: 'Invalid player name' }, { status: 400 })
  }

  if (getStatus() === 'online') {
    sendCommand(`whitelist add ${name}`)
    return Response.json({ success: true, message: `Added ${name} to whitelist` })
  }

  // Server offline: edit file directly
  const list = readWhitelist()
  if (list.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return Response.json({ success: false, message: `${name} is already whitelisted` })
  }
  list.push({ uuid: '', name })
  writeWhitelist(list)
  return Response.json({ success: true, message: `Added ${name} to whitelist` })
}

export async function DELETE(req: NextRequest) {
  const body = await req.json()
  const name = body?.name

  if (typeof name !== 'string' || !VALID_USERNAME.test(name)) {
    return Response.json({ success: false, message: 'Invalid player name' }, { status: 400 })
  }

  if (getStatus() === 'online') {
    sendCommand(`whitelist remove ${name}`)
    return Response.json({ success: true, message: `Removed ${name} from whitelist` })
  }

  const list = readWhitelist().filter((p) => p.name.toLowerCase() !== name.toLowerCase())
  writeWhitelist(list)
  return Response.json({ success: true, message: `Removed ${name} from whitelist` })
}
