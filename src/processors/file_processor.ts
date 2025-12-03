import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as crypto from 'crypto';
import { findByHeader } from '../supported.js';
import config from '../config.js';

/**
 * Base class for processing files from a path or an in-memory buffer.
 * By default, it treats the content as plain text.
 */
export class FileProcessor {
    private static CACHE_TTL_MS = 24 * 60 * 60 * 1000; // Time-To-Live for cache entries, in milliseconds.
    private static cache = new Map<string, string>();
    protected progress: number = 0;
    protected cacheKey?: string = null;
    protected filePath?: string;
    protected buffer?: Buffer;
    protected callback: (progress: number) => void;

    // Clear cache entries periodically based on TTL.
    static { setInterval(() => this.cache.clear(), FileProcessor.CACHE_TTL_MS); }

    /**
     * Initializes the processor from either a file path (string) or a Buffer.
     * @param source - The source of the file content.
     */
    constructor(source: string | Buffer) {
        if (typeof source === 'string') { // Use a type guard to check if the source is a string (file path)
            if (!fs.existsSync(source)) { throw new Error(`The file '${source}' does not exist.`); }
            this.filePath = source;
        } 
        else if (source instanceof Buffer) { // Check if the source is a Buffer instance
            this.buffer = source;
        } 
        else { // This case should be rare due to TypeScript's type checking
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

    /**
     * Default text extraction method for plain text files.
     * It reads the file asynchronously from the path if necessary, or uses the buffer.
     * @returns A Promise that resolves to the file's text content or null if an error occurs.
     */
    protected async extractImplementation(): Promise<string | null> {
        // If a buffer was provided, decode it as UTF-8.
        if (this.buffer) { return this.buffer.toString('utf-8'); }

        // If a file path was provided, read the file from disk asynchronously.
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

        return this.cacheKey;
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
        } catch (error) {
            if (config.DEBUG) { console.error(error); }
            var source = this.filePath ? this.filePath : findByHeader(this.buffer?.slice(1024) ?? Buffer.alloc(1024))?.ext ?? "unkown";
            console.error(`[FileProcessor] Failed to process file: ${source}. Error: ${error?.message}, Stack: ${error?.stack}`);
            await this.setProgress(100);
            return null;
        }
    }
}