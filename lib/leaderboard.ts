/**
 * Candidate ranking (PRD §9). One module so the recruiter leaderboard page and
 * GET /v1/evaluations rank identically — they disagreed before, which is how
 * the original endpoint ended up listing the same candidate several times.
 *
 * Two rules define a ranking:
 *   1. A submission's score is its LATEST evaluation with status='done'.
 *      Evaluations are append-only, so re-running a rubric adds a row; the most
 *      recent run is the current verdict. Rows still queued/running/errored have
 *      no score and are excluded rather than sorted as 0.
 *   2. A candidate's score is their BEST submission. Multiple attempts are an
 *      allowed part of the task (max_submissions_per_candidate), so the
 *      employer is shown the candidate's strongest work.
 */

export type EvalJson = {
  score?: number;
  rationale?: string;
  flags?: string[];
  dimensions?: { name: string; score: number; comment?: string }[];
} | null;

export type RankableEvaluation = {
  submission_id: string;
  status: string;
  ran_at: string | null;
  output_json: EvalJson;
};

export type RankableSubmission = {
  id: string;
  candidate_id: string;
  submitted_at: string;
  candidate?: { email: string | null } | null;
};

export type RankedCandidate<E extends RankableEvaluation> = {
  candidateId: string;
  email: string | null;
  submissionId: string;
  submittedAt: string;
  score: number;
  evaluation: E;
};

/** Latest done evaluation per submission_id. */
export const latestDoneBySubmission = <E extends RankableEvaluation>(
  evaluations: E[],
): Map<string, E> => {
  const out = new Map<string, E>();
  for (const e of evaluations) {
    if (e.status !== 'done') continue;
    const cur = out.get(e.submission_id);
    // ran_at is an ISO string, so lexicographic compare is chronological.
    if (!cur || (e.ran_at ?? '') > (cur.ran_at ?? '')) out.set(e.submission_id, e);
  }
  return out;
};

export const scoreOf = (e: RankableEvaluation | undefined): number | null => {
  const s = e?.output_json?.score;
  return typeof s === 'number' ? s : null;
};

/**
 * Rank candidates for one task: best scored submission each, highest first.
 * Candidates whose submissions have no completed evaluation are omitted —
 * "not yet scored" is not a position on a leaderboard.
 */
export const rankCandidates = <E extends RankableEvaluation>(
  submissions: RankableSubmission[],
  evaluations: E[],
): RankedCandidate<E>[] => {
  const latest = latestDoneBySubmission(evaluations);
  const best = new Map<string, RankedCandidate<E>>();

  for (const s of submissions) {
    const evaluation = latest.get(s.id);
    const score = scoreOf(evaluation);
    if (!evaluation || score === null) continue;

    const cur = best.get(s.candidate_id);
    if (!cur || score > cur.score) {
      best.set(s.candidate_id, {
        candidateId: s.candidate_id,
        email: s.candidate?.email ?? null,
        submissionId: s.id,
        submittedAt: s.submitted_at,
        score,
        evaluation,
      });
    }
  }

  return [...best.values()].sort((a, b) => b.score - a.score);
};

/**
 * How many of these submissions have actually been evaluated.
 *
 * Counts by the same rule the leaderboard ranks by — a submission whose only
 * evaluation rows are queued, running or errored is NOT evaluated, no matter how
 * many rows it has. Counting evaluation rows instead would tell a recruiter that
 * work is scored when it failed.
 */
export const countEvaluatedSubmissions = (
  submissions: { id: string }[],
  evaluations: RankableEvaluation[],
): number => {
  const latest = latestDoneBySubmission(evaluations);
  return submissions.filter((s) => latest.has(s.id)).length;
};

export type TaskRef = { id: string; title: string };

export type OrgTopCandidate<E extends RankableEvaluation> = {
  candidateId: string;
  email: string | null;
  taskId: string;
  taskTitle: string;
  submissionId: string;
  score: number;
  evaluation: E;
};

/**
 * The org's strongest candidates across every task, for the recruiter overview.
 *
 * Ranking is per task — a score only means something relative to the task and
 * rubric it came from, so submissions are never pooled across tasks. The results
 * are then merged, and a candidate who appears on more than one task is listed
 * ONCE at their best score, with the task it came from. That is the same "one row
 * per candidate" rule rankCandidates enforces, applied one level up: without it
 * a strong candidate would crowd out everyone else on this list.
 */
export const topCandidatesAcrossTasks = <E extends RankableEvaluation>(
  tasks: TaskRef[],
  submissions: (RankableSubmission & { task_id: string })[],
  evaluations: E[],
  limit = 5,
): OrgTopCandidate<E>[] => {
  const best = new Map<string, OrgTopCandidate<E>>();

  for (const task of tasks) {
    const taskSubs = submissions.filter((s) => s.task_id === task.id);
    if (taskSubs.length === 0) continue;

    for (const ranked of rankCandidates(taskSubs, evaluations)) {
      const cur = best.get(ranked.candidateId);
      if (cur && cur.score >= ranked.score) continue;
      best.set(ranked.candidateId, {
        candidateId: ranked.candidateId,
        email: ranked.email,
        taskId: task.id,
        taskTitle: task.title,
        submissionId: ranked.submissionId,
        score: ranked.score,
        evaluation: ranked.evaluation,
      });
    }
  }

  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
};
