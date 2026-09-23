import PartyDetail from '../../../components/PartyDetail'

export default function PartyDetailPage({ params }: { params?: { id?: string } }) {
  const partyId = params?.id
  if (!partyId) return null

  return <PartyDetail partyId={partyId} />
}
