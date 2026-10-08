'use client';

import { LegalGuide } from '@/components/legal-guide';

/** A purely presentational map companion; its idle state has no CaseState authority. */
export function TwinGuideCompanion() {
  return (
    <aside aria-label="Optional animated guide to the Living Legal Twin">
      <LegalGuide
        state="idle"
        label="Visual companion"
        detail="Map guide"
        message="The map shows records and explicit links stored in the current CaseState. Color and line style identify each record’s saved evidence status."
        messageKind="notice"
        className="h-full !rounded-xl !border-cyan-100/10 !bg-[#101827] !p-4 !shadow-none"
      />
    </aside>
  );
}
