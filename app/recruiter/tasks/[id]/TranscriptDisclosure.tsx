'use client';

import { useRef, type ReactNode } from 'react';

/**
 * A <details> that reports the first time it is opened (PRD §5 metric 4).
 *
 * The markup stays in the page — this component only wraps it — so the tracking
 * cannot drift from what the recruiter actually sees.
 *
 * Two deliberate limits:
 *  · Only opening counts. `onToggle` also fires on close, and a close is not a
 *    second read.
 *  · Once per mount. Collapsing and re-expanding the same transcript on the same
 *    page view is one person looking at one thing; counting it twice would make
 *    a fidgety recruiter look more diligent than an attentive one. Coming back
 *    on a later page load does record again, which is real re-reading.
 */
export default function TranscriptDisclosure({
  className,
  onFirstOpen,
  children,
}: {
  className?: string;
  onFirstOpen: () => Promise<void>;
  children: ReactNode;
}) {
  const reported = useRef(false);

  return (
    <details
      className={className}
      onToggle={(e) => {
        if (!e.currentTarget.open || reported.current) return;
        reported.current = true;
        // Not awaited: the disclosure must open at native speed whatever the
        // network does, and a failed recording is not the recruiter's problem.
        void onFirstOpen().catch(() => {});
      }}
    >
      {children}
    </details>
  );
}
