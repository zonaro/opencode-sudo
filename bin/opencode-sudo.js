#!/usr/bin/env node
/**
 * opencode-sudo CLI — configure the encrypted sudo vault.
 *
 *   opencode-sudo set                 Prompt for the password (hidden input).
 *   opencode-sudo set --from-env [V]  Read it from $V (default: sudo_password).
 *   opencode-sudo status              Show vault metadata.
 *   opencode-sudo test                Verify sudo works with the stored secret.
 *   opencode-sudo clear               Remove the vault and keystore.
 *
 * @module opencode-sudo/cli
 */
import { spawnSync } from "node:child_process"
import readline from "node:readline"
import { buildAskpassHelper, removeAskpassHelper } from "../src/askpass.js"
import { clearVault, getPassword, setPassword, vaultInfo } from "../src/vault.js"

const USAGE = `opencode-sudo — encrypted sudo credentials for opencode

Usage:
  opencode-sudo set [--from-env [VAR]]   Store the password (hidden prompt, or env var)
  opencode-sudo status                   Show vault metadata
  opencode-sudo test                     Verify sudo works with the stored password
  opencode-sudo clear                    Delete the vault
  opencode-sudo help                     Show this help

Environment:
  OPENCODE_SUDO_HOME   Vault directory (default: ~/.config/opencode/opencode-sudo)
`

/** @param {string} query @returns {Promise<string>} */
function promptHidden(query) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const restore = () => {
      if (process.stdin.isTTY) {
        spawnSync("stty", ["echo"], { stdio: ["inherit", "ignore", "ignore"] })
      }
    }
    const done = (value) => {
      restore()
      process.stdout.write("\n")
      rl.close()
      resolve(value)
    }
    const fail = (error) => {
      restore()
      rl.close()
      reject(error)
    }

    rl.on("SIGINT", () => fail(new Error("aborted")))

    if (process.stdin.isTTY) {
      spawnSync("stty", ["-echo"], { stdio: ["inherit", "ignore", "ignore"] })
    }
    process.stdout.write(query)
    rl.question("", done)
  })
}

/**
 * @param {string} message
 * @param {number} [code]
 * @returns {never}
 */
function exit(message, code = 1) {
  process.stderr.write(`${message}\n`)
  process.exit(code)
}

/**
 * @param {string} [envName]
 * @returns {Promise<void>}
 */
async function commandSet(envName) {
  let password
  if (envName !== undefined) {
    const name = envName || "sudo_password"
    password = process.env[name]
    if (!password) exit(`error: environment variable ${name} is empty or unset`)
  } else {
    const first = await promptHidden("New sudo password: ")
    if (!first) exit("error: empty password, nothing stored")
    const second = await promptHidden("Confirm password:   ")
    if (first !== second) exit("error: passwords do not match")
    password = first
  }

  try {
    const result = setPassword(password)
    process.stdout.write(`Vault updated: ${result.updatedAt}\n`)
    process.stdout.write(`Location:      ${vaultInfo().home}\n`)
  } catch (error) {
    exit(`error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function commandStatus() {
  const info = vaultInfo()
  if (!info.exists) {
    process.stdout.write("No vault configured.\n")
    process.stdout.write(`Expected location: ${info.home}\n`)
    process.stdout.write("Run `opencode-sudo set` to create one.\n")
    return
  }
  process.stdout.write(`Vault:        ${info.home}\n`)
  process.stdout.write(`Configured:   ${info.configured ? "yes" : "NO (cannot decrypt — foreign machine or keystore missing)"}\n`)
  process.stdout.write(`Cipher:       ${info.cipher} (${info.kdf})\n`)
  process.stdout.write(`Binding:      ${JSON.stringify(info.binding)}\n`)
  process.stdout.write(`Updated:      ${info.updatedAt}\n`)
}

/**
 * Run `sudo -A whoami` using a temporary askpass helper.
 * @returns {void}
 */
function commandTest() {
  const password = getPassword() || process.env.sudo_password
  if (!password) exit("error: no stored password and $sudo_password is unset")

  const helper = buildAskpassHelper(password, "cli", String(process.pid))
  try {
    const result = spawnSync("sudo", ["-A", "-p", "", "whoami"], {
      env: { ...process.env, SUDO_ASKPASS: helper.path },
      encoding: "utf8",
    })
    const out = (result.stdout || "").trim()
    if (result.status === 0 && out === "root") {
      process.stdout.write("OK — sudo accepted the stored password (whoami: root)\n")
    } else {
      process.stdout.write(`FAILED (exit ${result.status})\n`)
      if (result.stderr) process.stdout.write(result.stderr)
      process.exit(1)
    }
  } finally {
    removeAskpassHelper(helper.path)
  }
}

function commandClear() {
  const removed = clearVault()
  process.stdout.write(removed ? "Vault removed.\n" : "Nothing to remove.\n")
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)

  switch (command) {
    case "set": {
      const fromEnvIndex = rest.indexOf("--from-env")
      if (fromEnvIndex !== -1) {
        await commandSet(rest[fromEnvIndex + 1] ?? "")
      } else {
        await commandSet(undefined)
      }
      return
    }
    case "status":
      commandStatus()
      return
    case "test":
      commandTest()
      return
    case "clear":
      commandClear()
      return
    case "help":
    case "--help":
    case "-h":
    case undefined:
      process.stdout.write(USAGE)
      return
    default:
      exit(`error: unknown command "${command}"\n\n${USAGE}`)
  }
}

main().catch((error) => exit(`error: ${error instanceof Error ? error.message : String(error)}`))
