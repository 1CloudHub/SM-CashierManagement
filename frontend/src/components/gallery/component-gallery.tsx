import { useRef, type ReactNode } from 'react'
import { AppShell } from '@/components/layout/app-shell'
import { Stack } from '@/components/layout/stack'
import { Alert, Input } from '@/components/ui'
import { LanguageSwitcher, useI18n } from '@/i18n'
import { HelpButton, HelpProvider } from '@/components/help'
import { AnnouncerProvider } from '@/components/a11y'
import { ToastProvider } from '@/components/ui/toast'
import { I18nProvider } from '@/i18n'
import { GALLERY_SECTIONS, type GallerySection } from './gallery-nav'
import { FoundationsGallerySection } from './section-foundations'
import { PrimitivesGallerySection } from './section-primitives'
import { StatesGallerySection } from './section-states'
import { LayoutGallerySection } from './section-layout'
import { PatternsGallerySection } from './section-patterns'
import { ErrorsGallerySection } from './section-errors'
import { type NavSection } from '@/components/shell'

/**
 * Component gallery / design-system reference (task 1.10 — SG-000/001, UX-010).
 *
 * The living style-guide reference: a real, navigable page that documents every
 * primitive, state, layout and pattern built in tasks 1.4–1.9, composed from
 * the SAME primitives it documents so it stays truthful (if a token or
 * component changes, the gallery reflects it). It replaces the interim
 * smoke-screen: it still doubles as the render smoke test for the token layer +
 * Tailwind mapping and carries the automated axe check (App.test.tsx).
 *
 * Structure:
 *   - AppShell provides the landmarks (banner/nav/main), skip link, breakpoints
 *     and the sample-data banner slot — the same frame every real screen uses.
 *   - The side nav is the section index (from gallery-nav); links jump to each
 *     <section> by id.
 *   - HelpProvider wires the global keyboard scheme (`/`·⌘K search, `?`
 *     reference, `g`+key nav, `n`) and mounts the Help/shortcuts screen.
 *   - I18nProvider + AnnouncerProvider + ToastProvider supply the cross-cutting
 *     context every section exercises.
 *
 * Everything is token-driven — no raw hex, px font sizes or ad-hoc timings —
 * and honours prefers-reduced-motion via the shared motion layer. Full WCAG
 * conformance still needs manual assistive-technology testing; the automated
 * axe check establishes the structure.
 */

/** Build the side-nav section index from the gallery section registry. */
function galleryNav(sections: readonly GallerySection[]): NavSection[] {
  return [
    {
      items: sections.map((s) => ({
        label: s.label,
        href: `#${s.id}`,
        icon: s.label.charAt(0),
      })),
    },
  ]
}

export function ComponentGallery({
  accountSlot,
}: {
  /** Signed-in account controls (profile / sign out) for the top bar. */
  accountSlot?: ReactNode
} = {}) {
  return (
    <I18nProvider>
      <AnnouncerProvider>
        <ToastProvider>
          <GalleryApp accountSlot={accountSlot} />
        </ToastProvider>
      </AnnouncerProvider>
    </I18nProvider>
  )
}

function GalleryApp({ accountSlot }: { accountSlot?: ReactNode }) {
  const searchRef = useRef<HTMLInputElement>(null)
  return (
    <HelpProvider
      onFocusSearch={() => searchRef.current?.focus()}
      onNavigate={(target) => {
        // Gallery stand-in: real routing lands with the screens (task 4+). Map
        // the global g+key nav onto the closest section anchors.
        const anchor =
          target === 'roster' ? 'layout' : target === 'map' ? 'primitives' : ''
        window.location.hash = anchor ? `#${anchor}` : ''
      }}
    >
      <GalleryShell searchRef={searchRef} accountSlot={accountSlot} />
    </HelpProvider>
  )
}

function GalleryShell({
  searchRef,
  accountSlot,
}: {
  searchRef: React.RefObject<HTMLInputElement | null>
  accountSlot?: ReactNode
}) {
  const { t } = useI18n()

  return (
    <AppShell
      nav={galleryNav(GALLERY_SECTIONS)}
      navLabel="Component gallery"
      mainLabel={t('a11y.mainContent')}
      skipLinkLabel={t('a11y.skipToMain')}
      breadcrumbs={[{ label: 'LaneWise', href: '#' }, { label: 'Component gallery' }]}
      sampleDataBanner={
        <Alert tone="warning" title={t('sampleData.title')} live={false}>
          {t('sampleData.description')}
        </Alert>
      }
      search={
        <form role="search" className="w-full max-w-xl">
          <label htmlFor="gallery-search" className="sr-only">
            {t('a11y.search')}
          </label>
          <Input
            ref={searchRef}
            id="gallery-search"
            type="search"
            placeholder="Search the gallery ( / )"
          />
        </form>
      }
      trailing={
        <>
          <LanguageSwitcher />
          <HelpButton />
          {accountSlot}
        </>
      }
    >
      <Stack gap={8}>
        <div>
          <h1 className="text-h1 text-text">Component gallery</h1>
          <p className="mt-1 max-w-prose text-body text-text-muted">
            The living style-guide reference (SG-000). Every token, primitive,
            state, layout and pattern below is the real component the screens
            use — composed here so the design system is exercisable,
            self-documenting and accessible end to end.
          </p>
        </div>

        <FoundationsGallerySection description={GALLERY_SECTIONS[0].description} />
        <PrimitivesGallerySection description={GALLERY_SECTIONS[1].description} />
        <StatesGallerySection description={GALLERY_SECTIONS[2].description} />
        <LayoutGallerySection description={GALLERY_SECTIONS[3].description} />
        <PatternsGallerySection description={GALLERY_SECTIONS[4].description} />
        <ErrorsGallerySection description={GALLERY_SECTIONS[5].description} />
      </Stack>
    </AppShell>
  )
}
