/**
 * Human-readable key rendering for the shortcut reference (task 1.9, SCR-091).
 *
 * Turns the compact combo/sequence specs used by `Shortcut` into the tokens
 * shown in <kbd> chips, platform-aware (⌘ on Apple, Ctrl elsewhere) and using
 * real glyphs (⇧ ⌥ ↵ Esc). These are display strings only — the actual
 * matching is done from the raw specs in ./keys, so display never affects
 * behaviour. Symbols are language-neutral; any surrounding prose is localised
 * by the caller.
 */
import { isApplePlatform, type Shortcut } from './keys'

const APPLE_SYMBOL: Record<string, string> = {
  mod: '⌘',
  meta: '⌘',
  cmd: '⌘',
  command: '⌘',
  ctrl: '⌃',
  control: '⌃',
  shift: '⇧',
  alt: '⌥',
  option: '⌥',
}

const OTHER_SYMBOL: Record<string, string> = {
  mod: 'Ctrl',
  meta: 'Win',
  cmd: 'Win',
  command: 'Win',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  option: 'Alt',
}

/** Named non-printable keys → a compact glyph/label for display. */
const KEY_SYMBOL: Record<string, string> = {
  escape: 'Esc',
  enter: '↵',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  ' ': 'Space',
  tab: 'Tab',
}

function displayToken(token: string, apple: boolean): string {
  const lower = token.toLowerCase()
  const modMap = apple ? APPLE_SYMBOL : OTHER_SYMBOL
  if (lower in modMap) return modMap[lower]
  if (lower in KEY_SYMBOL) return KEY_SYMBOL[lower]
  // Single printable chars are shown upper-cased (K, N, /, ?).
  return token.length === 1 ? token.toUpperCase() : token
}

/**
 * Render a single combo spec (e.g. `"mod+k"`) into ordered display tokens
 * (e.g. `['⌘', 'K']`). Modifiers come first, in a stable order.
 */
export function comboTokens(spec: string, apple = isApplePlatform()): string[] {
  const parts = spec.split('+').map((p) => p.trim())
  const mods: string[] = []
  let main = ''
  const order = ['mod', 'meta', 'cmd', 'command', 'ctrl', 'control', 'alt', 'option', 'shift']
  for (const part of parts) {
    if (order.includes(part.toLowerCase())) mods.push(part)
    else main = part
  }
  mods.sort((a, b) => order.indexOf(a.toLowerCase()) - order.indexOf(b.toLowerCase()))
  return [...mods, main].filter(Boolean).map((t) => displayToken(t, apple))
}

/**
 * The list of "chips" to render for a shortcut. Each chip is a group of key
 * tokens pressed together; a sequence yields two chips (leader, then key), an
 * `keys` list yields the FIRST binding's chip (help shows the primary combo,
 * with alternatives available via title/aria as needed).
 *
 * Returns `{ chips, sequence }` where `chips` is an array of token arrays and
 * `sequence` marks whether the chips are pressed in order (g then h) vs together.
 */
export function shortcutChips(
  shortcut: Pick<Shortcut, 'keys' | 'sequence'>,
  apple = isApplePlatform(),
): { chips: string[][]; sequence: boolean } {
  if (shortcut.sequence) {
    const [leader, then] = shortcut.sequence
    return {
      chips: [comboTokens(leader, apple), comboTokens(then, apple)],
      sequence: true,
    }
  }
  const primary = shortcut.keys?.[0]
  if (!primary) return { chips: [], sequence: false }
  return { chips: [comboTokens(primary, apple)], sequence: false }
}

/**
 * Flatten a shortcut's keys to a plain accessible string, e.g. "⌘ K" or
 * "G then H", for aria-keyshortcuts / labels where a single string is needed.
 * `andThen` is the localised "then" connector (e.g. "then" / "tapos").
 */
export function shortcutAria(
  shortcut: Pick<Shortcut, 'keys' | 'sequence'>,
  andThen: string,
  apple = isApplePlatform(),
): string {
  const { chips, sequence } = shortcutChips(shortcut, apple)
  const joinedChips = chips.map((c) => c.join(' '))
  return sequence ? joinedChips.join(` ${andThen} `) : joinedChips.join(' ')
}
