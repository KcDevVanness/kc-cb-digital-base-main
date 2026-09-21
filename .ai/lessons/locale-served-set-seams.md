---
title: "Removing a platform locale needs three seams narrowed, not one"
modules: ["platform"]
areas: ["architecture", "framework-context"]
topics: ["i18n", "locale-registry", "served-locales", "dictionary-loader", "generate"]
---

# Removing a platform locale needs three seams narrowed, not one

**Context**: This app serves only English and Chinese, while the platform baseline is
`en | pl | es | de | ko`. Deleting `src/i18n/{pl,es,de,ko}.json` looked like the whole job
and was not: `loadDictionary` falls back to the default locale for any code it cannot find,
so a stale `locale=de` cookie or `Accept-Language: de` still produced a 200 that *looked*
fixed while the language switcher kept offering German.

**Problem**: No single module can express "subtract a base locale". `locales` is the
framework's shipped baseline, `registerLocales` only ever adds, and the dictionary loader,
`detectLocale` and the `POST /api/auth/locale` handler each consult a different set. Fixing
whichever one the symptom appears in leaves the others inconsistent — deleting dictionaries
in particular changes nothing observable, because the fallback hides it.

**Rule**: Pick one owner per decision and wire all three seams to it.
`src/lib/i18n/app-locales.ts` owns the list; `src/lib/i18n/served-locales.ts` owns the
request-facing half (`resolveServedLocales` for layouts, `registerServedLocalesResolver`
from the app DI registrar for route handlers); `src/lib/i18n/register-dictionary-loader.ts`
resolves only registered locales and answers English for anything else. A non-baseline
locale needs both halves of the extension point — `declare module` in `src/types/i18n.d.ts`
for the type and `registerLocales(['zh'])` at import time for the runtime. Run
`yarn generate`: the per-locale dictionary shard is generated from the files present, so a
new `src/modules/<id>/i18n/zh.json` does not load until it has been regenerated.

**Applies to**: `src/lib/i18n/*`, `src/types/i18n.d.ts`, `src/app/**/layout.tsx`,
`src/di.ts`, `src/i18n/*.json`, `src/modules/*/i18n/*.json`, `.mercato/generated/modules.i18n.*`.
