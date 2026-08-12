/**
 * The rules that decide whether a candidate may still submit to a task
 * (PRD §9.9).
 *
 * Two entry points reach the same decision — the /tasks Server Action and
 * POST /v1/submissions — and they used to disagree: `deadline_at` was displayed
 * but enforced on neither path, and `max_submissions_per_candidate` was checked
 * only by the API, so a browser could exceed the cap. The rules therefore live
 * here rather than being re-derived at each call site.
 *
 * Deliberately pure: no Supabase client, no I/O, no clock of its own. Callers
 * fetch the task's limits and the candidate's current state and pass them in.
 * That is what makes the rules testable without a database
 * (test/submissionRules.test.ts) and what keeps the two paths honest — there is
 * only one implementation to get right.
 */

export type TaskLimits = {
  deadline_at: string | null;
  max_submissions_per_candidate: number | null;
};

/**
 * What the caller must look up about this candidate before asking. Grouped
 * rather than passed as loose positional arguments so a call site cannot
 * silently swap the count for the flag.
 */
export type CandidateState = {
  /** Submissions this candidate has already made for this task. */
  existingCount: number;
  /** Whether a `task_acceptances` row exists for (task, candidate). */
  hasAccepted: boolean;
};

export type SubmissionDenial = {
  /** Stable machine-readable reason. Returned to API callers as `code`. */
  code: 'deadline_passed' | 'task_not_accepted' | 'submission_limit_reached';
  /** HTTP status for the API path. Every denial is a state conflict, not bad input. */
  status: number;
  /** Shown to the candidate in the UI and returned as the API error message. */
  message: string;
};

/**
 * A deadline we cannot parse is treated as absent. Refusing every submission
 * because a timestamp is malformed would be a worse failure than not enforcing
 * a limit we can't read.
 */
export const isPastDeadline = (
  deadlineAt: string | null | undefined,
  now: Date = new Date(),
): boolean => {
  if (!deadlineAt) return false;
  const deadline = Date.parse(deadlineAt);
  if (Number.isNaN(deadline)) return false;
  return now.getTime() > deadline;
};

/**
 * A null cap means unlimited — that is what an absent value means in the schema,
 * not "zero allowed". A cap of 0 or less does close the task.
 */
export const hasReachedSubmissionCap = (
  max: number | null | undefined,
  existingCount: number,
): boolean => {
  if (max === null || max === undefined) return false;
  return existingCount >= max;
};

export type DeadlineTask = { deadline_at: string | null };

/**
 * Tasks whose deadline is still ahead, soonest first — "what closes next" for
 * the recruiter overview.
 *
 * Tasks with no deadline are omitted because nothing is due, and past ones are
 * omitted because they are no longer upcoming; `isPastDeadline` tells you about
 * those separately. Sorting is by parsed timestamp rather than string order, so
 * a mix of offset formats cannot silently misorder the list.
 */
export const upcomingDeadlines = <T extends DeadlineTask>(
  tasks: T[],
  now: Date = new Date(),
  limit = 5,
): { task: T; deadlineAt: string; msRemaining: number }[] =>
  tasks
    .flatMap((task) => {
      if (!task.deadline_at) return [];
      const at = Date.parse(task.deadline_at);
      if (Number.isNaN(at)) return [];
      const msRemaining = at - now.getTime();
      if (msRemaining < 0) return [];
      return [{ task, deadlineAt: task.deadline_at, msRemaining }];
    })
    .sort((a, b) => a.msRemaining - b.msRemaining)
    .slice(0, limit);

/**
 * Returns null when the submission is allowed, or the reason it is not.
 *
 * Order is deliberate, because only the first reason is shown:
 *  1. Deadline — once a task is closed, nothing the candidate does reopens it.
 *     Telling them to accept first would send them down a dead end.
 *  2. Acceptance — the entry gate. Accepting is what puts a candidate in the
 *     funnel, so a submission without it is work the employer never saw coming
 *     and a hole in the completion metric (PRD §5, §9.7).
 *  3. Cap — about how much you have done inside a task you are already in.
 *     Reporting "you have used all your attempts" to someone who never accepted
 *     would be nonsense.
 */
export const checkSubmissionAllowed = (
  limits: TaskLimits,
  candidate: CandidateState,
  now: Date = new Date(),
): SubmissionDenial | null => {
  if (isPastDeadline(limits.deadline_at, now)) {
    return {
      code: 'deadline_passed',
      status: 409,
      message: 'The deadline for this task has passed - submissions are closed.',
    };
  }

  if (!candidate.hasAccepted) {
    return {
      code: 'task_not_accepted',
      status: 409,
      message: 'Accept this task before submitting to it.',
    };
  }

  const max = limits.max_submissions_per_candidate;
  if (hasReachedSubmissionCap(max, candidate.existingCount)) {
    return {
      code: 'submission_limit_reached',
      status: 409,
      message:
        max === 1
          ? 'This task allows one submission per candidate, and you have already used it.'
          : `This task allows ${max} submissions per candidate, and you have used all of them.`,
    };
  }

  return null;
};
