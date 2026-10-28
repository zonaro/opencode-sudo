/**
 * opencode-sudo — OpenCode 2 (v2) plugin that makes plain `sudo` work inside
 * opencode's non-tty shells.
 *
 * Mechanism: in a non-tty environment `sudo` automatically uses the helper
 * named by the `SUDO_ASKPASS` environment variable, so the plugin only has
 * to export `SUDO_ASKPASS` pointing at a persistent, owner-only wrapper
 * that decrypts the machine-bound vault. No command rewriting, no password
 * on any command line.
 *
 * Password priority: `password` option > vault password > env var named by
 * `passwordEnv` (default `sudo_password`). An option/env password is stored
 * into the vault (idempotent) so the helper can always decrypt it from the
 * vault alone. With no password source the plugin stays inert.
 *
 * @module opencode-sudo
 */
import { ensureAskpassHelper } from "./helper.js"
import { getPassword, setPassword } from "./vault.js"
import { readBridgePassword } from "./bridge.js"

/** @type {string} */
const PLUGIN_ID = "opencode-sudo"

const AGENT_HINT =
  "sudo is handled automatically by the opencode-sudo plugin " +
  "(password supplied via SUDO_ASKPASS). " +
  "Use plain `sudo <cmd>`. " +
  "Never use `sudo -n` (bypasses the askpass helper) and never type passwords yourself."

/**
 * @typedef {object} SudoOptions
 * @property {string} [password]     Literal password (highest priority).
 * @property {string} [passwordEnv]  Env var used as fallback (default `sudo_password`).
 * @property {boolean} [enabled]     Master switch (default `true`).
 */

/**
 * V2 plugin setup: resolve the password, persist it to the vault, ensure
 * the helper, and export `SUDO_ASKPASS` for the server lifetime.
 * @param {{ options?: SudoOptions, agent?: any }} ctx
 * @returns {Promise<void>}
 */
async function setup(ctx) {
  const options = (ctx && ctx.options) || {}
  if (options.enabled === false) return

  const passwordEnv =
    typeof options.passwordEnv === "string" && options.passwordEnv.length > 0
      ? options.passwordEnv
      : "sudo_password"
  const optionPassword =
    typeof options.password === "string" && options.password.length > 0 ? options.password : null

  /** @type {string | null} */
  let vaultPassword = null
  try {
    vaultPassword = getPassword()
  } catch {
    vaultPassword = null
  }

  const envPassword =
    passwordEnv && typeof process.env[passwordEnv] === "string" && process.env[passwordEnv]
      ? process.env[passwordEnv]
      : null

  // Senha configurada pela extensão OpenChamber (escrita no arquivo de ponte).
  const bridgePassword = readBridgePassword()

  const resolved = optionPassword || bridgePassword || vaultPassword || envPassword || null
  if (typeof resolved !== "string" || resolved.length === 0) return

  // Persist an option/env password into the vault so the helper — which
  // only ever reads the vault — can decrypt it. Idempotent.
  if (resolved !== vaultPassword) {
    try {
      setPassword(resolved)
    } catch {
      // Best effort; fall through to the readability check below.
    }
    try {
      if (getPassword() == null) return
    } catch {
      return
    }
  }

  let helper = null
  try {
    helper = ensureAskpassHelper()
  } catch {
    return
  }
  process.env.SUDO_ASKPASS = helper

  // Defensive agent hint: append a short note to every agent exposing a
  // string `system` prompt. Never crash setup when shapes differ.
  try {
    const agent = ctx ? ctx.agent : null
    if (agent && typeof agent.transform === "function") {
      await agent.transform((draft) => {
        try {
          const ids = typeof draft.list === "function" ? draft.list() : []
          for (const id of ids || []) {
            try {
              draft.update(id, (entry) => {
                if (
                  entry &&
                  typeof entry.system === "string" &&
                  !entry.system.includes("opencode-sudo")
                ) {
                  entry.system += `\n\n${AGENT_HINT}`
                }
              })
            } catch {
              // Ignore agents we cannot update.
            }
          }
        } catch {
          // Ignore draft shape mismatches.
        }
      })
    }
  } catch {
    // Agent hints must never break the plugin.
  }
}

export default { id: PLUGIN_ID, setup }
