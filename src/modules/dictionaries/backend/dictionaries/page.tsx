/**
 * Main-menu entry for the dictionary library — `/backend/dictionaries`.
 *
 * The same page body the settings sidebar renders (`/backend/config/dictionaries`, whose navigation
 * placement belongs to the installed module) mounted a second time under the app's own metadata:
 * business staff maintain the vocabulary every picker in the app reads (currency, unit, container
 * type, payment terms, brand…), and the settings gear is not on their path. See
 * `.ai/specs/2026-09-24-dictionary-main-menu-entry.md` and `src/modules/dictionaries/README.md`.
 *
 * Nothing is duplicated but the route: the list, the entry editor, the scope rules and the write
 * guards all live in `components/DictionariesLibrary.tsx`, reached through the sibling page file.
 */
export { default } from '../config/dictionaries/page'
