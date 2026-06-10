export type Settled<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error };

export async function mapPool<I, O>(
  items: readonly I[],
  concurrency: number,
  worker: (item: I, index: number) => Promise<O>,
): Promise<Settled<O>[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  const results = new Array<Settled<O>>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { ok: true, value: await worker(items[index]!, index) };
      } catch (cause) {
        results[index] = {
          ok: false,
          error: cause instanceof Error ? cause : new Error(String(cause)),
        };
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => run()));
  return results;
}

export function values<T>(settled: readonly Settled<T>[]): T[] {
  return settled.filter((s): s is { ok: true; value: T } => s.ok).map((s) => s.value);
}
