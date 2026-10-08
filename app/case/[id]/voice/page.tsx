import VoiceCaseClient from './VoiceCaseClient';

export const instant = false;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VoiceCaseClient id={id} />;
}
