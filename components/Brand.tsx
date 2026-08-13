import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBolt } from '@fortawesome/free-solid-svg-icons';

/** powagent wordmark + mark. Links home. Used in page headers for consistency. */
export default function Brand({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 group">
      <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-elevated text-accent shadow-sm">
        <FontAwesomeIcon icon={faBolt} className="w-3.5 h-3.5" />
      </span>
      <span className="text-[15px] font-extrabold tracking-tight text-ink">
        powagent
      </span>
    </Link>
  );
}
