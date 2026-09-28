import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
const WidgetClient = lazyDashboardWidget(() => import('./widget.client'))

/**
 * One cockpit figure on the dashboard host. The data comes from the same summary endpoint the
 * cockpit page reads, so the widget and the page cannot disagree, and the figure keeps the snapshot
 * date it was read from.
 */
const widget: DashboardWidgetModule = {
  metadata: {
    id: 'boss_cockpit.dashboard.overstock',
    title: 'Overstock',
    description: '积压金额 — stock whose coverage exceeds the RU overstock threshold.',
    features: ['dashboards.view', 'boss_cockpit.view'],
    defaultSize: 'sm',
    defaultEnabled: false,
    tags: ['boss_cockpit', 'ru_sync', 'kpi'],
    category: 'boss_cockpit',
    icon: 'gauge',
    supportsRefresh: true,
  },
  Widget: WidgetClient,
}

export default widget
