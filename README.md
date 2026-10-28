# opencode-sudo

**`sudo` automático no OpenCode, com tela de configuração no OpenChamber.**

Este repositório entrega dois artefatos que trabalham juntos:

1. **Plugin `opencode-sudo` (OpenCode)** — `src/`, `bin/` — exporta um `SUDO_ASKPASS` persistente para que `sudo` funcione em shells não-TTY do OpenCode, sem pedir senha.
2. **Extensão `openchamber-sudo` (OpenChamber)** — `panel/` — painel na rail onde você configura a senha de sudo. A extensão grava um arquivo de ponte (`bridge-password.json`) que o plugin lê, cifra no vault e usa automaticamente.

Resultado: você configura a senha uma vez na tela do OpenChamber e o OpenCode passa a usar `sudo` sozinho, sempre que necessário, sem nunca te perguntar.

---

## Como funciona (a combinação)

```
┌─────────────────┐     grava bridge-password.json     ┌──────────────────┐
│ OpenChamber     │ ─────────────────────────────────► │ ~/.config/opencode │
│ extensão sudo   │ texto (senha)                      │ /opencode-sudo/    │
│ (panel/main.js) │                                    │ bridge-password.json│
└─────────────────┘                                    └──────────┬─────────┘
                                                                 │ lê
                                                                 ▼
                                                        ┌──────────────────┐
                                                        │ Plugin opencode-sudo│
                                                        │ (src/index.js +     │
                                                        │  src/bridge.js)     │
                                                        │ • lê o bridge     │
                                                        │ • cifra no vault  │
                                                        │ • exporta         │
                                                        │   SUDO_ASKPASS    │
                                                        └──────────┬─────────┘
                                                                 │
                                                                 ▼
                                                        plain `sudo <cmd>`
                                                        funciona sem senha
```

Fluxo:
1. Você abre o painel **Sudo** na rail do OpenChamber e digita a senha.
2. A extensão grava `~/.config/opencode/opencode-sudo/bridge-password.json` (e guarda no `host.storage` do OpenChamber).
3. Na próxima inicialização (ou setup) do plugin `opencode-sudo` no OpenCode, ele lê o bridge, cifra a senha no vault machine-bound e exporta `SUDO_ASKPASS` para a vida do servidor.
4. Qualquer `sudo <cmd>` rodado pelo agente em shell não-TTY pega a senha via `SUDO_ASKPASS` — sem `-A`, sem `-S`, sem digitar.

---

## Instalar

### 1. Plugin no OpenCode (`opencode.json`)

Adicione ao seu `~/.config/opencode/opencode.json`:

```json
{
  "plugins": [
    { "package": "/mnt/GIT/opencode-sudo", "options": { "passwordEnv": "sudo_password" } }
  ]
}
```

Reinicie o OpenCode.

### 2. Extensão no OpenChamber

Abra **Settings → Extensions**, cole o caminho absoluto desta pasta e escolha **Add**:

```text
/mnt/GIT/opencode-sudo
```

A extensão pede a capacidade `filesystem` no caminho `~/.config/opencode/opencode-sudo/**` (para gravar o arquivo de ponte). Aprove, e o ícone **Sudo** aparece na rail.

Desenvolvendo? Edite `panel/main.js`, rode `bun run build` e recarregue a extensão.

---

## Usar

1. No OpenChamber, clique no ícone **Sudo** na rail.
2. Digite a senha de sudo e clique em **Salvar senha**.
3. Pronto: daí em diante o OpenCode usa `sudo` automaticamente.
4. Use **Mostrar / Ocultar** para revelar a senha e **Remover** para apagá-la.

---

## Desenvolvimento

```bash
bun install        # dependências (@openchamber/sdk, bun)
bun run check      # sintaxe de todos os módulos (plugin + extensão)
bun test           # suítes node:test (vault + helper)
bun run build      # empacota panel/main.js em IIFE (sandbox do OpenChamber)
```

Estrutura:

| Arquivo | Responsabilidade |
| --- | --- |
| `src/index.js` | Plugin OpenCode v2: resolve senha, cifra no vault, exporta `SUDO_ASKPASS` |
| `src/bridge.js` | Lê o arquivo de ponte gravado pela extensão OpenChamber |
| `src/vault.js` | AES-256-GCM + scrypt, machine-bound |
| `src/helper.js` | Wrapper `SUDO_ASKPASS` (0700) |
| `src/askpass-print.js` | Emissor de senha (stdout, sem newline) |
| `bin/opencode-sudo.js` | CLI: `set`, `status`, `test`, `clear` |
| `panel/main.js` | Tela da extensão: gravar/ler/remover a senha |
| `panel/index.html`, `panel/main.css` | Página e estilos do painel |

---

## Segurança

* O vault do plugin é cifrado (AES-256-GCM + scrypt), vinculado à máquina/usuário.
* O **arquivo de ponte** (`bridge-password.json`) grava a senha em texto plano com modo `0600`, lido apenas pelo plugin. É o ponto fraco da combinação: qualquer processo que rode como seu usuário e leia esse arquivo acessa a senha. Não armazene senhas de produção críticas aqui se não estiver confortável com esse trade-off.
* A senha nunca vai para argumentos de comando, `argv` ou variáveis de ambiente passadas ao `sudo`. O único canal sancionado é o stdout do askpass helper.
* Nunca use `sudo -n` (bypassa o helper).

---

## License

MIT
