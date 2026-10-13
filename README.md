# opencode-sudo

Automatic `sudo` password injection for [opencode](https://opencode.ai), backed by an
encrypted, machine-bound vault.

When the agent runs a command that needs root, you normally get stuck: the shell has no
TTY, so `sudo` cannot prompt. This plugin detects `sudo` invocations in the `bash` tool
and transparently supplies the stored password, so `sudo apt-get install ...` just works.

> **Read the [Security model](#security-model) before storing a real password.**

---

## How it works

1. `tool.execute.before` inspects every `bash` command.
2. Commands containing a command-position `sudo` are rewritten to use an askpass helper:

   ```
   sudo apt-get update
   → SUDO_ASKPASS='/…/runtime/askpass-….sh' sudo -A apt-get update
   ```

3. `sudo -A` runs the helper, which prints the decrypted password on stdout.
4. `tool.execute.after` deletes the helper script.

The password is **never** placed on a command line, in `argv`, or in the shell history —
only a path to a short-lived `0700` helper is inserted.

---

## Install

### From a local checkout

```bash
git clone <this-repo> /mnt/GIT/opencode-sudo
```

Then reference it from your opencode config (`opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["/mnt/GIT/opencode-sudo/src/index.js", { "passwordEnv": "sudo_password" }]
  ]
}
```

Or drop a one-line file in your global plugin directory
(`~/.config/opencode/plugins/opencode-sudo.js`):

```js
export { default } from "/mnt/GIT/opencode-sudo/src/index.js"
```

Restart opencode after changing configuration.

### From npm (once published)

```json
{ "plugin": ["opencode-sudo"] }
```

---

## Configure the password

The credential can come from three places, in priority order:

1. the `password` plugin option (not recommended — it lands in config),
2. the **encrypted vault**, or
3. the environment variable named by `passwordEnv` (default `sudo_password`).

### Using the vault (recommended)

```bash
opencode-sudo set            # hidden prompt, asks twice
opencode-sudo status         # show metadata (never the password)
opencode-sudo test           # verify sudo accepts it
opencode-sudo clear          # wipe vault + keystore
```

Store directly from an existing environment variable:

```bash
opencode-sudo set --from-env sudo_password
```

The vault lives in `~/.config/opencode/opencode-sudo/` (override with
`OPENCODE_SUDO_HOME`).

---

## Plugin options

```json
{
  "plugin": [
    ["/mnt/GIT/opencode-sudo/src/index.js", {
      "passwordEnv": "sudo_password",
      "enabled": true,
      "systemPromptHint": true,
      "hintOnPermissionError": true
    }]
  ]
}
```

| Option | Default | Description |
| --- | --- | --- |
| `password` | – | Literal password (bypasses the vault). |
| `passwordEnv` | `sudo_password` | Env var used when the vault is empty. |
| `enabled` | `true` | Master switch. |
| `systemPromptHint` | `true` | Tell the model that `sudo` is handled. |
| `hintOnPermissionError` | `true` | Append a hint when a command fails with a permission error. |

A password is only used when one is actually available, so the plugin stays inert until
you configure something.

---

## For the agent

When a task needs root, run the command with a plain `sudo` prefix:

```bash
sudo systemctl restart nginx
```

Do **not** type a password, do **not** use `sudo -S`, and do **not** use `sudo -n`
(it disables the prompt). The plugin supplies the credential automatically and opencode's
normal bash permission rules still apply.

---

## Security model

* **Cipher:** AES-256-GCM with a random 96-bit IV and a 128-bit auth tag; the auth tag
  also covers a fixed AAD string, so tampered ciphertext is rejected.
* **Key derivation:** scrypt (`N=2^15, r=8, p=1`) over
  `machineFingerprint \0 keystoreSecret`.
* **Machine fingerprint:** hostname + username + uid + home + `/etc/machine-id`.
* **Keystore:** a random 32-byte secret in `keystore.json` (`0600`), separate from
  `vault.json`.
* **File modes:** vault directory `0700`, vault/keystore `0600`, runtime helpers `0700`,
  and helpers are deleted right after each command.

This makes the vault decryptable only by the same opencode install, on the same machine,
under the same user. Copying `vault.json` (or even the whole directory to another host)
is not enough.

### Honest limitations

* The key material ultimately lives on the same machine as the ciphertext. Anyone who can
  read both files **and** run code as your user can recover the password. This protects
  against theft of a single file and against casual inspection — not against a fully
  compromised account.
* While a `sudo` command runs, the password is briefly present in a `0700` helper script.
  The window is short and the file is owner-only.
* The password must be the one `sudo` expects for your user; the plugin does not verify it
  beyond `opencode-sudo test`.

---

## Development

```bash
npm run check    # syntax-check every module
npm test         # node:test suites (vault + inject)
```

No runtime dependencies; the plugin is plain ESM and runs under both Bun (opencode's
runtime) and Node ≥ 18 (the CLI).

---

## License

MIT
