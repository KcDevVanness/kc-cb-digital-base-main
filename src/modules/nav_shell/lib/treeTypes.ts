import type {
  BackendChromeNavGroup,
  BackendChromeNavItem,
} from '@open-mercato/shared/modules/navigation/backendChrome'

/**
 * The navigation tree payload, in types only.
 *
 * Kept apart from `buildNavTree.ts` so the client component can import the shape without pulling the
 * server builder (which reaches into the auth service and the ORM) into the browser bundle.
 */

export type NavTreeItem = BackendChromeNavItem & {
  /** The features the page declares, so the client can re-check the server's filtering. */
  requireFeatures?: string[]
}

export type NavTreeGroup = Omit<BackendChromeNavGroup, 'items'> & {
  items: NavTreeItem[]
  /** The domain's icon; the chrome group contract has no icon field, so it rides along additively. */
  iconName?: string
}

export type NavTreePayload = {
  groups: NavTreeGroup[]
  /** `false` for an unrestricted caller: the client must not re-filter what the server kept. */
  featureFiltered: boolean
}
