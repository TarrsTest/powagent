import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  countEvaluatedSubmissions,
  latestDoneBySubmission,
  rankCandidates,
  scoreOf,
  topCandidatesAcrossTasks,
  type RankableEvaluation,
  type RankableSubmission,
} from '../lib/leaderboard.ts';

const sub = (id: string, candidateId: string, email: string | null = null): RankableSubmission => ({
  id,
  candidate_id: candidateId,
  submitted_at: '2026-07-16T10:00:00+00:00',
  candidate: { email },
});

const ev = (
  submissionId: string,
  status: string,
  ranAt: string | null,
  score?: number,
): RankableEvaluation => ({
  submission_id: submissionId,
  status,
  ran_at: ranAt,
  output_json: score === undefined ? null : { score },
});

describe('scoreOf', () => {
  test('reads a numeric score', () => {
    assert.equal(scoreOf(ev('s1', 'done', null, 72)), 72);
    assert.equal(scoreOf(ev('s1', 'done', null, 0)), 0);
  });

  test('a missing or non-numeric score is null, not zero', () => {
    assert.equal(scoreOf(ev('s1', 'done', null)), null);
    assert.equal(scoreOf(undefined), null);
    assert.equal(
      scoreOf({ submission_id: 's1', status: 'done', ran_at: null, output_json: { score: undefined } }),
      null,
    );
  });
});

describe('latestDoneBySubmission', () => {
  test('keys by submission and keeps only done rows', () => {
    const map = latestDoneBySubmission([
      ev('s1', 'done', '2026-07-16T20:00:00+00:00', 88),
      ev('s2', 'queued', null),
      ev('s3', 'done', '2026-07-16T21:00:00+00:00', 54),
    ]);
    assert.deepEqual([...map.keys()].sort(), ['s1', 's3']);
  });

  test('picks the most recent run, not the highest score', () => {
    const map = latestDoneBySubmission([
      ev('s1', 'done', '2026-07-16T20:00:00+00:00', 95),
      ev('s1', 'done', '2026-07-17T09:00:00+00:00', 60),
    ]);
    assert.equal(scoreOf(map.get('s1')), 60);
  });

  test('input order does not matter', () => {
    const map = latestDoneBySubmission([
      ev('s1', 'done', '2026-07-17T09:00:00+00:00', 60),
      ev('s1', 'done', '2026-07-16T20:00:00+00:00', 95),
    ]);
    assert.equal(scoreOf(map.get('s1')), 60);
  });
});

// Rule 1: a submission's score is its LATEST done evaluation.
describe('rankCandidates — rule 1: latest done evaluation wins', () => {
  test('a re-evaluated submission uses the newest verdict', () => {
    const ranked = rankCandidates(
      [sub('s1', 'alice')],
      [
        ev('s1', 'done', '2026-07-16T20:00:00+00:00', 95),
        ev('s1', 'done', '2026-07-17T09:00:00+00:00', 60),
      ],
    );
    assert.equal(ranked.length, 1, 'a re-evaluated candidate must not occupy two places');
    assert.equal(ranked[0].score, 60);
  });

  test('queued / running / errored rows are excluded, not scored zero', () => {
    const ranked = rankCandidates(
      [sub('s1', 'alice')],
      [
        ev('s1', 'error', '2026-07-17T09:00:00+00:00'),
        ev('s1', 'running', '2026-07-17T09:05:00+00:00'),
        ev('s1', 'queued', null),
      ],
    );
    assert.deepEqual(ranked, [], 'not-yet-scored is not a position on a leaderboard');
  });

  test('a later error does not erase an earlier done verdict', () => {
    const ranked = rankCandidates(
      [sub('s1', 'alice')],
      [
        ev('s1', 'done', '2026-07-16T08:00:00+00:00', 40),
        ev('s1', 'error', '2026-07-17T09:00:00+00:00'),
      ],
    );
    assert.equal(ranked[0].score, 40);
  });

  test('an unevaluated submission is omitted', () => {
    const ranked = rankCandidates(
      [sub('s1', 'alice'), sub('s2', 'alice')],
      [ev('s1', 'done', '2026-07-16T20:00:00+00:00', 88)],
    );
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].submissionId, 's1');
  });
});

