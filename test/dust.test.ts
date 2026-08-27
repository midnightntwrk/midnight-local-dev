import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isDustBalancingError, withDustRetry } from '../src/dust.js';

const dustError = () => new Error('Insufficient Funds: could not balance dust');

/** Virtual clock so the tests never actually wait. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe('isDustBalancingError', () => {
  it('matches the balancer error for dust', () => {
    assert.equal(isDustBalancingError(dustError()), true);
  });

  it('does not match insufficient funds for other token types', () => {
    assert.equal(isDustBalancingError(new Error('Insufficient Funds: could not balance night')), false);
  });

  it('does not match non-errors', () => {
    assert.equal(isDustBalancingError('could not balance dust'), false);
    assert.equal(isDustBalancingError(undefined), false);
  });
});

describe('withDustRetry', () => {
  it('returns the value without retrying when the first attempt succeeds', async () => {
    let calls = 0;
    const clock = fakeClock();
    const result = await withDustRetry(async () => {
      calls++;
      return 'tx-id';
    }, clock);
    assert.equal(result, 'tx-id');
    assert.equal(calls, 1);
  });

  it('retries past the not-yet-spendable window and returns the eventual value', async () => {
    let calls = 0;
    const clock = fakeClock();
    const retries: number[] = [];
    const result = await withDustRetry(
      async () => {
        calls++;
        if (calls < 4) throw dustError();
        return 'tx-id';
      },
      { ...clock, onRetry: (n) => retries.push(n) },
    );
    assert.equal(result, 'tx-id');
    assert.equal(calls, 4);
    assert.deepEqual(retries, [1, 2, 3]);
  });

  it('propagates any other error immediately, without retrying', async () => {
    let calls = 0;
    const clock = fakeClock();
    await assert.rejects(
      withDustRetry(async () => {
        calls++;
        throw new Error('proof server unreachable');
      }, clock),
      /proof server unreachable/,
    );
    // A real failure must surface at once rather than being masked for minutes.
    assert.equal(calls, 1);
  });

  it('gives up at the deadline and reports the attempt count', async () => {
    let calls = 0;
    const clock = fakeClock();
    await assert.rejects(
      withDustRetry(
        async () => {
          calls++;
          throw dustError();
        },
        { ...clock, timeoutMs: 20_000, intervalMs: 5_000 },
      ),
      /still not spendable after 20000ms \(5 attempts\)/,
    );
    assert.equal(calls, 5);
  });
});
