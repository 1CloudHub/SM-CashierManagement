import { SEARCH_DROPDOWN_LIMIT, SEARCH_QUERY_MAX } from '@lanewise/shared'
import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { useActiveRole } from '@/app/active-role'
import { useRouter } from '@/app/router'
import { useAnnounce } from '@/components/a11y'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { displayGroups } from './search-groups'
import { useSearch } from './use-search'

/**
 * Global search in the top bar (design.md › Search and filter; requirement
 * 21.1). `/` or ⌘/Ctrl-K focuses it (registered by the app's HelpProvider).
 * Typing shows up to 5 hits per group — stores, departments, scenarios, staff
 * and pages — all within the active role's scope (the API filters, P1);
 * Enter opens SCR-041 with every result, or the highlighted hit.
 *
 * ARIA 1.2 combobox: the input owns a listbox of grouped options, with the
 * highlighted one exposed through aria-activedescendant; ↑/↓ move, Enter
 * opens, Esc closes. The result count is announced politely.
 */
export function GlobalSearch({ inputId }: { inputId: string }) {
  const { t } = useI18n()
  const { role } = useActiveRole()
  const { location, navigate } = useRouter()
  const initial = location.pathname === '/search' ? (new URLSearchParams(location.search).get('q') ?? '') : ''
  const [value, setValue] = useState(initial)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const labelId = useId()
  const listId = useId()
  const optionId = (i: number) => `${listId}-opt-${i}`

  const query = value.trim()
  const { data, loading } = useSearch(open ? query : '', SEARCH_DROPDOWN_LIMIT, { debounceMs: 150 })
  // Only hits the role can open, numbered in display order; the last option opens SCR-041.
  const groups = useMemo(() => {
    if (!query) return []
    let next = 0
    return displayGroups(role, query, data, t, SEARCH_DROPDOWN_LIMIT)
      .map((g) => ({
        key: g.key,
        label: g.label,
        hits: g.hits.flatMap((h) => (h.href === null ? [] : [{ ...h, href: h.href, index: next++ }])),
      }))
      .filter((g) => g.hits.length > 0)
  }, [role, query, data, t])
  const seeAllHref = `/search?q=${encodeURIComponent(query)}`
  const options = [...groups.flatMap((g) => g.hits.map((h) => h.href)), seeAllHref]
  const expanded = open && query.length > 0
  const hitCount = options.length - 1
  useAnnounce(expanded && !loading ? t('search.dropdown.count', { count: hitCount }) : undefined)

  const go = (href: string) => {
    setOpen(false)
    setActive(-1)
    navigate(href)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!expanded) {
        setOpen(true)
        return
      }
      e.preventDefault()
      const delta = e.key === 'ArrowDown' ? 1 : -1
      // Cycle through "no highlight" (-1) and every option.
      const slots = options.length + 1
      setActive((i) => ((((i + 1 + delta) % slots) + slots) % slots) - 1)
    } else if (e.key === 'Escape') {
      if (expanded) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        setActive(-1)
      }
    } else if (e.key === 'Enter') {
      const href = active >= 0 ? options[active] : undefined
      if (href) {
        e.preventDefault()
        go(href)
      }
    }
  }

  const optionClass = (i: number) =>
    cn('flex min-h-tap cursor-pointer flex-col justify-center px-3 py-1 text-body text-text', i === active ? 'bg-primary-soft text-on-primary-soft' : 'hover:bg-surface-2')

  return (
    <form
      role="search"
      aria-labelledby={labelId}
      className="relative w-full max-w-xl"
      onSubmit={(e) => {
        e.preventDefault()
        if (query) go(seeAllHref)
      }}
    >
      <label id={labelId} htmlFor={inputId} className="sr-only">
        {t('shell.search.label')}
      </label>
      <Input
        id={inputId}
        name="q"
        type="search"
        role="combobox"
        autoComplete="off"
        maxLength={SEARCH_QUERY_MAX}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 && active < options.length ? optionId(active) : undefined}
        placeholder={t('shell.search.placeholder')}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <div
        id={listId}
        role="listbox"
        aria-label={t('search.dropdown.label')}
        hidden={!expanded}
        className="absolute left-0 right-0 top-full z-40 mt-1 max-h-[70vh] overflow-y-auto border border-outline bg-surface"
      >
        {loading && groups.length === 0 ? (
          <p className="px-3 py-2 text-body-sm text-text-muted">{t('search.dropdown.loading')}</p>
        ) : groups.length === 0 ? (
          <p className="px-3 py-2 text-body-sm text-text-muted">{t('search.dropdown.none')}</p>
        ) : null}
        {groups.map((g) => {
          const headingId = `${listId}-${g.key}`
          return (
            <div key={g.key} role="group" aria-labelledby={headingId}>
              <div id={headingId} role="presentation" className="border-t border-outline px-3 pt-2 text-label text-text-muted first:border-t-0">
                {g.label}
              </div>
              {g.hits.map((h) => (
                <div
                  key={h.id}
                  id={optionId(h.index)}
                  role="option"
                  aria-selected={h.index === active}
                  className={optionClass(h.index)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(h.href)}
                >
                  <span>{h.label}</span>
                  {h.detail && <span className="text-body-sm text-text-muted">{h.detail}</span>}
                </div>
              ))}
            </div>
          )
        })}
        <div
          id={optionId(options.length - 1)}
          role="option"
          aria-selected={active === options.length - 1}
          className={cn(optionClass(options.length - 1), 'border-t border-outline font-weight-semibold')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => go(seeAllHref)}
        >
          {t('search.dropdown.seeAll', { query })}
        </div>
      </div>
    </form>
  )
}
