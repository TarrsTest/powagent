import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  upcomingDeadlines,
  checkSubmissionAllowed,
  hasReachedSubmissionCap,
  isPastDeadline,
} from '../lib/submissionRules.ts';

const NOW = new Date('2026-07-30T12:00:00.000Z');
const NO_LIMITS = { deadline_at: null, max_submissions_per_candidate: null };

describe('isPastDeadline', () => {
  test('no deadline is never past', () => {
    assert.equal(isPastDeadline(null, NOW), false);
    assert.equal(isPastDeadline(undefined, NOW), false);
  });

  test('a future deadline is not past', () => {
    assert.equal(isPastDeadline('2026-07-30T12:00:01.000Z', NOW), false);
    assert.equal(isPastDeadline('2026-12-01T00:00:00.000Z', NOW), false);
  });

  test('a past deadline is past', () => {
    assert.equal(isPastDeadline('2026-07-30T11:59:59.000Z', NOW), true);
    assert.equal(isPastDeadline('2026-01-01T00:00:00.000Z', NOW), true);
  });

  test('the exact deadline instant still allows submitting', () => {
    assert.equal(isPastDeadline('2026-07-30T12:00:00.000Z', NOW), false);
  });

  test('handles the +00:00 offset form Postgres/PostgREST returns', () => {
    assert.equal(isPastDeadline('2026-07-30T11:00:00+00:00', NOW), true);
    assert.equal(isPastDeadline('2026-07-30T13:00:00+00:00', NOW), false);
  });

  test('an unparseable deadline is treated as absent, not as closed', () => {
    assert.equal(isPastDeadline('not a timestamp', NOW), false);
    assert.equal(isPastDeadline('', NOW), false);
  });
});

describe('hasReachedSubmissionCap', () => {
  test('null cap means unlimited', () => {
    assert.equal(hasReachedSubmissionCap(null, 0), false);
    assert.equal(hasReachedSubmissionCap(null, 999), false);
    assert.equal(hasReachedSubmissionCap(undefined, 999), false);
  });

  test('under the cap is allowed', () => {
    assert.equal(hasReachedSubmissionCap(3, 0), false);
    assert.equal(hasReachedSubmissionCap(3, 2), false);
  });

  test('at or over the cap is not', () => {
    assert.equal(hasReachedSubmissionCap(3, 3), true);
    assert.equal(hasReachedSubmissionCap(3, 4), true);
    assert.equal(hasReachedSubmissionCap(1, 1), true);
  });

  test('a cap of zero closes the task', () => {
    assert.equal(hasReachedSubmissionCap(0, 0), true);
  });
});

