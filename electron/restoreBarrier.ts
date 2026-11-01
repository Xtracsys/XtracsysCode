/** The data-root swap must never overlap accepted work, including detached promises.
 * Admission is synchronous; restore rejects busy rather than cancelling or dropping work.
 * No drain timeout is needed: a busy restore does not start or wait at all.
 */
export class RestoreRecoveryError extends Error {}

export class RestoreBarrier {
  private closed = false;
  private active = new Map<symbol, string>();
  private unconfirmed: string | null = null;

  get blocked(): boolean { return this.closed; }

  /** Keep restore inadmissible when process shutdown cannot prove quiescence.
   * Normal accepted work can still finish; only restart/recovery clears this latch.
   */
  preventRestore(reason: string): void {
    this.unconfirmed ??= reason;
  }

  assertOpen(): void {
    if (this.closed) throw new Error("Data restore is in progress or awaiting restart/recovery. Wait for the app to restart before making changes.");
  }

  async run<T>(label: string, operation: () => T | PromiseLike<T>): Promise<T> {
    this.assertOpen();
    const token = Symbol(label);
    this.active.set(token, label);
    try { return await operation(); }
    finally { this.active.delete(token); }
  }

  async restore<T>(operation: () => Promise<T>): Promise<T> {
    this.assertOpen();
    if (this.unconfirmed) throw new Error(`Restore busy: ${this.unconfirmed}.`);
    if (this.active.size) {
      const labels = [...new Set(this.active.values())].slice(0, 8).join(", ");
      throw new Error(`Restore busy: wait for accepted work to fully drain (${labels}), then retry. Running/queued turns must finish or be cancelled and finish cleanup first.`);
    }
    this.closed = true; // before the first await; concurrent imports cannot enter
    try {
      const result = await operation();
      // Success intentionally stays closed through relaunch/exit.
      return result;
    } catch (error) {
      // Unconfirmed rollback must never resume stale in-memory writers.
      if (!(error instanceof RestoreRecoveryError)) this.closed = false;
      throw error;
    }
  }
}