// Rule 2: a candidate's score is their BEST submission.
describe('rankCandidates — rule 2: best submission per candidate', () => {
  test('two attempts collapse to one row at the higher score', () => {
    const ranked = rankCandidates(
      [sub('s1', 'alice'), sub('s2', 'alice')],
      [
        ev('s1', 'done', '2026-07-16T20:00:00+00:00', 70),
        ev('s2', 'done', '2026-07-16T21:00:00+00:00', 84),
      ],
    );
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].score, 84);
    assert.equal(ranked[0].submissionId, 's2');
  });

  test('the better attempt wins even when it was submitted first', () => {
    const ranked = rankCandidates(
      [sub('s1', 'alice'), sub('s2', 'alice')],
      [
        ev('s1', 'done', '2026-07-16T20:00:00+00:00', 91),
        ev('s2', 'done', '2026-07-16T21:00:00+00:00', 12),
      ],
    );
    assert.equal(ranked[0].score, 91);
    assert.equal(ranked[0].submissionId, 's1');
  });
});

describe('rankCandidates — ordering and payload', () => {
  test('sorts candidates by score, highest first', () => {
    const ranked = rankCandidates(
      [sub('s1', 'alice', 'alice@e'), sub('s2', 'ben', 'ben@e'), sub('s3', 'carol', 'carol@e')],
      [
        ev('s1', 'done', '2026-07-16T20:43:45+00:00', 88),
        ev('s2', 'done', '2026-07-16T20:43:46+00:00', 54),
        ev('s3', 'done', '2026-07-16T20:43:47+00:00', 91),
      ],
    );
    assert.deepEqual(
      ranked.map((r) => [r.candidateId, r.score]),
      [
        ['carol', 91],
        ['alice', 88],
        ['ben', 54],
      ],
    );
  });

  test('a legitimate score of 0 ranks rather than being dropped', () => {
    const ranked = rankCandidates(
      [sub('s1', 'alice')],
      [ev('s1', 'done', '2026-07-17T09:00:00+00:00', 0)],
    );
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].score, 0);
  });

  test('carries the candidate email through for the recruiter contact link', () => {
    const ranked = rankCandidates(
      [sub('s1', 'alice', 'alice@example.dev')],
      [ev('s1', 'done', '2026-07-17T09:00:00+00:00', 77)],
    );
    assert.equal(ranked[0].email, 'alice@example.dev');
  });

  test('evaluations belonging to other submissions are ignored', () => {
    const ranked = rankCandidates(
      [sub('s1', 'alice')],
      [ev('s-other', 'done', '2026-07-17T09:00:00+00:00', 100)],
    );
    assert.deepEqual(ranked, []);
  });

  test('empty input is an empty leaderboard', () => {
    assert.deepEqual(rankCandidates([], []), []);
  });
});

// ---------------------------------------------------------------------------
// Recruiter overview aggregates. Both rules below are ones a dashboard gets
// wrong by accident: counting evaluation rows instead of evaluated submissions,
// and letting one strong candidate occupy the whole "top candidates" list.
// ---------------------------------------------------------------------------

describe('countEvaluatedSubmissions', () => {
  test('counts submissions, not evaluation rows', () => {
    const subs = [{ id: 's1' }, { id: 's2' }];
    const evs = [
      ev('s1', 'done', '2026-07-16T20:00:00+00:00', 70),
      ev('s1', 'done', '2026-07-17T20:00:00+00:00', 80), // re-run, same submission
    ];
    assert.equal(countEvaluatedSubmissions(subs, evs), 1);
  });

  test('a submission with only failed or pending runs is not evaluated', () => {
    const subs = [{ id: 's1' }];
    assert.equal(
      countEvaluatedSubmissions(subs, [
        ev('s1', 'error', '2026-07-17T09:00:00+00:00'),
        ev('s1', 'running', '2026-07-17T09:05:00+00:00'),
        ev('s1', 'queued', null),
      ]),
      0,
    );
  });

  test('a later failure does not un-evaluate an earlier success', () => {
    const subs = [{ id: 's1' }];
    assert.equal(
      countEvaluatedSubmissions(subs, [
        ev('s1', 'done', '2026-07-16T08:00:00+00:00', 40),
        ev('s1', 'error', '2026-07-17T09:00:00+00:00'),
      ]),
      1,
    );
  });

  test('evaluations for submissions outside the set are ignored', () => {
    assert.equal(
      countEvaluatedSubmissions([{ id: 's1' }], [ev('s-other', 'done', '2026-07-17T09:00:00+00:00', 90)]),
      0,
    );
  });

  test('no submissions and no evaluations count as zero', () => {
    assert.equal(countEvaluatedSubmissions([], []), 0);
  });
});

