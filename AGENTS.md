# AGENTS.md

Operational notes for agents working on **opencode-sudo**.

## What this is

Two artifacts in one repository:

1. **OpenCode v2 plugin** (`src/`, `bin/`) — stores a sudo password in an encrypted, machine-bound vault and exports a persistent `SUDO_ASKPASS` helper so plain `sudo` works in OpenCode's non-tty shells.
2. **OpenChamber extension** (`panel/`) — a rail panel where the user configures the sudo password. It writes a bridge file (`<sudoHome>/bridge-password.json`) that the plugin reads, so `sudo` works automatically without asking.

## Layout

| Path | Responsibility |
| --- | --- |
| `src/paths.js` | Vault/keystore/helper locations and safe file IO. |
| `src/vault.js` | AES-256-GCM encryption, scrypt key derivation, machine binding. |
| `src/helper.js` | Persistent askpass wrapper (`ensureAskpassHelper()`). |
| `src/askpass-print.js` | Password emitter: decrypts the vault, prints it with no trailing newline. |
| `src/bridge.js` | Reads the bridge file written by the OpenChamber extension. |
| `src/index.js` | V2 plugin (`export default { id, setup }`). Resolves: option > bridge > vault > env. |
| `bin/opencode-sudo.js` | CLI: `set`, `status`, `test`, `clear`. |
| `panel/` | OpenChamber extension (index.html, main.css, main.js + bundled IIFE). |
| `package.json` | Plugin manifest + `openchamber` block (apiVersion 1, panel, filesystem capability). |
| `test/` | `node:test` suites. |

## Bridge contract

The OpenChamber extension writes `<sudoHome>/bridge-password.json` with `{ "password": "..." }`. The plugin (`src/bridge.js`, `readBridgePassword()`) reads it and persists into the vault, so `SUDO_ASKPASS` is exported for the server lifetime.

## Rules

- Never log, print, or return the password. `vaultInfo()` must stay secret-free.
- Never place the password in a command line, `argv`, or an env var passed to `sudo`. The only sanctioned channel is the askpass helper's stdout.
- Never use `sudo -n` anywhere (it bypasses the helper); plain `sudo` is the mechanism.
- Do NOT touch crypto in `src/vault.js`.
- Keep the plugin dependency-free and valid ESM for both Bun and Node ≥ 18.
- The bridge file holds the password in plaintext with mode `0600` — document this trade-off; do not weaken file modes (`0700` dir/helper, `0600` secrets).
- Do not modify `~/.config/opencode/opencode.json`; do not commit.
- After any change run `npm run check && npm test`.

## Verify

```bash
npm run check
npm test
opencode-sudo status
```
