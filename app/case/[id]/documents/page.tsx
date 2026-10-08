import { DocumentReviewWorkspace } from '@/components/document-review/DocumentReviewWorkspace';

export const instant = false;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DocumentReviewWorkspace caseId={id} />;
}
