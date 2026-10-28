/**
 * Bridge de senha entre a extensão OpenChamber e o plugin opencode-sudo.
 *
 * A extensão OpenChamber (iframe sandboxado) não pode injetar `SUDO_ASKPASS`
 * no processo do OpenCode, mas pode gravar um arquivo de ponte no diretório
 * do vault. Este módulo lê esse arquivo para que o plugin use a senha
 * configurada na tela da extensão — fazendo `sudo` funcionar automaticamente,
 * sem perguntar.
 *
 * Arquivo: `<sudoHome>/bridge-password.json`  →  `{ "password": "..." }`
 *
 * @module opencode-sudo/bridge
 */
import fs from "node:fs"
import path from "node:path"
import { sudoHome } from "./paths.js"

/** Caminho do arquivo de ponte escrito pela extensão OpenChamber. */
export function bridgePath() {
  return path.join(sudoHome(), "bridge-password.json")
}

/**
 * Lê a senha do arquivo de ponte.
 * @returns {string | null} A senha, ou null quando ausente/ilegível.
 */
export function readBridgePassword() {
  try {
    const file = fs.readFileSync(bridgePath(), "utf8")
    const data = JSON.parse(file)
    if (data && typeof data.password === "string" && data.password.length > 0) {
      return data.password
    }
  } catch {
    // Arquivo ausente, corrompido ou sem permissão: segue para a próxima fonte.
  }
  return null
}
