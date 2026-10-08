import { SafetyExperience } from '@/components/safety';

export const instant = false;

export default async function SafetyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SafetyExperience key={id} caseId={id} />;
}
