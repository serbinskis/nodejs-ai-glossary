import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as crypto from 'crypto';
import { findByHeader } from '../supported.js';
import config from '../config.js';

export class FileProcessor {
    private static CACHE_TTL_MS = 24 * 60 * 60 * 1000;
    private static cache = new Map<string, string>();
    protected progress: number = 0;
    protected cacheKey?: string = null as unknown as string;
    protected filePath?: string;
    protected buffer?: Buffer;
    protected callback: (progress: number) => void = () => {};

    static { setInterval(() => this.cache.clear(), FileProcessor.CACHE_TTL_MS); }

    constructor(source: string | Buffer) {
        if (typeof source === 'string') {
            if (!fs.existsSync(source)) { throw new Error(`The file '${source}' does not exist.`); }
            this.filePath = source;
        }
        else if (source instanceof Buffer) {
            this.buffer = source;
        }
        else {
            throw new Error("Invalid source type. Constructor accepts a string (filePath) or a Buffer.");
        }
    }

    setCallback(callback: (progress: number) => void): void {
        this.callback = callback;
    }

    async setProgress(progress: number): Promise<void> {
        this.progress = Math.min(Math.max(progress, 0), 100);
        if (this.callback) { await this.callback(this.progress); }
    }

    getProgress(): number {
        return this.progress;
    }

    protected async extractImplementation(): Promise<string | null> {
        if (this.buffer) { return this.buffer.toString('utf-8'); }

        if (this.filePath) { return await fsp.readFile(this.filePath, 'utf-8'); }

        return null;
    }

    public setHash(cacheKey: string): string {
        return this.cacheKey = cacheKey;
    }

    private async getHash(): Promise<string> {
        if (this.cacheKey) { return this.cacheKey; }
        if (this.buffer) { this.cacheKey = crypto.createHash('sha1').update(this.buffer).digest('hex'); }

        if (this.filePath) {
            const stats = await fsp.stat(this.filePath);
            const fileMeta = `${this.filePath}-${stats.size}-${stats.mtimeMs}`;
            this.cacheKey = crypto.createHash('sha1').update(fileMeta).digest('hex');
        }

        return this.cacheKey as string;
    }

    private async checkCache(): Promise<{ key: string; cache: string | null }> {
        const key = await this.getHash();
        const cache = FileProcessor.cache.get(key) || null;
        return { key, cache };
    }

    async extractText(): Promise<string | null> {
        await this.setProgress(0);
        const { key, cache } = await this.checkCache();
        if (cache) { await this.setProgress(100); return cache; }

        try {
            const content = await this.extractImplementation();
            if (content) { FileProcessor.cache.set(key, content); }
            await this.setProgress(100);
            return content;
        } catch (error: Error | any) {
            if (config.DEBUG) { console.error(error); }
            var source = this.filePath ? this.filePath : findByHeader(this.buffer?.slice(1024) ?? Buffer.alloc(1024))?.ext ?? "unkown";
            console.error(`[FileProcessor] Failed to process file: ${source}. Error: ${error?.message}, Stack: ${error?.stack}`);
            await this.setProgress(100);
            return null;
        }
    }
}