/** Holds commands until extension startup finishes, stops early, fails, or the extension is disposed. */
export class StartupGate {
  private markSettled: () => void = () => {};
  private readonly settled = new Promise<void>(
    (resolve) => (this.markSettled = resolve),
  );

  /** Releases every waiter; later calls do nothing. */
  settle(): void {
    this.markSettled();
  }

  /** Resolves once `settle` has been called; never rejects. */
  whenSettled(): Promise<void> {
    return this.settled;
  }
}
