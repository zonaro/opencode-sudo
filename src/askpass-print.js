/**
 * Password emitter for the persistent `SUDO_ASKPASS` helper.
 *
 * This module has two uses:
 *
 *   1. Run standalone — `node src/askpass-print.js` — which is how `sudo`
 *      invokes it through the tiny POSIX sh wrapper created by
 *      `src/helper.js`. It decrypts the vault password and writes it to
 *      stdout with **no trailing newline**, then exits 0. On any error
 *      (no vault, undecryptable) it prints nothing and exits 1.
 *   2. Imported — `import { printAskpassPassword } from "./askpass-print.js"`
 *      — in which case nothing runs as a side effect; call the function
 *      explicitly.
 *
 * @module opencode-sudo/askpass-print
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getPassword } from "./vault.js"

/**
 * Decrypt the vault password and write it to stdout with no trailing
 * newline. Prints nothing and returns 1 when unavailable.
 * @returns {number} Process exit code (0 on success, 1 on failure).
 */
export function printAskpassPassword() {
  let password = null
  try {
    password = getPassword()
  } catch {
    password = null
  }
  if (typeof password !== "string" || password.length === 0) return 1
  process.stdout.write(password)
  return 0
}

/** @returns {boolean} Whether this file is the process entry point. */
function isMain() {
  try {
    const self = path.resolve(fileURLToPath(import.meta.url))
    const entry = process.argv[1] ? path.resolve(process.argv[1]) : ""
    return entry !== "" && self === entry
  } catch {
    return false
  }
}

if (isMain()) {
  process.exit(printAskpassPassword())
}
