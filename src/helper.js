/**
 * Persistent `SUDO_ASKPASS` helper management.
 *
 * In a non-tty environment (which is how opencode's bash tool runs), `sudo`
 * automatically uses the helper named by the `SUDO_ASKPASS` environment
 * variable — no `-A` flag, no command rewriting. The plugin therefore only
 * needs to:
 *
 *   1. make sure a tiny, owner-only POSIX sh wrapper exists at
 *      `<sudoHome>/askpass`, delegating to `src/askpass-print.js`, which
 *      decrypts the machine-bound vault and prints the password, and
 *   2. export its path as `process.env.SUDO_ASKPASS` for the server
 *      lifetime (child shells inherit it).
 *
 * @module opencode-sudo/helper
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ensureDir, sudoHome } from "./paths.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.dirname(HERE)

/** @returns {string} Absolute path of the password-emitting Node script. */
export function askpassPrintScript() {
  return path.join(REPO_ROOT, "src", "askpass-print.js")
}

/** @returns {string} Absolute path of the persistent helper wrapper. */
export function askpassHelperPath() {
  return path.join(sudoHome(), "askpass")
}

/**
 * Ensure the persistent askpass helper exists (mode 0700) and return its
 * path. Idempotent: rewrites the file every call so a moved repo or a
 * stale wrapper self-heals.
 * @returns {string} Absolute helper path.
 */
export function ensureAskpassHelper() {
  const helper = askpassHelperPath()
  ensureDir(path.dirname(helper), 0o700)
  const script = askpassPrintScript().replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  const content = `#!/bin/sh\nexec node "${script}"\n`
  fs.writeFileSync(helper, content, { mode: 0o700 })
  try {
    fs.chmodSync(helper, 0o700)
  } catch {
    // Best effort: some filesystems ignore chmod.
  }
  return helper
}
