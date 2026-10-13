/**
 * Vault tests: encryption round-trip, machine binding and teardown.
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

// Point the vault at a throwaway directory before importing the module.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-sudo-vault-"))
process.env.OPENCODE_SUDO_HOME = home

const vault = await import("../src/vault.js")
const paths = await import("../src/paths.js")

test.after(() => {
  fs.rmSync(home, { recursive: true, force: true })
})

test("no vault is configured initially", () => {
  assert.equal(vault.vaultExists(), false)
  assert.equal(vault.getPassword(), null)
  assert.equal(vault.vaultInfo().configured, false)
})

test("store and read back a password", () => {
  vault.setPassword("s3cr3t-with'quote\"and $dollar")
  assert.equal(vault.vaultExists(), true)
  assert.equal(vault.getPassword(), "s3cr3t-with'quote\"and $dollar")
  assert.equal(vault.vaultInfo().configured, true)
})

test("vault file is owner-only", () => {
  const mode = fs.statSync(paths.vaultPath()).mode & 0o777
  assert.equal(mode, 0o600)
})

test("password is not stored in plaintext", () => {
  const raw = fs.readFileSync(paths.vaultPath(), "utf8")
  assert.ok(!raw.includes("s3cr3t"), "ciphertext must not contain the password")
  assert.ok(raw.includes("aes-256-gcm"))
})

test("a copied vault without the keystore cannot be decrypted", () => {
  const keystore = fs.readFileSync(paths.keystorePath(), "utf8")
  fs.rmSync(paths.keystorePath(), { force: true })
  assert.equal(vault.getPassword(), null)
  fs.writeFileSync(paths.keystorePath(), keystore, { mode: 0o600 })
  assert.equal(vault.getPassword(), "s3cr3t-with'quote\"and $dollar")
})

test("tampered ciphertext fails authentication", () => {
  const original = JSON.parse(fs.readFileSync(paths.vaultPath(), "utf8"))
  const tampered = { ...original, data: Buffer.from("tampered").toString("base64") }
  fs.writeFileSync(paths.vaultPath(), JSON.stringify(tampered), { mode: 0o600 })
  assert.equal(vault.getPassword(), null)
  fs.writeFileSync(paths.vaultPath(), JSON.stringify(original), { mode: 0o600 })
  assert.equal(vault.getPassword(), "s3cr3t-with'quote\"and $dollar")
})

test("empty and multiline passwords are rejected", () => {
  assert.throws(() => vault.setPassword(""))
  assert.throws(() => vault.setPassword("line1\nline2"))
})

test("clear removes the vault", () => {
  assert.equal(vault.clearVault(), true)
  assert.equal(vault.vaultExists(), false)
  assert.equal(vault.getPassword(), null)
  assert.equal(vault.clearVault(), false)
})
