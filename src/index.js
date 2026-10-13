/**
 * opencode-sudo — automatic sudo credential injection for opencode.
 *
 * The plugin hooks the `bash` tool, detects commands that invoke `sudo`, and
 * rewrites them to source the password from an askpass helper backed by the
 * encrypted vault. The password is never written to the command line.
 *
 * @module opencode-sudo
 */
import { buildAskpassHelper, cleanupRuntime, removeAskpassHelper } from "./askpass.js"
import { rewriteSudo } from "./inject.js"
import { getPassword, vaultInfo } from "./vault.js"

/**
 * @typedef {object} SudoOptions
 * @property {string} [password]         Literal password (highest priority).
 * @property {string} [passwordEnv]      Env var used as fallback (default `sudo_password`).
 * @property {boolean} [enabled]         Master switch (default `true`).
 * @property {boolean} [systemPromptHint] Tell the model sudo is available (default `true`).
 * @property {boolean} [hintOnPermissionError] Append a hint on permission failures (default `true`).
 */

/** @type {Required<Omit<SudoOptions, "password">>} */
const DEFAULTS = {
  passwordEnv: "sudo_password",
  enabled: true,
  systemPromptHint: true,
  hintOnPermissionError: true,
}

const SYSTEM_HINT = [
  "## sudo handling (opencode-sudo)",
  "Elevated commands are handled automatically. When a task needs root, run the command prefixed with `sudo` (for example `sudo apt-get install -y pkg`).",
  "Do NOT type a password and do NOT use `sudo -S` with a password: the plugin injects the stored credential through an askpass helper.",
  "Avoid `sudo -n`, which disables the password prompt and defeats the helper.",
].join("\n")

/** Output patterns that mean "this may have needed root". */
const PERMISSION_ERROR = /(permission denied|operation not permitted|are you root|eacces|eperm|not permitted)/i

const PASSWORD_CACHE_MS = 30_000

/**
 * Build the plugin hooks.
 *
 * @param {import("@opencode-ai/plugin").PluginInput} input
 * @param {SudoOptions} [options]
 * @returns {Promise<import("@opencode-ai/plugin").Hooks>}
 */
export const SudoPlugin = async (input, options) => {
  const opts = { ...DEFAULTS, ...(options || {}) }
  const client = input && input.client

  /**
   * @param {"debug" | "info" | "warn" | "error"} level
   * @param {string} message
   * @param {Record<string, unknown>} [extra]
   */
  const log = async (level, message, extra) => {
    try {
      await client?.app?.log?.({ body: { service: "opencode-sudo", level, message, extra } })
    } catch {
      // Logging must never break command execution.
    }
  }

  cleanupRuntime().catch(() => {})

  /** @type {string | null} */
  let cache = null
  let cacheAt = 0

  /**
   * Resolve the password: literal option > vault > environment fallback.
   * @returns {Promise<string | null>}
   */
  const resolvePassword = async () => {
    if (opts.password) return opts.password
    const now = Date.now()
    if (cache && now - cacheAt < PASSWORD_CACHE_MS) return cache
    const fromVault = getPassword()
    const fromEnv = opts.passwordEnv ? process.env[opts.passwordEnv] : undefined
    cache = fromVault || fromEnv || null
    cacheAt = now
    return cache
  }

  /** @type {Map<string, string>} callID -> helper path awaiting cleanup */
  const pending = new Map()
  /** @type {Set<string>} callIDs where we injected the helper */
  const injected = new Set()

  return {
    "tool.execute.before": async (inp, out) => {
      if (!opts.enabled) return
      if (inp.tool !== "bash" && inp.tool !== "shell") return
      const command = out?.args?.command
      if (typeof command !== "string" || command.length === 0) return

      const password = await resolvePassword()
      if (!password) return

      const helper = buildAskpassHelper(password, inp.sessionID, inp.callID)
      const result = rewriteSudo(command, helper.path)
      if (result.changed) {
        out.args.command = result.command
        pending.set(inp.callID, helper.path)
        injected.add(inp.callID)
        await log("debug", "Injected sudo askpass credentials", {
          callID: inp.callID,
          matches: result.count,
        })
      } else {
        removeAskpassHelper(helper.path)
      }
    },

    "tool.execute.after": async (inp, out) => {
      const helperPath = pending.get(inp.callID)
      if (helperPath) {
        pending.delete(inp.callID)
        removeAskpassHelper(helperPath)
      }

      const wasInjected = injected.delete(inp.callID)
      if (
        !wasInjected &&
        opts.hintOnPermissionError &&
        typeof out?.output === "string" &&
        PERMISSION_ERROR.test(out.output)
      ) {
        const password = await resolvePassword()
        if (password) {
          out.output +=
            "\n\n[opencode-sudo] This command failed with a permission error. If it needs root, re-run it prefixed with `sudo`; the stored password is injected automatically."
        }
      }
    },

    "experimental.chat.system.transform": async (_inp, out) => {
      if (!opts.enabled || !opts.systemPromptHint) return
      const info = vaultInfo()
      const available = info.configured || Boolean(opts.passwordEnv && process.env[opts.passwordEnv])
      if (!available) return
      out.system.push(SYSTEM_HINT)
    },

    dispose: async () => {
      for (const helperPath of pending.values()) removeAskpassHelper(helperPath)
      pending.clear()
      injected.clear()
    },
  }
}

export default SudoPlugin
