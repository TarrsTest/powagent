'use client';

import { useActionState, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faKey, faTriangleExclamation, faCircleCheck } from '@fortawesome/free-solid-svg-icons';
import { issueKey } from './actions';

/** One tickable permission, described by the server. */
export type ScopeOption = { value: string; label: string; description: string };

/**
 * Issues a key and shows the raw value ONCE (the server never returns it again).
 *
 * The options are passed in rather than read from lib/apikey.ts, which imports
 * node:crypto and has no business in a browser bundle. This component is purely
 * presentational: the server owns which scopes exist, re-derives the owner type
 * from the signed-in user's profile and re-validates every submitted value, so
 * a tampered prop or a hand-rolled POST cannot widen a key.
 */
export default function IssueKeyForm({ scopeOptions }: { scopeOptions: ScopeOption[] }) {
  const [state, formAction, pending] = useActionState(issueKey, null);
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (scope: string) =>
    setSelected((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );

  const allSelected = selected.length === scopeOptions.length;
  const none = selected.length === 0;

  return (
    <div className="space-y-3">
      <form action={formAction} className="space-y-3">
        {/* legend must be fieldset's FIRST child or it stops being the group's
            accessible name — it cannot be tucked into a flex row with the
            toggle. The toggle sits beside the helper text instead. */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-900">Permissions</legend>
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-slate-500">
              A key can only do what you tick here. Pick the narrowest set that does the job — you
              can always issue another key.
            </p>
            <button
              type="button"
              onClick={() => setSelected(allSelected ? [] : scopeOptions.map((s) => s.value))}
              className="text-xs text-sky-700 hover:underline cursor-pointer shrink-0"
            >
              {allSelected ? 'Clear all' : 'Select all'}
            </button>
          </div>

          <div className="space-y-1.5 pt-1">
            {scopeOptions.map(({ value, label, description }) => (
              <label
                key={value}
                className="flex gap-2.5 items-start rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  name="scopes"
                  value={value}
                  checked={selected.includes(value)}
                  onChange={() => toggle(value)}
                  className="mt-0.5 w-4 h-4 accent-sky-600 cursor-pointer"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-800">
                    {label} <code className="text-xs font-mono text-slate-400">{value}</code>
                  </span>
                  <span className="block text-xs text-slate-500">{description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending || none} className="btn btn-dark disabled:opacity-50 disabled:cursor-not-allowed">
            <FontAwesomeIcon icon={faKey} className="w-3.5 h-3.5" />
            {pending ? 'Generating…' : 'Generate new API key'}
          </button>
          {/* Announced, because the submit button's disabled state depends on it
              and a screen-reader user needs to hear why it will not submit. */}
          <span className="text-xs text-slate-500" aria-live="polite">
            {none
              ? 'Select at least one permission.'
              : `${selected.length} of ${scopeOptions.length} selected`}
          </span>
        </div>
      </form>

      {state?.error && (
        <p className="text-sm text-red-600 flex items-center gap-2" role="alert">
          <FontAwesomeIcon icon={faTriangleExclamation} className="w-3.5 h-3.5" />
          {state.error}
        </p>
      )}

      {state?.rawKey && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-2" role="status">
          <p className="text-xs font-semibold text-amber-800 flex items-center gap-2">
            <FontAwesomeIcon icon={faCircleCheck} className="w-3.5 h-3.5" />
            Copy this key now — it won’t be shown again.
          </p>
          <code className="block text-xs font-mono break-all bg-white border border-amber-200 rounded px-2 py-1.5">
            {state.rawKey}
          </code>
          {state.scopes && (
            <p className="text-xs text-amber-800">
              Granted:{' '}
              {state.scopes.map((s) => (
                <code key={s} className="font-mono mr-1.5">{s}</code>
              ))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
