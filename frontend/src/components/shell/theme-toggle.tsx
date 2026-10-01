import { Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useUiT } from '@/i18n/context'
import { currentTheme, setTheme, type Theme } from '@/lib/theme'

/**
 * ThemeToggle (SG-009) — switches between light and dark by setting
 * `data-theme` on <html> (a token value swap, no re-render of components)
 * and persists the choice. The accessible name says what pressing it does
 * ("Switch to dark theme"); the icon shows the theme it switches to.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useUiT()
  const [theme, setThemeState] = useState<Theme>(currentTheme)
  const next: Theme = theme === 'dark' ? 'light' : 'dark'
  const Icon = next === 'dark' ? Moon : Sun

  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={t(next === 'dark' ? 'shell.theme.toDark' : 'shell.theme.toLight')}
      className={className}
      onClick={() => {
        setTheme(next)
        setThemeState(next)
      }}
    >
      <Icon aria-hidden="true" className="size-5" />
    </Button>
  )
}
