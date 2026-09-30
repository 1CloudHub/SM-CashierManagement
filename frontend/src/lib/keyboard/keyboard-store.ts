import { createContext, useContext } from 'react'
import type { Shortcut } from './keys'

/**
 * Keyboard engine context + hook (task 1.9), split from the provider component
 * so the provider file only exports a component (React Fast Refresh stays
 * happy — same split pattern as button.tsx / button-variants.ts). The provider
 * (./keyboard-context) creates the value; everything else reads it via
 * `useKeyboardShortcuts`.
 */
export interface KeyboardContextValue {
  /** Register a shortcut; returns an unregister function. */
  register: (shortcut: Shortcut) => () => void
  /** The current registry, ordered by registration, for the help reference. */
  shortcuts: Shortcut[]
  /** Whether the shortcut reference (SCR-091) is open. */
  helpOpen: boolean
  setHelpOpen: (open: boolean) => void
}

export const KeyboardContext = createContext<KeyboardContextValue | null>(null)

/** Access the keyboard-shortcut engine. Must be under a provider. */
export function useKeyboardShortcuts(): KeyboardContextValue {
  const ctx = useContext(KeyboardContext)
  if (!ctx) {
    throw new Error(
      'useKeyboardShortcuts must be used within a KeyboardShortcutsProvider',
    )
  }
  return ctx
}