describe('topCandidatesAcrossTasks', () => {
  const tasks = [
    { id: 't1', title: 'Webhook idempotency' },
    { id: 't2', title: 'Checkout race' },
  ];
  const taskSub = (id: string, candidateId: string, taskId: string, email: string | null = null) => ({
    ...sub(id, candidateId, email),
    task_id: taskId,
  });

  test('a candidate leading two tasks is listed once, at their best score', () => {
    const top = topCandidatesAcrossTasks(
      tasks,
      [taskSub('s1', 'alice', 't1', 'alice@e'), taskSub('s2', 'alice', 't2', 'alice@e')],
      [
        ev('s1', 'done', '2026-07-16T20:00:00+00:00', 71),
        ev('s2', 'done', '2026-07-16T21:00:00+00:00', 93),
      ],
    );
    assert.equal(top.length, 1, 'one person is one row');
    assert.equal(top[0].score, 93);
    assert.equal(top[0].taskTitle, 'Checkout race', 'reports the task the best score came from');
  });

  test('scores from different tasks are never pooled into one ranking', () => {
    // Two separate tasks, one candidate each. Both must appear.
    const top = topCandidatesAcrossTasks(
      tasks,
      [taskSub('s1', 'alice', 't1'), taskSub('s2', 'ben', 't2')],
      [
        ev('s1', 'done', '2026-07-16T20:00:00+00:00', 60),
        ev('s2', 'done', '2026-07-16T21:00:00+00:00', 90),
      ],
    );
    assert.deepEqual(
      top.map((c) => [c.candidateId, c.score, c.taskId]),
      [
        ['ben', 90, 't2'],
        ['alice', 60, 't1'],
      ],
    );
  });

  test('uses the latest done evaluation, like the per-task leaderboard', () => {
    const top = topCandidatesAcrossTasks(
      [tasks[0]],
      [taskSub('s1', 'alice', 't1')],
      [
        ev('s1', 'done', '2026-07-16T20:00:00+00:00', 99),
        ev('s1', 'done', '2026-07-17T20:00:00+00:00', 55),
      ],
    );
    assert.equal(top[0].score, 55);
  });

  test('unscored candidates are omitted', () => {
    const top = topCandidatesAcrossTasks(
      tasks,
      [taskSub('s1', 'alice', 't1'), taskSub('s2', 'ben', 't2')],
      [ev('s1', 'done', '2026-07-16T20:00:00+00:00', 60), ev('s2', 'error', '2026-07-16T21:00:00+00:00')],
    );
    assert.deepEqual(top.map((c) => c.candidateId), ['alice']);
  });

  test('respects the limit', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'];
    const top = topCandidatesAcrossTasks(
      [tasks[0]],
      many.map((c, i) => taskSub(`s${i}`, c, 't1')),
      many.map((_, i) => ev(`s${i}`, 'done', '2026-07-16T20:00:00+00:00', 50 + i)),
      3,
    );
    assert.equal(top.length, 3);
    assert.deepEqual(top.map((c) => c.score), [55, 54, 53]);
  });

  test('a task with no submissions contributes nothing', () => {
    const top = topCandidatesAcrossTasks(tasks, [taskSub('s1', 'alice', 't1')], [
      ev('s1', 'done', '2026-07-16T20:00:00+00:00', 60),
    ]);
    assert.equal(top.length, 1);
  });

  test('empty org is an empty list, not a crash', () => {
    assert.deepEqual(topCandidatesAcrossTasks([], [], []), []);
  });
});
