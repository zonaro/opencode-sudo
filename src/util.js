/**
 * Small shared helpers for the opencode-sudo plugin.
 * @module opencode-sudo/util
 */

/**
 * Quote a value so it can be embedded safely inside a POSIX shell command.
 * Single quotes make every character literal; an embedded single quote is
 * rewritten using the classic `'\''` sequence.
 *
 * @param {string} value
 * @returns {string}
 */
export function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`
}

/**
 * Reduce an arbitrary identifier to characters that are safe inside a file
 * name.
 *
 * @param {string} value
 * @param {number} [max]
 * @returns {string}
 */
export function safeName(value, max = 64) {
  return String(value || "0")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, max)
}

/**
 * POSIX shell characters that terminate a simple command. They are treated as
 * standalone tokens when scanning a command line.
 * @type {Set<string>}
 */
export const SHELL_OPERATORS = new Set([";", "|", "&", "(", ")", "{", "}", "\n"])
