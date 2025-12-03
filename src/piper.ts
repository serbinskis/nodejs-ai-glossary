import { Readable, PassThrough } from 'stream';
import { EventEmitter } from 'events';
import { createHash, Hash } from 'crypto';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';

export class StreamPiper extends EventEmitter {
    public static HEADER_SIZE = 1024;
    private sourceStream: Readable;
    private fileSize: number;
    private header: Buffer = Buffer.alloc(0);
    private dataHash: string = null;
    private hash: Hash;

    // Promises to hold the results
    private headerPromise: Promise<Buffer>;
    private hashPromise: Promise<string>;

    // The stream we provide to the user
    private outputStream: PassThrough;
    private isInitialized = false;
    private isHeaderFinalized = false;

    /**
     * Creates an instance of StreamPiper.
     * @param stream The source readable stream.
     * @param fileSize The total size of the file for progress calculation.
     */
    constructor(stream: Readable, fileSize: number) {
        super();
        this.sourceStream = stream;
        this.fileSize = fileSize > 0 ? fileSize : 0;
        this.hash = createHash('sha256');
        this.outputStream = new PassThrough();
        this.headerPromise = new Promise(resolve => this._resolveHeader = resolve);
        this.hashPromise = new Promise(resolve => this._resolveHash = resolve);
        this.sourceStream.pause();
    }

    // Private promise resolvers to be called from the pipeline
    private _resolveHeader!: (buffer: Buffer) => void;
    private _resolveHash!: (hash: string) => void;

    /**
     * Initializes the internal pipeline that processes the stream.
     * This is called automatically by the first method that needs the stream.
     */
    private _initialize() {
        if (this.isInitialized) { return; }
        this.isInitialized = true;
        let bytesProcessed = 0;

        this.sourceStream.on('data', (chunk: Buffer) => {
            // Update hash and progress
            this.hash.update(chunk);
            bytesProcessed += chunk.length;
            const progress = this.fileSize > 0 ? (bytesProcessed / this.fileSize) * 100 : 0;
            this.emit('progress', Math.min(progress, 100));

            // Capture the header if we haven't already
            if (!this.isHeaderFinalized) {
                const bytesNeeded = StreamPiper.HEADER_SIZE - (this.header?.length || 0); // Calculate how many bytes we still need for the header.
                const bytesToTake = Math.min(bytesNeeded, chunk.length); // Determine how many bytes to take from the current chunk.
                const headerPart = chunk.subarray(0, bytesToTake); // Get that part of the chunk.
                this.header = Buffer.concat([this.header || Buffer.alloc(0), headerPart]); // Append it to our header.
                if (this.header.length >= StreamPiper.HEADER_SIZE) { this.isHeaderFinalized = true; } // If we're done, set the falg
                if (this.header.length >= StreamPiper.HEADER_SIZE) { this._resolveHeader(this.header); } // If we're done, resolve the promise.
            }
            
            // Pass the data to the output stream for consumers like writeFile
            this.outputStream.write(chunk);
        });

        this.sourceStream.on('end', () => {
            if (!this.isHeaderFinalized) { this.isHeaderFinalized = true; }
            if (this.header.length < StreamPiper.HEADER_SIZE) { this._resolveHeader(this.header); }
            this._resolveHash(this.dataHash = this.hash.digest('hex'));
            this.outputStream.end();
        });

        this.sourceStream.on('error', (err) => {
            this.outputStream.emit('error', err);
        });

        this.sourceStream.resume();
    }

    /**
     * Asynchronously gets the first 1024 bytes of the stream.
     * Calling this will start the stream processing.
     * @returns A Promise that resolves with a Buffer containing the header.
     */
    public async getHeader(): Promise<Buffer> {
        if (this.isHeaderFinalized) { return this.header; }
        this._initialize();
        const header = await this.headerPromise;
        this.sourceStream.pause();
        return header;
    }

    /**
     * Returns a clean, readable stream that can be piped to a destination.
     * The stream contains the *entire* file content from the beginning.
     * @returns A Readable stream.
     */
    public getStream(): Readable {
        this._initialize();
        this.sourceStream.resume();
        return this.outputStream;
    }

    /**
     * Asynchronously gets the final SHA256 hash of the entire stream.
     * @returns A Promise that resolves with the hex-encoded hash string once the stream has fully ended.
     */
    public async getHash(): Promise<string> {
        if (this.dataHash) { return this.dataHash }
        this._initialize();
        this.sourceStream.resume();
        return this.hashPromise;
    }

    /**
     * Writes the entire stream content to a file at the specified path.
     * This will consume the stream.
     * @param filePath The absolute or relative path to the output file.
     * @returns A Promise that resolves when the file has been fully written.
     */
    public async writeFile(filePath: string): Promise<void> {
        const readableStream = this.getStream();
        const writeStream = createWriteStream(filePath);
        await pipeline(readableStream, writeStream);
    }
}