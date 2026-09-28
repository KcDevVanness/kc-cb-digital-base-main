import { ADS_ENDPOINT_PATHS, ADS_ENDPOINTS, type AdsEndpoint } from './ads'
import { SUPPLY_ENDPOINT_PATHS, SUPPLY_ENDPOINTS, type SupplyEndpoint } from './supply'

/**
 * Every endpoint the pull knows, in one place: the client needs a path per endpoint, the adapter
 * needs the entity list, and both need the same union type. Kept separate from `adapter.ts` so the
 * client does not import the adapter (which would be a cycle).
 */
export const RU_ENDPOINTS = [...SUPPLY_ENDPOINTS, ...ADS_ENDPOINTS] as const
export type RuEndpoint = (typeof RU_ENDPOINTS)[number]
export type { AdsEndpoint, SupplyEndpoint }

export const RU_ENDPOINT_PATHS: Record<RuEndpoint, string> = {
  ...SUPPLY_ENDPOINT_PATHS,
  ...ADS_ENDPOINT_PATHS,
}

export function isRuEndpoint(value: string): value is RuEndpoint {
  return (RU_ENDPOINTS as readonly string[]).includes(value)
}
