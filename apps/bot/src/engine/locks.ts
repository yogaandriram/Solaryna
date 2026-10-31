/** Serializes async work per key (one token = one queue), so a position is never sold twice. */
export interface KeyedMutex {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
}

export function createKeyedMutex(): KeyedMutex {
  const tails = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      const result = previous.then(task);
      const tail = result.catch(() => undefined);
      tails.set(key, tail);
      void tail.then(() => {
        if (tails.get(key) === tail) {
          tails.delete(key);
        }
      });
      return result;
    },
  };
}
