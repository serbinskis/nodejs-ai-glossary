import { Readable, PassThrough, Writable } from 'stream';
import { EventEmitter } from 'events';
import { createHash, Hash } from 'crypto';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';

export class StreamPiper extends EventEmitter {
    public static HEADER_SIZE = 1024;
    private sourceStream: Readable;
    private fileSize: number;
    private bytesProcessed = 0;
    private progress = 0;
    private destroyed: boolean = undefined as unknown as boolean;
    private header: Buffer = Buffer.alloc(0);
    private dataHash: string = undefined as unknown as string;
    private hash: Hash;

    private headerPromise: Promise<Buffer>;
    private hashPromise: Promise<string>;

    private outputStream: PassThrough;
    private isInitialized = false;
    private isHeaderFinalized = false;

    constructor(stream: Readable, fileSize: number) {
        super();
        this.sourceStream = stream;
        this.fileSize = fileSize > 0 ? fileSize : 0;
        this.hash = createHash('sha256');
        this.outputStream = new PassThrough({ highWaterMark: 1024 * 512 });

        this.headerPromise = new Promise((resolve, reject) => {
            this._resolveHeader = resolve;
            this._rejectHeader = reject;
        });

        this.hashPromise = new Promise((resolve, reject) => {
            this._resolveHash = resolve;
            this._rejectHash = reject;
        });

        this.sourceStream.pause();
    }

    private _resolveHeader!: (buffer: Buffer) => void;
    private _resolveHash!: (hash: string) => void;

    private _rejectHeader!: (err: Error) => void;
    private _rejectHash!: (err: Error) => void;

    private _initialize() {
        if (this.isInitialized) { return; }
        this.isInitialized = true;

        this.sourceStream.on('data', async (chunk: Buffer) => {
            this.hash.update(chunk);
            this.bytesProcessed += chunk.length;
            this.progress = this.fileSize > 0 ? (this.bytesProcessed / this.fileSize) * 100 : 0;
            this.emit('progress', Math.min(this.progress, 100));

            if (!this.isHeaderFinalized) {
                const bytesNeeded = StreamPiper.HEADER_SIZE - (this.header?.length || 0);
                const bytesToTake = Math.min(bytesNeeded, chunk.length);
                const headerPart = chunk.subarray(0, bytesToTake);
                this.header = Buffer.concat([this.header || Buffer.alloc(0), headerPart]);
                if (this.header.length >= StreamPiper.HEADER_SIZE) { this.isHeaderFinalized = true; }
                if (this.header.length >= StreamPiper.HEADER_SIZE) { this._resolveHeader(this.header); }
            }

            if (this.outputStream.write(chunk)) { return; }
            this.sourceStream.pause();
            await new Promise(resolve => this.outputStream.once('drain', resolve));
            if (!this.destroyed) { this.sourceStream.resume(); }
        });

        this.sourceStream.on('end', () => {
            if (!this.isHeaderFinalized) { this.isHeaderFinalized = true; }
            if (this.header.length < StreamPiper.HEADER_SIZE) { this._resolveHeader(this.header); }
            this._resolveHash(this.dataHash = this.hash.digest('hex'));
            console.debug(`[DEBUG] StreamPiper#_initialize -> sourceStream.on('end')`);
            this.outputStream.end();
        });

        this.sourceStream.on('error', (err) => {
            this.outputStream.emit('error', err);
        });

        this.sourceStream.resume();
    }

    public getReceived(): number {
        return this.bytesProcessed;
    }

    public getProgress(): number {
        return Math.min(this.progress, 100);
    }

    public async getHeader(): Promise<Buffer> {
        if (this.isHeaderFinalized) { return this.header; }
        this._initialize();
        const header = await this.headerPromise;
        if (!this.destroyed) { this.sourceStream.pause(); }
        return header;
    }

    public getStream(): Readable {
        this._initialize();
        if (!this.destroyed) { this.sourceStream.resume(); }
        return this.outputStream;
    }

    public async consumeStream(): Promise<void> {
        return new Promise((resolve, reject) => {
            const sink = new Writable({ write(_chunk, _enc, cb) { cb(); } });
            this.outputStream.on('error', reject);
            this.outputStream.on('end', resolve);
            this.outputStream.pipe(sink);
        });
    }

    public async getHash(): Promise<string> {
        if (this.dataHash !== undefined) { return this.dataHash }
        this._initialize();
        await this.consumeStream();
        return this.hashPromise;
    }

    public async writeFile(filePath: string, signal?: AbortSignal): Promise<boolean> {
        try {
            const readableStream = this.getStream();
            const writeStream = createWriteStream(filePath);
            await pipeline(readableStream, writeStream, { signal });
            if (this.destroyed) { this.sourceStream.destroy(); }
            if (this.destroyed) { this.outputStream.destroy(); }
            return true;
        } catch (error: Error | any) {
            console.debug(`[DEBUG] StreamPiper#writeFile -> ${error.message}`);
            return false;
        }
    }

    public destroy(error?: Error): void {
        if (this.destroyed) { return; }
        this.destroyed = true;


        console.debug(`[DEBUG] StreamPiper#destroy -> this.dataHash: ${this.dataHash}`);
        if (this.dataHash === undefined) { this.sourceStream.destroy(error); }
        if (this.dataHash === undefined) { this.outputStream.destroy(error); }
        const err = error || new Error('StreamPiper was destroyed before completion');

        if (!this.isHeaderFinalized) {
            this.isHeaderFinalized = true;
            this._resolveHeader(this.header);
        }

        if (this.dataHash === undefined) {
            this.dataHash = null as unknown as string;
            this._resolveHash(this.dataHash);
        }
    }
}