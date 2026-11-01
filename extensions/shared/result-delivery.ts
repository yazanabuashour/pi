/** Pending results drain once; delivery owners explicitly re-defer retries. */
export function createDeferredResultDelivery<T>(key: (result: T) => string) {
  const pending = new Map<string, T>();
  let holds = new Map<string, number>();

  return {
    defer(result: T) {
      pending.set(key(result), result);
    },
    consume(this: void, keys: Iterable<string>) {
      for (const key of keys) pending.delete(key);
    },
    hold(keys: Iterable<string>, onRelease?: () => void) {
      const held = holds;
      const ids = [...new Set(keys)];
      let released = false;

      for (const id of ids) held.set(id, (held.get(id) ?? 0) + 1);

      return () => {
        if (released) return;
        released = true;

        for (const id of ids) {
          const count = (held.get(id) ?? 1) - 1;

          if (count === 0) held.delete(id);
          else held.set(id, count);
        }

        onRelease?.();
      };
    },
    drain() {
      const results: T[] = [];

      for (const [id, result] of pending) {
        if (holds.has(id)) continue;
        results.push(result);
        pending.delete(id);
      }

      return results;
    },
    clear() {
      pending.clear();
      holds = new Map();
    },
  };
}
