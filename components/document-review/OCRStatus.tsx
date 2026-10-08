import { CheckCircle2, CircleHelp, LoaderCircle, TriangleAlert } from 'lucide-react';

export type OCRProcessingStatus = 'NOT_REPORTED' | 'QUEUED' | 'PROCESSING' | 'COMPLETE' | 'UNAVAILABLE' | 'FAILED';

const statusContent: Record<OCRProcessingStatus, { label: string; description: string; tone: string; icon: typeof CircleHelp }> = {
  NOT_REPORTED: {
    label: 'OCR status not reported',
    description: 'The document service has not supplied an OCR status.',
    tone: 'border-zinc-500/20 bg-zinc-500/[0.05] text-zinc-300',
    icon: CircleHelp,
  },
  QUEUED: {
    label: 'OCR queued',
    description: 'The document service reports that OCR is queued.',
    tone: 'border-blue-400/20 bg-blue-400/[0.05] text-blue-200',
    icon: LoaderCircle,
  },
  PROCESSING: {
    label: 'OCR processing',
    description: 'The document service reports that OCR is processing.',
    tone: 'border-blue-400/20 bg-blue-400/[0.05] text-blue-200',
    icon: LoaderCircle,
  },
  COMPLETE: {
    label: 'OCR complete',
    description: 'The document service reports OCR complete. Text is shown only when supplied separately.',
    tone: 'border-emerald-400/20 bg-emerald-400/[0.05] text-emerald-200',
    icon: CheckCircle2,
  },
  UNAVAILABLE: {
    label: 'OCR unavailable',
    description: 'The document service reports OCR unavailable.',
    tone: 'border-amber-400/20 bg-amber-400/[0.05] text-amber-200',
    icon: TriangleAlert,
  },
  FAILED: {
    label: 'OCR failed',
    description: 'The document service reports OCR failed.',
    tone: 'border-rose-400/20 bg-rose-400/[0.05] text-rose-200',
    icon: TriangleAlert,
  },
};

export function OCRStatus({ status, detail }: { status: OCRProcessingStatus; detail?: string | null }) {
  const content = statusContent[status];
  const Icon = content.icon;

  return (
    <section aria-label="OCR status" className={`rounded-xl border p-4 ${content.tone}`}>
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Icon aria-hidden="true" className={`h-4 w-4 ${status === 'PROCESSING' ? 'animate-spin motion-reduce:animate-none' : ''}`} />
        {content.label}
      </h3>
      <p className="mt-2 text-xs leading-5 opacity-80">{detail || content.description}</p>
    </section>
  );
}
