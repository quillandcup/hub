/**
 * Where the time goes while a conversation page renders, for tuning: one log line per render with
 * each query's own duration (`time`, for queries that run side by side) and each sequential stage
 * (`mark`, the time since the previous mark). Read it with `vercel logs --query "[chat] page"`.
 * Logs timings and the conversation's label only: no ids, names or message text.
 */
export interface StageTimer {
  /** Time one promise: its duration, however long the others run alongside. */
  time<T>(name: string, promise: PromiseLike<T>): Promise<T>;
  /** End a sequential stage: the time since the previous mark (or the start). */
  mark(name: string): void;
  /** Record a size next to the timings (rows, threads...), so a slow query can be read against how much it handled. */
  note(name: string, value: number): void;
  /** Log the line. */
  log(label: string): void;
}

export function createStageTimer(now: () => number = () => performance.now()): StageTimer {
  const start = now();
  let last = start;
  const parts: string[] = [];
  return {
    async time(name, promise) {
      const began = now();
      try {
        return await promise;
      } finally {
        parts.push(`${name} ${Math.round(now() - began)}`);
      }
    },
    mark(name) {
      const at = now();
      parts.push(`${name} ${Math.round(at - last)}`);
      last = at;
    },
    note(name, value) {
      parts.push(`${name}=${value}`);
    },
    log(label) {
      console.info("[chat] page %s %dms (%s)", label, Math.round(now() - start), parts.join(", "));
    },
  };
}
