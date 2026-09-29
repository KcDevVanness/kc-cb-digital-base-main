import { NextResponse } from 'next/server'
import { handleTradeTypeChannelsRequest } from '../../../lib/tradeTypeChannels.server'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.quotes.view'] },
}

/** Trade-type channel ids for the current organization, for the quote surfaces. */
export async function GET(request: Request): Promise<Response> {
  try {
    return await handleTradeTypeChannelsRequest(request)
  } catch {
    return NextResponse.json({ error: 'Could not resolve the trade-type channels' }, { status: 500 })
  }
}
