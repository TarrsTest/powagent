import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
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
  test('allows a submission when there are no limits', () => {
    assert.equal(checkSubmissionAllowed(NO_LIMITS, 0, NOW), null);
    assert.equal(checkSubmissionAllowed(NO_LIMITS, 50, NOW), null);
  });

  test('blocks a past-deadline submission', () => {
    const denial = checkSubmissionAllowed(
      { deadline_at: '2026-07-29T00:00:00.000Z', max_submissions_per_candidate: null },
      0,
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
        1,
        NOW,
      ),
      null,
    );
  });

  test('blocks a submission at the cap', () => {
    const denial = checkSubmissionAllowed(
      { deadline_at: null, max_submissions_per_candidate: 2 },
      2,
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
      1,
      NOW,
    );
    assert.ok(denial);
    assert.match(denial.message, /one submission/);
    assert.doesNotMatch(denial.message, /1 submissions/);
  });

  test('deadline is reported first when both limits are hit', () => {
    const denial = checkSubmissionAllowed(
      { deadline_at: '2026-01-01T00:00:00.000Z', max_submissions_per_candidate: 1 },
      5,
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
    const fromUi = checkSubmissionAllowed(limits, 0, NOW);
    const fromApi = checkSubmissionAllowed(limits, 0, NOW);
    assert.deepEqual(fromUi, fromApi);
    assert.equal(fromUi?.code, 'deadline_passed');
  });
});
