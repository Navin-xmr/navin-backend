/**
 * Runs async tasks one-at-a-time per key, in call order (TODO J4).
 *
 * Used to serialize Stellar submissions per source account: a transaction's
 * sequence number is `account.sequence + 1`, so two in-flight builds against the
 * same account race and one fails with `tx_bad_seq`. A failed task never blocks
 * the tasks queued behind it.
 */
export class KeyedSerializer {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(task);
    const tail = result.then(
      () => undefined,
      () => undefined
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  /** Number of keys with queued or running work (for tests/metrics). */
  get activeKeys(): number {
    return this.tails.size;
  }
}
