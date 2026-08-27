/**
 * Handling for the window in which a freshly started chain cannot yet pay fees.
 *
 * Deliberately free of SDK imports so it can be unit-tested without standing up
 * a wallet or a network.
 */

/** How long to keep retrying a transfer that cannot yet be paid for in DUST. */
export const DUST_READY_TIMEOUT_MS = 180_000;
/** Gap between attempts; roughly one block on a local devnet. */
export const DUST_RETRY_INTERVAL_MS = 5_000;

/**
 * True for the balancer's "no DUST coin can cover the fee" error.
 *
 * Raised as `InsufficientFundsError` by @midnight-ntwrk/wallet-sdk-capabilities
 * when coin selection cannot cover the fee imbalance. Matched on the message
 * because that class is not exported from the package's public entry point.
 */
export function isDustBalancingError(e: unknown): boolean {
  return e instanceof Error && /could not balance dust/i.test(e.message);
}

export interface DustRetryOptions {
  timeoutMs?: number;
  intervalMs?: number;
  /** Injectable for tests, so they need not spend real time. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onRetry?: (attempt: number, intervalMs: number) => void;
}

/**
 * Run `attempt`, retrying only while it fails because DUST is not yet spendable.
 *
 * On a freshly started network the genesis wallet reports a full DUST balance
 * and several spendable coins within a second of the first block, yet the
 * balancer cannot cover a transaction fee until the chain has advanced a little
 * further. Nothing observable separates the two states: `dust.balance(now)`
 * reports the same value before and after, `availableCoins.length` is unchanged,
 * and every coin's `generatedNow` reads 0 even once transfers succeed. With no
 * readiness flag to wait on, the attempt itself is the readiness check.
 *
 * Any other error propagates immediately — this must not mask real failures.
 */
export async function withDustRetry<T>(attempt: () => Promise<T>, options: DustRetryOptions = {}): Promise<T> {
  const {
    timeoutMs = DUST_READY_TIMEOUT_MS,
    intervalMs = DUST_RETRY_INTERVAL_MS,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
    onRetry,
  } = options;

  const deadline = now() + timeoutMs;
  for (let attemptNumber = 1; ; attemptNumber++) {
    try {
      return await attempt();
    } catch (e) {
      if (!isDustBalancingError(e)) throw e;
      if (now() >= deadline) {
        throw new Error(
          `DUST was still not spendable after ${timeoutMs}ms (${attemptNumber} attempts). ` +
            `Last error: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      onRetry?.(attemptNumber, intervalMs);
      await sleep(intervalMs);
    }
  }
}
