'use client';

import { useActionState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faKey, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { issueKey } from './actions';

// Issues a key and shows the raw value ONCE (server never returns it again).
export default function IssueKeyForm() {
  const [state, formAction, pending] = useActionState(issueKey, null);

  return (
    <div className="space-y-3">
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-40"
        >
          <FontAwesomeIcon icon={faKey} className="w-3.5 h-3.5" />
          {pending ? 'Generating…' : 'Generate new API key'}
        </button>
      </form>

      {state?.error && (
        <p className="text-sm text-red-600 flex items-center gap-2">
          <FontAwesomeIcon icon={faTriangleExclamation} className="w-3.5 h-3.5" />
          {state.error}
        </p>
      )}

      {state?.rawKey && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-xs font-semibold text-amber-800 mb-2">
            Copy this key now — it won’t be shown again.
          </p>
          <code className="block text-xs font-mono break-all bg-white border border-amber-200 rounded px-2 py-1.5">
            {state.rawKey}
          </code>
        </div>
      )}
    </div>
  );
}
