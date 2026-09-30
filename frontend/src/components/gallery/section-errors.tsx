import {
  BadRequestPage,
  NoAccessPage,
  NotFoundPage,
  ServerErrorPage,
  ServiceUnavailablePage,
  TooManyRequestsPage,
  OfflinePage,
} from '@/components/errors'
import { Section } from '@/components/layout/section'
import { Stack } from '@/components/layout/stack'
import { useI18n } from '@/i18n'
import { type Locale } from '@/i18n'
import { Subsection } from './gallery-parts'

/**
 * Error pages — the SCR-090 reference (task 1.10; pages from task 1.5, UX-010).
 *
 * Each request-level error/status renders inline here (the `bare` full-screen
 * layout is used pre-auth). Every page carries a plain-language, localised
 * message, a reference id where it helps support, and at least one way back to
 * safety — never a dead end, never a stack trace. The pages follow the active
 * gallery locale so switching language on the Patterns section updates these
 * too. `onAction` is a no-op here (routing lands with the screens, task 4+).
 */
export function ErrorsSection() {
  const { locale } = useI18n()
  // The error pages take their own locale union; it matches the i18n locales.
  const loc = locale as Locale

  return (
    <Stack gap={8}>
      <Subsection
        title="404 — Not found"
        hint="Offers Home and search. Rendered as the 'empty' state variant (polite)."
      >
        <NotFoundPage locale={loc} onAction={() => {}} />
      </Subsection>

      <Subsection
        title="403 — No access"
        hint="Reveals nothing about the target object; offers a way Home (req. 2)."
      >
        <NoAccessPage locale={loc} onAction={() => {}} />
      </Subsection>

      <Subsection
        title="400 — Bad request"
        hint="Carries a reference id; offers back and Home. Announced assertively."
      >
        <BadRequestPage locale={loc} referenceId="LW-40012B" onAction={() => {}} />
      </Subsection>

      <Subsection
        title="429 — Too many requests"
        hint="Asks the user to wait, then retry; carries a reference id."
      >
        <TooManyRequestsPage
          locale={loc}
          referenceId="LW-429A07"
          onAction={() => {}}
        />
      </Subsection>

      <Subsection
        title="500 — Server error"
        hint="Makes clear it is the app, not the user; offers retry and Home."
      >
        <ServerErrorPage
          locale={loc}
          referenceId="LW-500F31"
          onAction={() => {}}
        />
      </Subsection>

      <Subsection
        title="503 — Service unavailable"
        hint="Briefly offline / maintenance; offers retry and Home."
      >
        <ServiceUnavailablePage
          locale={loc}
          referenceId="LW-503C22"
          onAction={() => {}}
        />
      </Subsection>

      <Subsection
        title="Offline"
        hint="Cannot reach the server; keeps local drafts and offers retry."
      >
        <OfflinePage locale={loc} referenceId="LW-OFFLN9" onAction={() => {}} />
      </Subsection>

      <p className="text-body-sm text-text-muted">
        401 (“Please sign in”) uses the full-screen <code>bare</code> layout
        because it renders pre-auth, outside the app shell, so it is not shown
        inline here.
      </p>
    </Stack>
  )
}

export function ErrorsGallerySection({
  description,
}: {
  description: string
}) {
  return (
    <Section id="errors" title="Error pages" description={description}>
      <ErrorsSection />
    </Section>
  )
}
