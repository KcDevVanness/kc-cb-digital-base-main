"use client"

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import type { Dict } from '@open-mercato/shared/lib/i18n/context'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { ThemeProvider } from '@open-mercato/ui/theme/ThemeProvider'
import { QueryProvider } from '@open-mercato/ui/theme/QueryProvider'
import { FrontendLayout } from '@open-mercato/ui/frontend/Layout'
import { AuthFooter } from '@open-mercato/ui/frontend/AuthFooter'
import { ClientBootstrapProvider, resolveClientBootstrapProfile } from '@/components/ClientBootstrap'
import { GlobalNoticeBars } from '@/components/GlobalNoticeBars'
import { ComponentOverridesBootstrap } from '@/components/ComponentOverridesBootstrap'
import { publishPasswordPolicyEnv, type PasswordPolicyEnv } from '@/lib/password-policy-env'

type AppProvidersProps = {
  children: ReactNode
  locale: Locale
  dict: Dict
  localeLocked: boolean
  supportedLocales: readonly Locale[]
  demoModeEnabled: boolean
  noticeBarsEnabled: boolean
  passwordPolicyEnv: PasswordPolicyEnv
}

export function AppProviders({ children, locale, dict, localeLocked, supportedLocales, demoModeEnabled, noticeBarsEnabled, passwordPolicyEnv }: AppProvidersProps) {
  // Before the route renders: the auth forms resolve the password policy from `process.env` at
  // render time and Next cannot inline the dynamic lookup they use. Idempotent, browser-only.
  publishPasswordPolicyEnv(passwordPolicyEnv)
  const profile = resolveClientBootstrapProfile(usePathname())
  return (
    <I18nProvider locale={locale} dict={dict} localeLocked={localeLocked} supportedLocales={supportedLocales}>
      <ClientBootstrapProvider profile={profile}>
        <ComponentOverridesBootstrap profile={profile}>
          <ThemeProvider>
            <QueryProvider>
              <FrontendLayout footer={<AuthFooter />}>{children}</FrontendLayout>
              {noticeBarsEnabled ? <GlobalNoticeBars demoModeEnabled={demoModeEnabled} /> : null}
            </QueryProvider>
          </ThemeProvider>
        </ComponentOverridesBootstrap>
      </ClientBootstrapProvider>
    </I18nProvider>
  )
}
