import { DemoCredit } from '@/components/brand'
import type { ReactNode } from 'react'
import { SkipLink } from '@/components/a11y/skip-link'
import { Col, Grid, Page, Stack } from '@/components/layout'
import { Card } from '@/components/ui/card'
import { LanguageSwitcher, useI18n } from '@/i18n'
import { useDocumentTitle } from './use-document-title'

/**
 * The bare pre-auth layout for SCR-001 / SCR-002: brand lockup and a single
 * centred card on the responsive grid (4 / 8 / 12 columns), with the language
 * switcher available before sign-in.
 */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useI18n()
  useDocumentTitle(title)
  return (
    <>
      <SkipLink>{t('a11y.skipToMain')}</SkipLink>
      <main id="main" tabIndex={-1} className="min-h-screen bg-bg py-12">
        <Page>
          <Grid>
            <Col span={4} spanTablet={6} spanLaptop={6} className="tablet:col-start-2 laptop:col-start-4">
              <Stack gap={6}>
                <Stack gap={3} align="center">
                  <img src="/favicon.svg" alt="" width={48} height={48} />
                  <p className="text-h2 font-weight-bold text-text">
                    {t('auth.brand.name')}{' '}
                    <span className="text-label font-weight-regular text-text-muted">
                      {t('auth.brand.byline')}
                    </span>
                  </p>
                </Stack>
                <Card>{children}</Card>
                <Stack align="center" gap={4}>
                  <LanguageSwitcher />
                  <DemoCredit label={t('brand.demoCredit')} newTabLabel={t('brand.opensNewTab')} />
                </Stack>
              </Stack>
            </Col>
          </Grid>
        </Page>
      </main>
    </>
  )
}
