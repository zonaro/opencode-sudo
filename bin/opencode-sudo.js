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
import { ensureAskpassHelper } from "../src/helper.js"
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
 * Verify the env-based mechanism end-to-end: ensure the vault holds a
 * password, ensure the persistent helper, then prove that plain `sudo`
 * (no `-A`) picks it up via `SUDO_ASKPASS` in a non-tty child.
 * @returns {void}
 */
function commandTest() {
  let password = getPassword()
  if (!password) {
    const fallback = process.env.sudo_password
    if (fallback) {
      try {
        setPassword(fallback)
        password = fallback
      } catch (error) {
        exit(`error: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  if (!password) exit("error: no stored password and $sudo_password is unset")

  const helper = ensureAskpassHelper()

  spawnSync("sudo", ["-k"], { stdio: "ignore" })

  /** @param {string[]} args */
  const runWhoami = (args) => {
    const result = spawnSync("sudo", args, {
      env: { ...process.env, SUDO_ASKPASS: helper },
      encoding: "utf8",
    })
    return (result.stdout || "").trim()
  }

  // Plain sudo first: in a non-tty child this must use SUDO_ASKPASS on its
  // own. The -A variant is checked too as a belt-and-braces fallback.
  const plain = runWhoami(["whoami"])
  const explicit = runWhoami(["-A", "whoami"])

  if (plain.includes("root") && explicit.includes("root")) {
    process.stdout.write("OK — sudo accepted the stored password via SUDO_ASKPASS (whoami: root)\n")
  } else {
    if (!plain.includes("root")) {
      process.stdout.write(`FAILED: plain "sudo whoami" did not return root (got: ${JSON.stringify(plain)})\n`)
    }
    if (!explicit.includes("root")) {
      process.stdout.write(`FAILED: "sudo -A whoami" did not return root (got: ${JSON.stringify(explicit)})\n`)
    }
    process.exit(1)
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
