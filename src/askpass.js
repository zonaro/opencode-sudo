/**
 * Askpass helper management.
 *
 * sudo fetches the password by executing the program named by `SUDO_ASKPASS`
 * and reading its standard output. We generate a tiny, owner-only script for
 * each command that embeds the password, so the secret never appears on a
 * command line and the script can be deleted as soon as the command finishes.
 *
 * @module opencode-sudo/askpass
 */
import fs from "node:fs"
import path from "node:path"
import { ensureDir, runtimeDir } from "./paths.js"
import { safeName, shellQuote } from "./util.js"

/** Runtime helpers older than this are considered stale and get removed. */
const STALE_MS = 24 * 60 * 60 * 1000

/**
 * Create an askpass helper that prints the password to stdout.
 *
 * @param {string} password
 * @param {string} sessionID
 * @param {string} callID
 * @returns {{ path: string }}
 */
export function buildAskpassHelper(password, sessionID, callID) {
  const dir = ensureDir(runtimeDir(), 0o700)
  const file = path.join(dir, `askpass-${safeName(sessionID)}-${safeName(callID)}.sh`)
  const script = `#!/bin/sh\nprintf '%s\\n' ${shellQuote(password)}\n`
  fs.writeFileSync(file, script, { mode: 0o700 })
  try {
    fs.chmodSync(file, 0o700)
  } catch {
    // Best effort.
  }
  return { path: file }
}

/**
 * Remove a helper script.
 * @param {string} file
 * @returns {void}
 */
export function removeAskpassHelper(file) {
  if (!file) return
  try {
    fs.rmSync(file, { force: true })
  } catch {
    // Best effort.
  }
}

/**
 * Remove helper scripts left behind by a previous, unclean shutdown.
 * @returns {Promise<void>}
 */
export async function cleanupRuntime() {
  const dir = runtimeDir()
  let entries
  try {
    entries = await fs.promises.readdir(dir)
  } catch {
    return
  }
  const now = Date.now()
  await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(dir, entry)
      try {
        const stat = await fs.promises.stat(file)
        if (now - stat.mtimeMs > STALE_MS) await fs.promises.rm(file, { force: true })
      } catch {
        // Ignore entries that disappear mid-scan.
      }
    }),
  )
}
