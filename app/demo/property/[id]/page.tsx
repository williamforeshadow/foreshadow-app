import { redirect } from 'next/navigation';

// Demo property root → Knowledge (Information) tab, mirroring the real
// /properties/[id] → /knowledge redirect but kept inside /demo.
export default async function DemoPropertyRoot({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/demo/property/${id}/knowledge`);
}
