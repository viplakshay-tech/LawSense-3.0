import { DraftingStudio } from '@/components/drafting';

export const instant = false;

export default async function DraftingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DraftingStudio caseId={id} />;
}
