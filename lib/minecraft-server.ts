import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const MAX_LOG_LINES = 1000

export type ServerStatus = 'offline' | 'starting' | 'online' | 'stopping'
export type ServerType = 'java' | 'bedrock'

interface ServerState {
  process: ChildProcessWithoutNullStreams | null
  status: ServerStatus
  logs: string[]
  logListeners: Set<(line: string) => void>
}

// Persist state across Next.js hot reloads via globalThis
const g = globalThis as typeof globalThis & { __mcServer?: ServerState }

if (!g.__mcServer) {
  g.__mcServer = {
    process: null,
    status: 'offline',
    logs: [],
    logListeners: new Set(),
  }
}

const state = g.__mcServer!

function getServerDir(): string {
  return process.env.MINECRAFT_DIR ?? '/opt/minecraft'
}

export function getServerType(): ServerType {
  return process.env.MINECRAFT_TYPE?.toLowerCase() === 'bedrock' ? 'bedrock' : 'java'
}

function addLog(line: string): void {
  state.logs.push(line)
  if (state.logs.length > MAX_LOG_LINES) {
    state.logs.splice(0, state.logs.length - MAX_LOG_LINES)
  }
  for (const listener of state.logListeners) {
    listener(line)
  }
}

export function getStatus(): ServerStatus {
  return state.status
}

export function getLogs(): string[] {
  return [...state.logs]
}

export function addLogListener(fn: (line: string) => void): () => void {
  state.logListeners.add(fn)
  return () => {
    state.logListeners.delete(fn)
  }
}

export function startServer(): { success: boolean; message: string } {
  if (state.status !== 'offline') {
    return { success: false, message: `Server is already ${state.status}` }
  }

  const serverDir = getServerDir()
  const type = getServerType()
  let cmd: string
  let args: string[]

  if (type === 'bedrock') {
    const binaryName = process.platform === 'win32' ? 'bedrock_server.exe' : 'bedrock_server'
    const binaryPath = path.join(serverDir, binaryName)
    if (!fs.existsSync(binaryPath)) {
      return { success: false, message: `Bedrock binary not found: ${binaryPath}` }
    }
    cmd = process.platform === 'win32' ? binaryPath : `./${binaryName}`
    args = []
  } else {
    const jarName = process.env.MINECRAFT_JAR ?? 'server.jar'
    const jarPath = path.join(serverDir, jarName)
    const maxMem = process.env.MINECRAFT_MAX_MEMORY ?? '2G'
    const minMem = process.env.MINECRAFT_MIN_MEMORY ?? '512M'
    const javaPath = process.env.MINECRAFT_JAVA_PATH ?? 'java'
    if (!fs.existsSync(jarPath)) {
      return { success: false, message: `Server JAR not found: ${jarPath}` }
    }
    cmd = javaPath
    args = [`-Xmx${maxMem}`, `-Xms${minMem}`, '-jar', jarName, '--nogui']
  }

  state.status = 'starting'
  addLog(`[Panel] Starting ${type} server...`)

  const proc = spawn(cmd, args, { cwd: serverDir, stdio: ['pipe', 'pipe', 'pipe'] })

  state.process = proc

  const handleOutput = (data: Buffer) => {
    const text = data.toString()
    for (const line of text.split('\n')) {
      const trimmed = line.trimEnd()
      if (!trimmed) continue
      addLog(trimmed)
      const online =
        type === 'bedrock'
          ? trimmed.includes('Server started.')
          : trimmed.includes('Done (') && trimmed.includes('For help')
      if (online) state.status = 'online'
    }
  }

  proc.stdout.on('data', handleOutput)
  proc.stderr.on('data', handleOutput)

  proc.on('close', (code) => {
    addLog(`[Panel] Server process exited (code ${code ?? 'null'})`)
    state.process = null
    state.status = 'offline'
  })

  proc.on('error', (err) => {
    addLog(`[Panel] Failed to start server: ${err.message}`)
    state.process = null
    state.status = 'offline'
  })

  return { success: true, message: 'Server is starting...' }
}

function safeWrite(text: string): boolean {
  try {
    if (state.process && state.process.stdin.writable) {
      state.process.stdin.write(text)
      return true
    }
  } catch {
    addLog('[Panel] Failed to write to server stdin')
  }
  return false
}

export function stopServer(): { success: boolean; message: string } {
  if (!state.process || state.status === 'offline') {
    return { success: false, message: 'Server is not running' }
  }
  state.status = 'stopping'
  addLog('[Panel] Stopping server...')
  safeWrite('stop\n')

  // Force kill if server doesn't stop within 30 seconds
  const proc = state.process
  const killTimeout = setTimeout(() => {
    if (state.process === proc && state.status === 'stopping') {
      addLog('[Panel] Server did not stop gracefully, force killing...')
      proc.kill('SIGKILL')
    }
  }, 30000)

  proc.once('close', () => clearTimeout(killTimeout))

  return { success: true, message: 'Stop command sent' }
}

export function restartServer(): { success: boolean; message: string } {
  if (state.status === 'offline' || !state.process) {
    return startServer()
  }
  addLog('[Panel] Restarting server...')
  state.status = 'stopping'
  const proc = state.process
  safeWrite('stop\n')

  // Force kill if server doesn't stop within 30 seconds
  const killTimeout = setTimeout(() => {
    if (state.process === proc && state.status === 'stopping') {
      addLog('[Panel] Server did not stop gracefully, force killing...')
      proc.kill('SIGKILL')
    }
  }, 30000)

  proc.once('close', () => {
    clearTimeout(killTimeout)
    setTimeout(() => startServer(), 2000)
  })
  return { success: true, message: 'Restart initiated' }
}

export function sendCommand(command: string): { success: boolean; message: string } {
  if (!state.process || state.status !== 'online') {
    return { success: false, message: 'Server is not online' }
  }
  // Strip newlines to prevent command injection, limit length
  const sanitized = command.replace(/[\r\n]/g, '').substring(0, 256).trim()
  if (!sanitized) {
    return { success: false, message: 'Command cannot be empty' }
  }
  if (!safeWrite(sanitized + '\n')) {
    return { success: false, message: 'Failed to send command' }
  }
  addLog(`> ${sanitized}`)
  return { success: true, message: 'Command sent' }
}
