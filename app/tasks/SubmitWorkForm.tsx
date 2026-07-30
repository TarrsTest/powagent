'use client';

import { useActionState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperPlane, faTriangleExclamation, faCircleCheck } from '@fortawesome/free-solid-svg-icons';
import { submitTask } from './actions';

// Client component only so the action's result can be shown. The page renders
// this only when the task is still accepting work; the action re-checks anyway,
// which is what catches a deadline that passes between render and submit.
export default function SubmitWorkForm({ taskId }: { taskId: string }) {
  const [state, formAction, pending] = useActionState(submitTask, null);

  return (
    <details className="mt-3 border-t border-slate-100 pt-3">
      <summary className="text-sm font-semibold cursor-pointer text-sky-700 select-none">Submit work</summary>
      <form action={formAction} className="space-y-2 mt-3">
        <input type="hidden" name="task_id" value={taskId} />
        <textarea
          name="result_md"
          required
          rows={3}
          placeholder="Your result / deliverable (markdown)"
          className="field-area"
        />
        <textarea
          name="conversation_md"
          rows={3}
          placeholder="Paste your agent conversation transcript (markdown)"
          className="field-area"
        />
        <div className="text-xs text-slate-400 text-center">— or —</div>
        <input
          name="conversation_url"
          type="url"
          placeholder="https://link-to-your-agent-conversation"
          className="field h-9"
        />

        {state?.error && (
          <p className="text-sm text-red-600 flex items-start gap-2">
            <FontAwesomeIcon icon={faTriangleExclamation} className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {state.error}
          </p>
        )}
        {state?.ok && (
          <p className="text-sm text-emerald-700 flex items-center gap-2">
            <FontAwesomeIcon icon={faCircleCheck} className="w-3.5 h-3.5" />
            Submitted — it will appear above.
          </p>
        )}

        <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
          <FontAwesomeIcon icon={faPaperPlane} className="w-3 h-3" />
          {pending ? 'Submitting…' : 'Submit'}
        </button>
      </form>
    </details>
  );
}
