import VoiceCaseClient from '../voice/VoiceCaseClient';

export const instant = false;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VoiceCaseClient key={id} id={id} immersive />;
}
