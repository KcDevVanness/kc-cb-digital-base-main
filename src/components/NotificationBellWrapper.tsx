"use client"
import { NotificationBell } from '@open-mercato/ui/backend/notifications'
import { getNotificationRenderers } from '@/.mercato/generated/notifications.client.generated'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { withNavigatingActionRenderers } from '@/components/notifications/navigatingActionRenderers'

// Renderer-backed types need the repeat-click repair: the installed renderers navigate only
// through the action response, which the host answers with 409 once the action was executed.
const notificationRenderers = withNavigatingActionRenderers(getNotificationRenderers())

export function NotificationBellWrapper() {
  const t = useT()
  return <NotificationBell t={t} customRenderers={notificationRenderers} />
}
