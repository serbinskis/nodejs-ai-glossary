import config from "./config.js";

export class Utils {
    public static async wait(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    public static mostCommonBy<T, K>(items: T[], selector: (item: T) => K): K | undefined | null {
        if (items.length === 0) { return null; }
        let mostCommon: any[] = [null, 0];
        const counts = new Map<K, number>();

        for (const item of items) {
            const key = selector(item);
            const currentCount = counts.get(key) ?? 0;
            counts.set(key, currentCount + 1);
        }

        for (const [key, count] of counts) {
            if (count > mostCommon[1]) {
                mostCommon = [key, count]
            }
        }

        return mostCommon[0];
    }

    public static async fromGenerator<T>(generator: AsyncGenerator<T> | AsyncIterable<T>): Promise<T[]> {
        const result: T[] = [];
        for await (const item of generator) { result.push(item); }
        return result;
    }

    public static extractJSON(text: string, brackets: '[]' | '{}' = '[]'): JSON | null {
        try {
            const regex = (brackets === '[]') ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/;
            return JSON.parse(text.match(regex)?.[0] as string);
        } catch (e) {
            if (config.DEBUG) { console.error("[Utils.extractJSON] -> Failed to extract JSON:", e); }
            return null;
        }
    }

    public static between(num: number, a: number, b: number): boolean {
        let min = Math.min(a, b), max = Math.max(a, b);
        return (num != null) && ((num >= min) && (num <= max));
    };

    public static clamp(num: number, min: number, max: number): number {
        return Math.min(Math.max(num, min), max);
    }
}