describe('checkSubmissionAllowed', () => {
  /** A candidate who has accepted the task — the ordinary case for the other rules. */
  const accepted = (existingCount: number) => ({ existingCount, hasAccepted: true });

  test('allows a submission when there are no limits', () => {
    assert.equal(checkSubmissionAllowed(NO_LIMITS, accepted(0), NOW), null);
    assert.equal(checkSubmissionAllowed(NO_LIMITS, accepted(50), NOW), null);
  });

  test('blocks a past-deadline submission', () => {
    const denial = checkSubmissionAllowed(
      { deadline_at: '2026-07-29T00:00:00.000Z', max_submissions_per_candidate: null },
      accepted(0),
      NOW,
    );
    assert.ok(denial, 'expected a denial');
    assert.equal(denial.code, 'deadline_passed');
    assert.equal(denial.status, 409);
    assert.match(denial.message, /deadline/i);
  });

  test('allows a submission before the deadline', () => {
    assert.equal(
      checkSubmissionAllowed(
        { deadline_at: '2026-08-30T00:00:00.000Z', max_submissions_per_candidate: 3 },
        accepted(1),
        NOW,
      ),
      null,
    );
  });

  test('blocks a submission at the cap', () => {
    const denial = checkSubmissionAllowed(
      { deadline_at: null, max_submissions_per_candidate: 2 },
      accepted(2),
      NOW,
    );
    assert.ok(denial, 'expected a denial');
    assert.equal(denial.code, 'submission_limit_reached');
    assert.equal(denial.status, 409);
    assert.match(denial.message, /2 submissions/);
  });

  test('the cap message reads correctly for a single allowed submission', () => {
    const denial = checkSubmissionAllowed(
      { deadline_at: null, max_submissions_per_candidate: 1 },
      accepted(1),
      NOW,
    );
    assert.ok(denial);
    assert.match(denial.message, /one submission/);
    assert.doesNotMatch(denial.message, /1 submissions/);
  });

  test('deadline is reported first when both limits are hit', () => {
    const denial = checkSubmissionAllowed(
      { deadline_at: '2026-01-01T00:00:00.000Z', max_submissions_per_candidate: 1 },
      accepted(5),
      NOW,
    );
    assert.ok(denial);
    assert.equal(denial.code, 'deadline_passed');
  });

  // The bug this module exists to prevent: the UI used to skip both checks, so a
  // browser could submit past the deadline and past the cap. Both entry points
  // now call this function, so one set of inputs has one answer.
  test('the same inputs give the same answer regardless of caller', () => {
    const limits = { deadline_at: '2026-07-29T00:00:00.000Z', max_submissions_per_candidate: 3 };
    const fromUi = checkSubmissionAllowed(limits, accepted(0), NOW);
    const fromApi = checkSubmissionAllowed(limits, accepted(0), NOW);
    assert.deepEqual(fromUi, fromApi);
    assert.equal(fromUi?.code, 'deadline_passed');
  });

  // Acceptance as a prerequisite. Submitting without accepting used to be
  // allowed on both paths, which left the employer blind to who was working on a
  // task and put submissions outside the accepted -> submitted funnel entirely.
  describe('acceptance is required', () => {
    test('blocks a candidate who has not accepted the task', () => {
      const denial = checkSubmissionAllowed(NO_LIMITS, { existingCount: 0, hasAccepted: false }, NOW);
      assert.ok(denial, 'expected a denial');
      assert.equal(denial.code, 'task_not_accepted');
      assert.equal(denial.status, 409);
      assert.match(denial.message, /accept/i);
    });

    test('allows the same candidate once they have accepted', () => {
      assert.equal(
        checkSubmissionAllowed(NO_LIMITS, { existingCount: 0, hasAccepted: true }, NOW),
        null,
      );
    });

    test('an unlimited task still requires acceptance', () => {
      // No deadline and no cap must not read as "no rules at all".
      const denial = checkSubmissionAllowed(NO_LIMITS, { existingCount: 3, hasAccepted: false }, NOW);
      assert.equal(denial?.code, 'task_not_accepted');
    });

    test('a closed task reports the deadline, not the missing acceptance', () => {
      // Accepting cannot reopen a closed task, so sending them to the Accept
      // button would be a dead end.
      const denial = checkSubmissionAllowed(
        { deadline_at: '2026-01-01T00:00:00.000Z', max_submissions_per_candidate: null },
        { existingCount: 0, hasAccepted: false },
        NOW,
      );
      assert.equal(denial?.code, 'deadline_passed');
    });

    test('acceptance is reported before the cap', () => {
      // "You have used all your attempts" makes no sense to someone who never
      // entered the task.
      const denial = checkSubmissionAllowed(
        { deadline_at: null, max_submissions_per_candidate: 1 },
        { existingCount: 5, hasAccepted: false },
        NOW,
      );
      assert.equal(denial?.code, 'task_not_accepted');
    });
  });
});

// The recruiter overview's "Closing soon" widget. Getting this wrong shows a
// recruiter a deadline that has already passed, or hides the one about to.
describe('upcomingDeadlines', () => {
  const t = (id: string, deadline_at: string | null) => ({ id, deadline_at });

  test('keeps only future deadlines, soonest first', () => {
    const out = upcomingDeadlines(
      [
        t('far', '2026-08-30T12:00:00.000Z'),
        t('past', '2026-07-01T12:00:00.000Z'),
        t('soon', '2026-07-30T18:00:00.000Z'),
      ],
      NOW,
    );
    assert.deepEqual(out.map((d) => d.task.id), ['soon', 'far']);
  });

  test('tasks without a deadline are omitted — nothing is due', () => {
    assert.deepEqual(upcomingDeadlines([t('none', null)], NOW), []);
  });

  test('an unparseable deadline is skipped rather than sorted to the front', () => {
    const out = upcomingDeadlines([t('bad', 'whenever'), t('ok', '2026-08-01T00:00:00.000Z')], NOW);
    assert.deepEqual(out.map((d) => d.task.id), ['ok']);
  });

  test('the exact deadline instant still counts as upcoming', () => {
    const out = upcomingDeadlines([t('now', '2026-07-30T12:00:00.000Z')], NOW);
    assert.equal(out.length, 1);
    assert.equal(out[0].msRemaining, 0);
  });

  test('reports time remaining, not elapsed', () => {
    const out = upcomingDeadlines([t('x', '2026-07-30T14:00:00.000Z')], NOW);
    assert.equal(out[0].msRemaining, 2 * 3600_000);
  });

  test('sorts by instant, so mixed offset formats cannot misorder', () => {
    const out = upcomingDeadlines(
      [t('utc', '2026-07-30T20:00:00.000Z'), t('offset', '2026-07-30T14:00:00+00:00')],
      NOW,
    );
    assert.deepEqual(out.map((d) => d.task.id), ['offset', 'utc']);
  });

  test('respects the limit', () => {
    const out = upcomingDeadlines(
      ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'].map((d, i) => t(`t${i}`, `${d}T00:00:00.000Z`)),
      NOW,
      2,
    );
    assert.deepEqual(out.map((d) => d.task.id), ['t0', 't1']);
  });

  test('no tasks is an empty list', () => {
    assert.deepEqual(upcomingDeadlines([], NOW), []);
  });
});
