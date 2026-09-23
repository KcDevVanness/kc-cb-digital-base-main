import DictionariesLibrary from '../../../components/DictionariesLibrary'

/**
 * App-owned page body for `/backend/config/dictionaries`.
 *
 * This file shadows `@open-mercato/core/modules/dictionaries/backend/config/dictionaries/page.tsx`:
 * an app module directory (`src/modules/<id>`) wins over the package for the same logical file path,
 * so the generated backend manifest imports this page instead of the installed one. Only the page
 * body is owned here — `page.meta.ts` is still the package's, so navigation placement, the
 * `dictionaries.view` + `dictionaries.manage` gates, the page title and the breadcrumb stay
 * installed, exactly as they were.
 *
 * Why the body is replaced: the installed manager rendered name + key + an 「Inherited」 badge and
 * never named the organization a dictionary belongs to, while this deployment keeps one copy of each
 * shared vocabulary per organization under identical names. See
 * `src/modules/dictionaries/components/DictionariesLibrary.tsx` for the scope rules and
 * `src/modules/dictionaries/README.md` for the contract and the rollback.
 */
export default function DictionariesConfigurationPage() {
  return <DictionariesLibrary />
}
