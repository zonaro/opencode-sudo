/**
 * Helper tests: persistent askpass wrapper + password emitter.
 */
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

// Point the vault at a throwaway directory before importing the modules.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-sudo-helper-"))
process.env.OPENCODE_SUDO_HOME = home

const vault = await import("../src/vault.js")
const helper = await import("../src/helper.js")

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PRINT_SCRIPT = path.join(HERE, "..", "src", "askpass-print.js")
const PASSWORD = "s3cr3t-with'quote\"and $dollar"

test.after(() => {
  fs.rmSync(home, { recursive: true, force: true })
})

test("ensureAskpassHelper creates an owner-only POSIX wrapper", () => {
  vault.setPassword(PASSWORD)
  const helperPath = helper.ensureAskpassHelper()
  assert.equal(helperPath, helper.askpassHelperPath())
  assert.ok(fs.existsSync(helperPath))

  const mode = fs.statSync(helperPath).mode & 0o777
  assert.equal(mode, 0o700)

  const content = fs.readFileSync(helperPath, "utf8")
  assert.ok(content.startsWith("#!/bin/sh"), "helper must be a POSIX sh script")
  assert.ok(content.includes("askpass-print.js"), "helper must delegate to askpass-print.js")

  // Idempotent: a second call returns the same path.
  assert.equal(helper.ensureAskpassHelper(), helperPath)
})

test("askpass-print emits the password with no trailing newline", () => {
  const result = spawnSync(process.execPath, [PRINT_SCRIPT], {
    env: { ...process.env, OPENCODE_SUDO_HOME: home },
  })
  assert.equal(result.status, 0)
  assert.ok(Buffer.isBuffer(result.stdout) || result.stdout instanceof Uint8Array)
  assert.deepEqual(Buffer.from(result.stdout), Buffer.from(PASSWORD))
  assert.notEqual(result.stdout[result.stdout.length - 1], 0x0a)
})

test("askpass-print exits 1 with empty stdout on a corrupt vault", () => {
  const vaultFile = path.join(home, "vault.json")
  const original = fs.readFileSync(vaultFile, "utf8")
  try {
    fs.writeFileSync(vaultFile, JSON.stringify({ version: 1, garbage: true }), { mode: 0o600 })
    const result = spawnSync(process.execPath, [PRINT_SCRIPT], {
      env: { ...process.env, OPENCODE_SUDO_HOME: home },
    })
    assert.equal(result.status, 1)
    assert.equal(Buffer.from(result.stdout || []).length, 0)
  } finally {
    fs.writeFileSync(vaultFile, original, { mode: 0o600 })
  }
  // Sanity: the restored vault decrypts again.
  assert.equal(vault.getPassword(), PASSWORD)
})
