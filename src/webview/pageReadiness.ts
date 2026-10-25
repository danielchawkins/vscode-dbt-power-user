/** A page's readiness state: whether its webview has reported ready, and the callers waiting for that. */
interface PageState {
  ready: boolean;
  waiting: Set<(ready: boolean) => void>;
}

/**
 * Which pages have reported ready, keyed by the page. Waiting is event-driven: `markReady` settles every waiter at
 * once, a deadline settles one waiter with false, and `dispose` settles a page's waiters with false. No timers run
 * unless a deadline is given. Pure: it knows nothing of VS Code.
 */
export class PageReadiness<K> {
  private readonly pages = new Map<K, PageState>();

  private page(key: K): PageState {
    let state = this.pages.get(key);
    if (!state) {
      state = { ready: false, waiting: new Set() };
      this.pages.set(key, state);
    }
    return state;
  }

  /** Whether the page has reported ready since it was last reset. */
  isReady(key: K): boolean {
    return this.pages.get(key)?.ready ?? false;
  }

  /** The page is not ready until it reports again; anyone already waiting keeps waiting. */
  reset(key: K): void {
    this.page(key).ready = false;
  }

  /** The page reported ready: resolves every waiter with true. */
  markReady(key: K): void {
    const state = this.page(key);
    state.ready = true;
    for (const settle of state.waiting) {
      settle(true);
    }
  }

  /** Resolves true once the page is ready, or false when `deadlineMs` passes first or the page is disposed. */
  whenReady(key: K, deadlineMs?: number): Promise<boolean> {
    const state = this.page(key);
    if (state.ready) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (ready: boolean) => {
        clearTimeout(timer);
        state.waiting.delete(settle);
        resolve(ready);
      };
      state.waiting.add(settle);
      if (deadlineMs !== undefined) {
        timer = setTimeout(settle, deadlineMs, false);
      }
    });
  }

  /** Forgets a page that has gone away; its waiters resolve false. */
  dispose(key: K): void {
    const state = this.pages.get(key);
    this.pages.delete(key);
    for (const settle of state?.waiting ?? []) {
      settle(false);
    }
  }
}
