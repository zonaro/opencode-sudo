/**
 * Encrypted, machine-bound storage for the sudo password.
 *
 * The password is encrypted with AES-256-GCM. The encryption key is derived
 * with scrypt from two inputs:
 *
 *   1. a machine fingerprint (hostname + username + uid + home + machine-id),
 *   2. a random 32-byte secret kept in a separate `keystore.json` file.
 *
 * Both the salt and the keystore secret live alongside the vault, but the
 * key also depends on the machine fingerprint. As a result the vault can only
 * be decrypted by the same opencode install on the same machine and user; a
 * copied `vault.json` alone is useless.
 *
 * @module opencode-sudo/vault
 */
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import { ensureDir, keystorePath, readJsonSync, sudoHome, vaultPath, writeJsonSync } from "./paths.js"

/** AES-GCM additional authenticated data — ties ciphertext to this format. */
const AAD = Buffer.from("opencode-sudo:v1")

/** scrypt parameters: N=2^15, r=8, p=1 (interactive-grade, ~30-60ms). */
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }

const KEY_BYTES = 32
const SALT_BYTES = 32
const IV_BYTES = 12

/**
 * Read the platform machine id when available.
 * @returns {string}
 */
function machineId() {
  for (const file of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      const value = fs.readFileSync(file, "utf8").trim()
      if (value) return value
    } catch {
      // Ignore missing/unreadable files.
    }
  }
  return ""
}

/**
 * Build the stable, machine-specific portion of the key material.
 * @returns {string}
 */
function machineFingerprint() {
  let username = ""
  try {
    username = os.userInfo().username
  } catch {
    username = process.env.USER || process.env.LOGNAME || ""
  }
  const parts = [
    "opencode-sudo",
    os.hostname(),
    username,
    String(typeof process.getuid === "function" ? process.getuid() : ""),
    os.homedir(),
    machineId(),
  ]
  return parts.join("\u0000")
}

/**
 * Read the keystore secret, creating it on first use.
 * @returns {{ secret: string }}
 */
function ensureKeystore() {
  const existing = readJsonSync(keystorePath())
  if (existing && typeof existing.secret === "string" && existing.secret.length > 0) {
    return existing
  }
  const value = {
    version: 1,
    secret: crypto.randomBytes(KEY_BYTES).toString("base64"),
    createdAt: new Date().toISOString(),
  }
  writeJsonSync(keystorePath(), value, 0o600)
  return value
}

/**
 * Derive the AES key from the machine fingerprint and the keystore secret.
 * @param {Buffer} salt
 * @param {string} keystoreSecret
 * @returns {Buffer}
 */
function deriveKey(salt, keystoreSecret) {
  const material = `${machineFingerprint()}\u0000${keystoreSecret}`
  return crypto.scryptSync(material, salt, KEY_BYTES, SCRYPT)
}

/** @returns {boolean} Whether a vault file exists. */
export function vaultExists() {
  return fs.existsSync(vaultPath())
}

/**
 * Encrypt and persist the sudo password.
 * @param {string} password
 * @returns {{ updatedAt: string }}
 */
export function setPassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("opencode-sudo: password must be a non-empty string")
  }
  if (password.includes("\n") || password.includes("\r")) {
    throw new Error("opencode-sudo: password must not contain line breaks")
  }

  ensureDir(sudoHome(), 0o700)
  const keystore = ensureKeystore()
  const salt = crypto.randomBytes(SALT_BYTES)
  const iv = crypto.randomBytes(IV_BYTES)
  const key = deriveKey(salt, keystore.secret)

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  cipher.setAAD(AAD)
  const data = Buffer.concat([cipher.update(password, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()

  const now = new Date().toISOString()
  const previous = readJsonSync(vaultPath())
  const vault = {
    version: 1,
    cipher: "aes-256-gcm",
    kdf: {
      name: "scrypt",
      N: SCRYPT.N,
      r: SCRYPT.r,
      p: SCRYPT.p,
      salt: salt.toString("base64"),
    },
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: data.toString("base64"),
    binding: {
      hostname: os.hostname(),
      username: (() => {
        try {
          return os.userInfo().username
        } catch {
          return process.env.USER || ""
        }
      })(),
      uid: typeof process.getuid === "function" ? process.getuid() : null,
    },
    createdAt: previous && previous.createdAt ? previous.createdAt : now,
    updatedAt: now,
  }

  writeJsonSync(vaultPath(), vault, 0o600)
  return { updatedAt: now }
}

/**
 * Decrypt and return the stored password.
 * @returns {string | null} The password, or null when absent/undecryptable.
 */
export function getPassword() {
  const vault = readJsonSync(vaultPath())
  if (!vault || !vault.kdf || !vault.iv || !vault.tag || !vault.data) return null

  const keystore = readJsonSync(keystorePath())
  if (!keystore || typeof keystore.secret !== "string") return null

  try {
    const salt = Buffer.from(vault.kdf.salt, "base64")
    const iv = Buffer.from(vault.iv, "base64")
    const tag = Buffer.from(vault.tag, "base64")
    const data = Buffer.from(vault.data, "base64")
    const key = deriveKey(salt, keystore.secret)
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv)
    decipher.setAAD(AAD)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(data), decipher.final()])
    return plain.toString("utf8")
  } catch {
    return null
  }
}

/**
 * Describe the vault without revealing the password.
 * @returns {{
 *   exists: boolean,
 *   configured: boolean,
 *   home: string,
 *   version?: number,
 *   cipher?: string,
 *   kdf?: string,
 *   binding?: any,
 *   createdAt?: string | null,
 *   updatedAt?: string | null,
 * }}
 */
export function vaultInfo() {
  const vault = readJsonSync(vaultPath())
  if (!vault) {
    return { exists: false, configured: false, home: sudoHome() }
  }
  const decryptable = getPassword() !== null
  return {
    exists: true,
    configured: decryptable,
    home: sudoHome(),
    version: vault.version,
    cipher: vault.cipher,
    kdf: vault.kdf?.name,
    binding: vault.binding ?? null,
    createdAt: vault.createdAt ?? null,
    updatedAt: vault.updatedAt ?? null,
  }
}

/**
 * Securely remove the vault and the keystore.
 * @returns {boolean} Whether anything was removed.
 */
export function clearVault() {
  let removed = false
  for (const file of [vaultPath(), keystorePath()]) {
    try {
      if (!fs.existsSync(file)) continue
      const size = Math.max(fs.statSync(file).size, 1)
      fs.writeFileSync(file, crypto.randomBytes(size))
      fs.rmSync(file, { force: true })
      removed = true
    } catch {
      // Ignore files we cannot remove.
    }
  }
  return removed
}
