/**
 * Inject tests: which `sudo` tokens get rewritten, and which must be left
 * untouched.
 */
import assert from "node:assert/strict"
import test from "node:test"

import { findSudoTokens, maskNonCode, rewriteSudo } from "../src/inject.js"

const HELPER = "/tmp/askpass.sh"

/** @param {string} command */
const count = (command) => findSudoTokens(command).length

test("rewrites a leading sudo", () => {
  const result = rewriteSudo("sudo apt-get update", HELPER)
  assert.equal(result.changed, true)
  assert.equal(result.count, 1)
  assert.equal(result.command, `SUDO_ASKPASS='${HELPER}' sudo -A apt-get update`)
})

test("does not rewrite sudo used as an argument", () => {
  assert.equal(count("echo sudo"), 0)
  assert.equal(count("which sudo"), 0)
  assert.equal(rewriteSudo("echo sudo", HELPER).changed, false)
})

test("does not rewrite sudo inside quotes", () => {
  assert.equal(count('echo "sudo rm -rf /"'), 0)
  assert.equal(count("echo 'sudo reboot'"), 0)
})

test("ignores sudo in a comment", () => {
  assert.equal(count("# sudo rm -rf /\nls"), 0)
})

test("rewrites sudo after a separator", () => {
  assert.equal(count("ls; sudo reboot"), 1)
  assert.equal(count("make && sudo make install"), 1)
  assert.equal(count("false || sudo true"), 1)
})

test("rewrites sudo inside a pipeline", () => {
  assert.equal(count("cat file | sudo tee /etc/target"), 1)
  const result = rewriteSudo("cat file | sudo tee /etc/target", HELPER)
  assert.equal(result.command, `cat file | SUDO_ASKPASS='${HELPER}' sudo -A tee /etc/target`)
})

test("rewrites sudo with a leading env assignment", () => {
  assert.equal(count("DEBIAN_FRONTEND=noninteractive sudo apt-get install -y x"), 1)
})

test("rewrites multiple sudo invocations", () => {
  const result = rewriteSudo("sudo a; sudo b && sudo c", HELPER)
  assert.equal(result.count, 3)
  assert.equal(result.command.split("sudo -A").length - 1, 3)
})

test("handles an absolute path to sudo", () => {
  assert.equal(count("/usr/bin/sudo ls"), 1)
})

test("does not double-inject an already rewritten command", () => {
  const once = rewriteSudo("sudo ls", HELPER).command
  const twice = rewriteSudo(once, HELPER)
  assert.equal(twice.changed, false)
  assert.equal(twice.command, once)
})

test("quotes a helper path containing a quote", () => {
  const result = rewriteSudo("sudo ls", "/weird/it's here.sh")
  assert.ok(result.command.includes(`'/weird/it'\\''s here.sh'`))
})

test("maskNonCode preserves string length", () => {
  const input = 'ls "a b" # x\nsudo'
  assert.equal(maskNonCode(input).length, input.length)
})
