import { EvidenceMapWorkspace } from '@/components/evidence-map';

export const instant = false;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EvidenceMapWorkspace caseId={id} />;
}
