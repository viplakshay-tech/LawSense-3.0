import GuideClient from './GuideClient';

export const instant = false;

export default async function LegalGuidePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <GuideClient id={id} />;
}
