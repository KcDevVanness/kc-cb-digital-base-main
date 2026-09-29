import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
const WidgetClient = lazyDashboardWidget(() => import('./widget.client'))

/**
 * One cockpit figure on the dashboard host. The data comes from the same summary endpoint the
 * cockpit page reads, so the widget and the page cannot disagree, and the figure keeps the snapshot
 * date it was read from.
 */
const widget: DashboardWidgetModule = {
  metadata: {
    id: 'boss_cockpit.dashboard.inTransit',
    title: 'In transit',
    description: '在途件数与金额 — shipments the RU side reports as in transit.',
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
