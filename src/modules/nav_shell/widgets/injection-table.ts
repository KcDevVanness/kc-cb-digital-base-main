import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Where the navigation tree is mounted.
 *
 * One spot: the shell's main sidebar nav. The tree is the only thing this module draws, and the
 * entry is inert without the shell — nothing else in the app renders that spot.
 */
export const injectionTable: ModuleInjectionTable = {
  'backend:sidebar:nav': {
    widgetId: 'nav_shell.injection.sidebar-tree',
    priority: 10,
  },
}

export default injectionTable
