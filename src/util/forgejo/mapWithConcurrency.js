// mapWithConcurrency.js - Run async fn over items with limited concurrency
export async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < items.length) {
            const current = nextIndex++;
            results[current] = await fn(items[current], current);
        }
    }

    const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
    await Promise.all(workers);

    return results;
}