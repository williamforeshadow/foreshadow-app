import { redirect } from 'next/navigation';

// Property detail root redirects to the Knowledge primary tab. The eight
// knowledge sub-sections (Information, Access, Connectivity, Interior,
// Exterior, Vendors, Notes, Documents) all live under `/knowledge/**`, with
// the bare `/knowledge` URL rendering the Information pill.
//
// Tasks and Schedule are separate primary tabs at `/tasks` and `/schedule`
// and are not reachable from this redirect.
export default async function PropertyDetailRoot({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/properties/${id}/knowledge`);
}
