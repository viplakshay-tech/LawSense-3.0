import LegalTwinClient from './LegalTwinClient';

export const instant = false;

export default async function LegalTwinPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LegalTwinClient id={id} />;
}
