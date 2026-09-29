"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import CockpitKpiWidget from '../../../components/CockpitKpiWidget'

export default function SupplyGapWidget({ refreshToken }: DashboardWidgetComponentProps) {
  return <CockpitKpiWidget metric="supply-gap" refreshToken={refreshToken} />
}
