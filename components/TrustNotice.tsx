type TrustNoticeProps = {
  variant?: 'light' | 'dark';
};

const styles = {
  light: 'border-amber-200 bg-amber-50 text-zinc-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-zinc-300',
  dark: 'border-amber-300/15 bg-amber-300/[0.035] text-[#c4cbd8]',
  headingLight: 'text-zinc-900 dark:text-zinc-100',
  headingDark: 'text-[#ffddb8]',
  linkLight: 'text-blue-700 underline underline-offset-2 dark:text-blue-300',
  linkDark: 'text-[#ffddb8] underline underline-offset-2',
} as const;

export function TrustNotice({ variant = 'light' }: TrustNoticeProps) {
  const dark = variant === 'dark';

  return (
    <aside
      aria-label="LawSense limits and demo data storage"
      className={`rounded-xl border px-4 py-3 text-xs leading-5 ${styles[variant]}`}
    >
      <p>
        <strong className={dark ? styles.headingDark : styles.headingLight}>
          Information organizer, not legal advice.
        </strong>{' '}
        LawSense is not a lawyer and does not provide individualized legal advice. Source coverage is
        limited, and current status or fit for your jurisdiction may be unresolved. For case-specific
        advice, deadlines, or urgent legal steps, contact a qualified lawyer or legal services authority.{' '}
        <a
          className={dark ? styles.linkDark : styles.linkLight}
          href="https://nalsa.gov.in/legal-services/"
          target="_blank"
          rel="noreferrer"
        >
          NALSA legal services information
        </a>
        . If anyone is in immediate danger, contact local emergency services.
      </p>
      <p className="mt-2">
        <strong className={dark ? styles.headingDark : styles.headingLight}>Demo data storage.</strong>{' '}
        Case text and uploaded files are stored on the server running this LawSense instance. This demo
        has no sign-in or per-case access controls; use synthetic data only.
      </p>
    </aside>
  );
}
