/** Pending results drain once; delivery owners explicitly re-defer retries. */
export function createDeferredResultDelivery<T>(key: (result: T) => string) {
  const pending = new Map<string, T>();

  return {
    defer(result: T) {
      pending.set(key(result), result);
    },
    consume(keys: Iterable<string>) {
      for (const key of keys) pending.delete(key);
    },
    drain() {
      const results = [...pending.values()];
      pending.clear();
      return results;
    },
    clear() {
      pending.clear();
    },
  };
}
