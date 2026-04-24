import * as fs from 'node:fs'
import * as path from 'node:path'
import { getServerType } from '@/lib/minecraft-server'

export const runtime = 'nodejs'

function getServerDir(): string {
  return process.env.MINECRAFT_DIR ?? '/opt/minecraft'
}

function isJavaWorld(dirPath: string): boolean {
  return fs.existsSync(path.join(dirPath, 'level.dat'))
}

function isBedrockWorld(dirPath: string): boolean {
  // Bedrock worlds contain level.dat too, but inside worlds/ subfolder
  return fs.existsSync(path.join(dirPath, 'level.dat'))
}

export async function GET() {
  const serverDir = getServerDir()

  if (!fs.existsSync(serverDir)) {
    return Response.json({ success: false, message: 'Server directory not found' }, { status: 404 })
  }

  const serverType = getServerType()
  const worlds: string[] = []

  try {
    if (serverType === 'bedrock') {
      // Bedrock stores worlds in <serverDir>/worlds/
      const worldsDir = path.join(serverDir, 'worlds')
      if (fs.existsSync(worldsDir)) {
        for (const entry of fs.readdirSync(worldsDir, { withFileTypes: true })) {
          if (entry.isDirectory() && isBedrockWorld(path.join(worldsDir, entry.name))) {
            worlds.push(entry.name)
          }
        }
      }
    } else {
      // Java stores worlds as folders directly in serverDir containing level.dat
      for (const entry of fs.readdirSync(serverDir, { withFileTypes: true })) {
        if (entry.isDirectory() && isJavaWorld(path.join(serverDir, entry.name))) {
          worlds.push(entry.name)
        }
      }
    }
  } catch (err) {
    return Response.json({ success: false, message: `Failed to read worlds: ${String(err)}` }, { status: 500 })
  }

  return Response.json({ success: true, worlds })
}
