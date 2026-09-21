// Widen the framework's locale registry so `zh` is a first-class `Locale`
// everywhere (types are the compile-time half of the extension point; the
// runtime half is `registerLocales(['zh'])` in src/lib/i18n/register-dictionary-loader.ts).
// Which locales a request is actually served — English and Chinese only — is
// src/lib/i18n/served-locales.ts.
//
// The `export {}` is load-bearing: a module augmentation must live in a module,
// otherwise this file would declare an ambient module and shadow the real types.
export {}

declare module '@open-mercato/shared/lib/i18n/config' {
  interface LocaleRegistry {
    zh: true
  }
}
