/**
 * Filesystem locations used by opencode-sudo.
 * @module opencode-sudo/paths
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * Root directory that holds the vault and its runtime scratch space.
 * Override with the `OPENCODE_SUDO_HOME` environment variable.
 * @returns {string}
 */
export function sudoHome() {
  const override = process.env.OPENCODE_SUDO_HOME
  const base =
    override && override.trim()
      ? override
      : path.join(os.homedir(), ".config", "opencode", "opencode-sudo")
  return path.resolve(base)
}

/** @returns {string} Absolute path of the encrypted vault file. */
export function vaultPath() {
  return path.join(sudoHome(), "vault.json")
}

/** @returns {string} Absolute path of the local keystore file. */
export function keystorePath() {
  return path.join(sudoHome(), "keystore.json")
}

/** @returns {string} Directory holding transient askpass helpers. */
export function runtimeDir() {
  return path.join(sudoHome(), "runtime")
}

/**
 * Create a directory (recursively) and force its mode.
 * @param {string} dir
 * @param {number} [mode]
 * @returns {string}
 */
export function ensureDir(dir, mode = 0o700) {
  fs.mkdirSync(dir, { recursive: true, mode })
  try {
    fs.chmodSync(dir, mode)
  } catch {
    // Best effort: some filesystems ignore chmod.
  }
  return dir
}

/**
 * Read and parse a JSON file, returning null when it is missing or corrupt.
 * @param {string} file
 * @returns {any | null}
 */
export function readJsonSync(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return null
  }
}

/**
 * Atomically write a JSON file with a restrictive mode.
 * @param {string} file
 * @param {unknown} value
 * @param {number} [mode]
 */
export function writeJsonSync(file, value, mode = 0o600) {
  ensureDir(path.dirname(file), 0o700)
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode })
  fs.renameSync(tmp, file)
  try {
    fs.chmodSync(file, mode)
  } catch {
    // Best effort.
  }
}
