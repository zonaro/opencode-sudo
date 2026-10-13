/**
 * Command-line scanning and rewrite logic.
 *
 * The plugin never writes the password into the command line. Instead it
 * inserts a `SUDO_ASKPASS=... sudo -A` prefix so sudo reads the credential
 * from an askpass helper. This keeps the secret out of the command string,
 * the process arguments and the shell history.
 *
 * @module opencode-sudo/inject
 */
import { SHELL_OPERATORS, shellQuote } from "./util.js"

/**
 * Replace every character that belongs to a quoted string or a comment with a
 * space, preserving length so string indices still map to the original.
 *
 * @param {string} command
 * @returns {string} The masked command.
 */
export function maskNonCode(command) {
  const chars = command.split("")
  const size = chars.length
  let index = 0
  /** @type {"normal" | "single" | "double"} */
  let state = "normal"
  let atWordStart = true

  while (index < size) {
    const char = chars[index]

    if (state === "normal") {
      if (char === "\\") {
        chars[index] = " "
        if (index + 1 < size) chars[index + 1] = " "
        index += 2
        atWordStart = false
        continue
      }
      if (char === "'") {
        chars[index] = " "
        state = "single"
        index += 1
        atWordStart = false
        continue
      }
      if (char === '"') {
        chars[index] = " "
        state = "double"
        index += 1
        atWordStart = false
        continue
      }
      if (char === "#" && atWordStart) {
        while (index < size && chars[index] !== "\n") {
          chars[index] = " "
          index += 1
        }
        continue
      }
      if (char === "\n" || char === " " || char === "\t" || SHELL_OPERATORS.has(char)) {
        atWordStart = true
        index += 1
        continue
      }
      atWordStart = false
      index += 1
      continue
    }

    // Inside a quoted string: blank everything until the closing quote.
    chars[index] = " "
    if (state === "double" && char === "\\") {
      if (index + 1 < size) chars[index + 1] = " "
      index += 2
      continue
    }
    if ((state === "single" && char === "'") || (state === "double" && char === '"')) {
      state = "normal"
    }
    index += 1
  }

  return chars.join("")
}

/**
 * @typedef {{ type: "word" | "op", value: string, start: number, end: number }} Token
 */

/**
 * Split a masked command into words and operators, keeping offsets.
 * @param {string} masked
 * @returns {Token[]}
 */
export function tokenize(masked) {
  /** @type {Token[]} */
  const tokens = []
  const size = masked.length
  let index = 0

  while (index < size) {
    const char = masked[index]
    if (char === " " || char === "\t" || char === "\r") {
      index += 1
      continue
    }
    if (SHELL_OPERATORS.has(char)) {
      tokens.push({ type: "op", value: char, start: index, end: index + 1 })
      index += 1
      continue
    }
    const start = index
    while (
      index < size &&
      !SHELL_OPERATORS.has(masked[index]) &&
      masked[index] !== " " &&
      masked[index] !== "\t" &&
      masked[index] !== "\r"
    ) {
      index += 1
    }
    tokens.push({ type: "word", value: masked.slice(start, index), start, end: index })
  }

  return tokens
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isSudoWord(value) {
  return value === "sudo" || value.endsWith("/sudo")
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isEnvAssignment(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(value)
}

/** The env assignment we insert; used to detect an already-rewritten command. */
export const MARKER = "SUDO_ASKPASS="

/**
 * Decide whether a `sudo` token sits at the start of a command.
 * @param {Token[]} tokens
 * @param {number} index
 * @returns {boolean}
 */
function isCommandPosition(tokens, index) {
  let cursor = index - 1
  while (cursor >= 0) {
    const token = tokens[cursor]
    if (token.type === "op") {
      return (
        token.value === ";" ||
        token.value === "|" ||
        token.value === "&" ||
        token.value === "(" ||
        token.value === "{" ||
        token.value === "\n"
      )
    }
    if (token.value.startsWith(MARKER)) return false // already injected
    if (isEnvAssignment(token.value)) {
      cursor -= 1
      continue
    }
    return false
  }
  return true
}

/**
 * Find every command-position `sudo` token in a command line.
 * @param {string} command
 * @returns {Token[]}
 */
export function findSudoTokens(command) {
  if (typeof command !== "string" || !command.includes("sudo")) return []
  const masked = maskNonCode(command)
  const tokens = tokenize(masked)
  return tokens.filter((token, index) => {
    if (token.type !== "word" || !isSudoWord(token.value)) return false
    return isCommandPosition(tokens, index)
  })
}

/**
 * Rewrite a command so every `sudo` uses the given askpass helper.
 *
 * @param {string} command
 * @param {string} helperPath Absolute path of the askpass helper script.
 * @returns {{ changed: boolean, command: string, count: number }}
 */
export function rewriteSudo(command, helperPath) {
  if (typeof command !== "string" || !command.includes("sudo")) {
    return { changed: false, command, count: 0 }
  }

  const spans = findSudoTokens(command)
  if (spans.length === 0) return { changed: false, command, count: 0 }

  const prefix = `${MARKER}${shellQuote(helperPath)} sudo -A`
  let rewritten = command
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    rewritten = rewritten.slice(0, span.start) + prefix + rewritten.slice(span.end)
  }

  return { changed: true, command: rewritten, count: spans.length }
}
