import type {
  InjectionWidgetComponentProps,
  InjectionWidgetModule,
} from '@open-mercato/shared/modules/widgets/injection'
import SidebarNavTree from '../../../components/SidebarNavTree'

/**
 * The navigation tree as an injected widget, mounted at `backend:sidebar:nav`.
 *
 * A rendered widget rather than injected menu items: the built-in sidebar accepts injected items but
 * renders only one level of children, and this tree is three levels deep by design. The spot is
 * rendered inside the shell's `<nav>` on desktop; the mobile drawer deliberately does not render
 * injection spots, so the same component is passed to the shell's `mobileSidebarSlot` as well.
 */
function SidebarTreeWidget(_props: InjectionWidgetComponentProps) {
  return <SidebarNavTree />
}

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'nav_shell.injection.sidebar-tree',
    title: 'Navigation tree',
    priority: 10,
  },
  Widget: SidebarTreeWidget,
}

export default widget
