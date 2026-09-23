"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ComponentType } from 'react'
import type { NotificationRendererProps } from '@open-mercato/shared/modules/notifications/types'

export type NotificationRenderers = Record<string, ComponentType<NotificationRendererProps>>

/**
 * Renderer-backed notification types whose "open the document" affordance dead-ends after the
 * first click, and the app-side repair for it.
 *
 * The installed renderers (`sales/widgets/notifications/SalesOrderCreatedRenderer` and its quote
 * and `wms` siblings) navigate **only** through the action response: they call `onAction(...)`,
 * and `NotificationItem` pushes the `href` the server returns. That href exists once — a repeat
 * POST answers `409 Notification action already executed` (the host refuses to re-run a completed
 * action), `href` comes back `undefined`, so nothing navigates. The renderer keeps drawing the
 * button in every state (`status === 'actioned'` included), so every later click on that item is
 * a dead click that only flashes "执行操作失败".
 *
 * These items are navigation, not a workflow decision: the document link is fixed in the
 * notification row at creation (`linkHref`) and never changes. So the wrapper keeps the host
 * action (it records `action_taken` / read state the first time) and pins the click to
 * `linkHref`, which makes the second, third and hundredth click open the same document.
 *
 * Only wrap a type here when its actions are view-style links: a renderer whose action is a real
 * decision (`commandId`) must keep whatever the host does with a repeat click.
 */
const NAVIGATING_NOTIFICATION_TYPES = [
  'sales.order.created',
  'sales.quote.created',
  'wms.inventory.low_stock',
  'wms.inventory.reservation_shortfall',
] as const

function withNavigatingAction(
  Renderer: ComponentType<NotificationRendererProps>,
): ComponentType<NotificationRendererProps> {
  function NavigatingActionRenderer(props: NotificationRendererProps) {
    const router = useRouter()
    const href = props.notification.linkHref ?? null

    const handleAction = React.useCallback(
      async (actionId: string) => {
        // Already recorded: re-posting only earns a 409 and an error flash, so open the
        // document straight away. (A stale panel still posts — the host answers 409 and the
        // navigation below covers it.)
        if (props.notification.status !== 'actioned') await props.onAction(actionId)
        if (!href) return
        // The host pushes the same href on a first click, so only fill the gap it leaves.
        const [targetPath] = href.split(/[?#]/)
        if (window.location.pathname !== targetPath) router.push(href)
      },
      [href, props, router],
    )

    return <Renderer {...props} onAction={handleAction} />
  }
  NavigatingActionRenderer.displayName = `WithNavigatingAction(${Renderer.displayName ?? Renderer.name ?? 'Renderer'})`
  return NavigatingActionRenderer
}

/** Wrap every renderer-backed type that needs the repeat-click repair; other types pass through. */
export function withNavigatingActionRenderers(
  renderers: NotificationRenderers,
): NotificationRenderers {
  const wrapped: NotificationRenderers = { ...renderers }
  for (const type of NAVIGATING_NOTIFICATION_TYPES) {
    const renderer = wrapped[type]
    if (renderer) wrapped[type] = withNavigatingAction(renderer)
  }
  return wrapped
}
