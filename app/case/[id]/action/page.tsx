import { CaseActionExperience } from '@/components/case-action/CaseActionExperience';

export const instant = false;

export default async function CaseActionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CaseActionExperience key={id} caseId={id} />;
}
