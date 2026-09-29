"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import CockpitKpiWidget from '../../../components/CockpitKpiWidget'

export default function InTransitWidget({ refreshToken }: DashboardWidgetComponentProps) {
  return <CockpitKpiWidget metric="in-transit" refreshToken={refreshToken} />
}
