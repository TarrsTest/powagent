import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit } from '../lib/ratelimit.ts';

/**
 * Window boundaries are the whole point of these tests (PRD §9.4), so the clock
 * is mocked rather than slept on — a real 10-minute window is not testable and a
 * shortened one only proves the shortened case.
 *
 * `buckets` is module-level state that outlives each test, so every test takes a
 * fresh key. Exporting a reset would add production surface for test
 * convenience; a unique key costs nothing.
 */
let counter = 0;
const freshKey = () => `k${counter++}`;

describe('rateLimit', () => {
  beforeEach(() => mock.timers.enable({ apis: ['Date'], now: 0 }));
  afterEach(() => mock.timers.reset());

  test('allows exactly `limit` calls inside one window', () => {
    const k = freshKey();
    assert.equal(rateLimit(k, 3, 1000), true);
    assert.equal(rateLimit(k, 3, 1000), true);
    assert.equal(rateLimit(k, 3, 1000), true);
    assert.equal(rateLimit(k, 3, 1000), false);
    // Still denied on every further attempt, not just the first one over.
    assert.equal(rateLimit(k, 3, 1000), false);
  });

  test('keys are independent buckets', () => {
    const a = freshKey();
    const b = freshKey();
    assert.equal(rateLimit(a, 1, 1000), true);
    assert.equal(rateLimit(a, 1, 1000), false);
    // Exhausting one caller must not throttle another — the API keys the bucket
    // by owner id, so a shared bucket would let one org lock out everyone else.
    assert.equal(rateLimit(b, 1, 1000), true);
  });

  test('still denied one millisecond before the window ends', () => {
    const k = freshKey();
    rateLimit(k, 1, 1000); // opens the window at t=0, resetAt=1000
    mock.timers.tick(999);
    assert.equal(rateLimit(k, 1, 1000), false);
  });

  test('resets exactly at resetAt, not one tick later', () => {
    const k = freshKey();
    rateLimit(k, 1, 1000);
    mock.timers.tick(1000);
    // The reset test is `now >= w.resetAt`, so the boundary instant belongs to
    // the NEW window. Off-by-one here would hold a caller for an extra window.
    assert.equal(rateLimit(k, 1, 1000), true);
  });

  test('a new window is anchored at the first call after expiry, not a fixed grid', () => {
    const k = freshKey();
    rateLimit(k, 1, 1000); // window [0, 1000)
    mock.timers.tick(5000); // long past expiry
    assert.equal(rateLimit(k, 1, 1000), true); // opens [5000, 6000)
    mock.timers.tick(999);
    assert.equal(rateLimit(k, 1, 1000), false); // t=5999, still inside
    mock.timers.tick(1);
    assert.equal(rateLimit(k, 1, 1000), true); // t=6000
  });

  test('fixed window, not sliding: 2x limit can pass across the boundary', () => {
    const k = freshKey();
    rateLimit(k, 2, 1000); // t=0, count 1
    mock.timers.tick(999);
    assert.equal(rateLimit(k, 2, 1000), true); // t=999, count 2 — window full
    assert.equal(rateLimit(k, 2, 1000), false);
    mock.timers.tick(1); // t=1000, fresh window
    assert.equal(rateLimit(k, 2, 1000), true);
    assert.equal(rateLimit(k, 2, 1000), true);
    // 4 calls landed inside 2ms. This is the documented cost of a fixed window
    // and is why §9.4 calls the limiter best-effort; asserting it here means a
    // future swap to a sliding window has to change a test on purpose.
  });

  test('a limit of 0 still lets the first call through', () => {
    const k = freshKey();
    // The "no bucket yet" branch returns before the limit is ever compared, so
    // 0 does not mean "block everything". Nothing passes 0 today; this pins the
    // behaviour so a future caller reaching for it finds out here.
    assert.equal(rateLimit(k, 0, 1000), true);
    assert.equal(rateLimit(k, 0, 1000), false);
  });
});
