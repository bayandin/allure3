export const forEachConcurrently = async <T>(
  items: readonly T[],
  concurrency: number,
  visit: (item: T) => Promise<void>,
) => {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];

      await visit(item);
    }
  };
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(Array.from({ length: workerCount }, worker));
};
