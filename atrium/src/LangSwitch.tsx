import type { Lang } from './i18n'

export function LangSwitch({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="lang" role="group" aria-label="Language / Wika">
      {(
        [
          ['en', 'EN', 'English'],
          ['fil', 'FIL', 'Filipino'],
        ] as const
      ).map(([id, code, name]) => (
        <button key={id} type="button" aria-pressed={lang === id} aria-label={name} onClick={() => onChange(id)}>
          {code}
        </button>
      ))}
    </div>
  )
}
