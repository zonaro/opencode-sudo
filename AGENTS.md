# AGENTS.md

Operational notes for agents working on **opencode-sudo**.

## What this is

An opencode plugin (`src/index.js`) plus a CLI (`bin/opencode-sudo.js`) that stores a sudo
password in an encrypted, machine-bound vault and injects it into `bash` tool calls via
`SUDO_ASKPASS` + `sudo -A`.

## Layout

| Path | Responsibility |
| --- | --- |
| `src/paths.js` | Vault/keystore/runtime locations and safe file IO. |
| `src/vault.js` | AES-256-GCM encryption, scrypt key derivation, machine binding. |
| `src/inject.js` | Command scanning (`maskNonCode`, `findSudoTokens`) and rewriting. |
| `src/askpass.js` | Askpass helper creation and cleanup. |
| `src/index.js` | Plugin hooks. |
| `bin/opencode-sudo.js` | CLI: `set`, `status`, `test`, `clear`. |
| `test/` | `node:test` suites. |

## Rules

- Never log, print, or return the password. `vaultInfo()` must stay secret-free.
- Never place the password in a command line, `argv`, or an env var passed to `sudo`.
  The only sanctioned channel is the askpass helper (stdout of a `0700` script).
- Keep the plugin dependency-free and valid ESM for both Bun and Node ≥ 18.
- After any change run `npm run check && npm test`.
- Do not weaken file modes (`0700` dir, `0600` secrets, `0700` helpers).

## Verify

```bash
npm run check
npm test
opencode-sudo status
```
