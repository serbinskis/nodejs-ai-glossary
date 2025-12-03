import config from './config.js';
import { Worker, isMainThread, parentPort } from 'worker_threads';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { LlamaGlossary } from './llama/llama.js';
import { getProcessor } from './supported.js';
import { FileProcessor } from './processors/file_processor.js';

// For WorkerMessageType
export const WMT_WORKER_LOADED = 'worker_loaded' as const;
export const WMT_WORKER_TAKEN = 'worker_taken' as const;
export const WMT_WORKER_FREE = 'worker_free' as const;
export const WMT_EXTRACT_TEXT = 'extract_text' as const;
export const WMT_EXTRACT_GLOSSARY = 'extract_glossary' as const;
export const WMT_TEXT_GLOSSARY = 'text+glossary' as const;
export const WMT_ERROR = 'error' as const;
export const WMT_EXTRACT_PROGRESS = 'extract_progress' as const;
export const WMT_GLOSSARY_PROGRESS = 'glossary_progress' as const;
export const WMT_GLOSSARY_CHUNK = 'response_chunk' as const;

// --- Main union types, built from the constants above ---

export type WorkerMessageType =
    | typeof WMT_WORKER_LOADED
    | typeof WMT_EXTRACT_TEXT
    | typeof WMT_EXTRACT_GLOSSARY
    | typeof WMT_TEXT_GLOSSARY
    | typeof WMT_ERROR
    | typeof WMT_EXTRACT_PROGRESS
    | typeof WMT_GLOSSARY_PROGRESS
    | typeof WMT_GLOSSARY_CHUNK;

// For ContentWorkerType
export const CWT_EXTRACT_TEXT = 'extract_text' as const;
export const CWT_EXTRACT_GLOSSARY = 'extract_glossary' as const;
export const CWT_TEXT_GLOSSARY = 'text+glossary' as const;

export type ContentWorkerType =
    | typeof CWT_EXTRACT_TEXT
    | typeof CWT_EXTRACT_GLOSSARY
    | typeof CWT_TEXT_GLOSSARY;

/**
 * This type creates a direct, between a job type and the message type that must be sent to the worker to initiate that job.
 */
export const JOB_TO_MESSAGE_MAP: { [key in ContentWorkerType]: WorkerMessageType } = {
    [CWT_EXTRACT_TEXT]: WMT_EXTRACT_TEXT,
    [CWT_EXTRACT_GLOSSARY]: WMT_EXTRACT_GLOSSARY,
    [CWT_TEXT_GLOSSARY]: WMT_TEXT_GLOSSARY,
};

export type ContentWorkerResult = {
    text?: string;
    glossary?: JSON;
    error?: Error;
};

type WorkerMessage = { type: WorkerMessageType, message: any };

export class ContentWorker extends EventEmitter {
    private static WORKERS_COUNT: number = config.WORKER_COUNT;
    private static FREE_WORKERS: number = config.WORKER_COUNT;
    private static WORKER_INDEX: number = 0;
    private static WORKERS: Array<Worker> = [];
    private type: ContentWorkerType;
    private input: String;

    /**
     * Creates an instance of a ContentWorker job.
     * This class encapsulates a single unit of work to be performed by a worker thread.
     * The instance does not start the job immediately; the `waitResult()` method must be called to execute it.
     *
     * @param {String} input The data to be processed by the worker. This is typically a file path or raw text content.
     * @param {ContentWorkerType} type The type of job to be performed, which determines the task the worker will execute on the input.
     */
    constructor(input: String, type: ContentWorkerType) {
        super();
        this.input = input;
        this.type = type;
    }

    public static async waitInQueue() {
        //TODO: This can faill if too many request at once
        while (ContentWorker.FREE_WORKERS == 0) { await new Promise(resolve => setTimeout(resolve, 1)); }
    }

    public async waitResult(): Promise<ContentWorkerResult> {
        if (ContentWorker.WORKERS.length == 0) { await ContentWorker.createWorkers(); }
        await ContentWorker.waitInQueue();
        console.log(`[ContentWorker] -> file: ${this.input}, free: ${ContentWorker.FREE_WORKERS}`);

        var worker = ContentWorker.WORKERS[ContentWorker.WORKER_INDEX];
        ContentWorker.WORKER_INDEX = (ContentWorker.WORKER_INDEX + 1) % ContentWorker.WORKERS.length;
        ContentWorker.FREE_WORKERS--;

        this.emit(WMT_WORKER_TAKEN, { free: ContentWorker.FREE_WORKERS, full: ContentWorker.WORKERS_COUNT });
        worker.on('message', (response: WorkerMessage) => this.emit(response.type, response.message));
        worker.postMessage({ type: JOB_TO_MESSAGE_MAP[this.type], message: this.input });

        var result: ContentWorkerResult = await new Promise((resolve) => {
            this.once(WMT_ERROR, (message) => resolve({ error: new Error(message) }));
            this.once(WMT_EXTRACT_TEXT, (text) => resolve({ text }));
            this.once(WMT_EXTRACT_GLOSSARY, (glossary) => resolve({ glossary: glossary }));
            this.once(WMT_TEXT_GLOSSARY, (data) => resolve(data));
        });

        ContentWorker.FREE_WORKERS++
        this.emit(WMT_WORKER_FREE, { free: ContentWorker.FREE_WORKERS, full: ContentWorker.WORKERS_COUNT });
        return result;
    }

    public static async createWorkers(): Promise<void> {
        if (this.WORKERS.length > 0) { return; } //If workers are already created, then return

        for (let i = 0; i < this.WORKERS_COUNT; i++) {
            var worker = new Worker(fileURLToPath(import.meta.url));
            await new Promise(resolve => worker.once('message', resolve));
            this.WORKERS.push(worker);
            console.log(`Created worker [${i + 1}/${this.WORKERS_COUNT}].`);
        }
    }

    public static getFreeWorkersCount(): number { return ContentWorker.FREE_WORKERS; }
    public static getTotalWorkersCount(): number { return ContentWorker.WORKERS_COUNT; }
}

(async () => {
    if (isMainThread) { return; }
    var glossary = await new LlamaGlossary(config.GLOSSARY_OPTIONS, null, config.GLOSSARY_MODEL).init();
    parentPort.postMessage(WMT_WORKER_LOADED);

    parentPort.on('message', async (request: WorkerMessage) => {
        var text_result = '';

        if ((request.type == CWT_EXTRACT_TEXT) || (request.type == CWT_TEXT_GLOSSARY)) {
            try { var processor: FileProcessor = getProcessor(request.message); }
            catch (error) { return parentPort.postMessage({ type: WMT_ERROR, message: `Failed to initialize file processor. Details: ${error.message}` }); }
            if (!processor) { return parentPort.postMessage({ type: WMT_ERROR, message: `Unsupported file type. No processor is available for the provided file.` }); }
            processor.setCallback((progress) => parentPort.postMessage({ type: WMT_EXTRACT_PROGRESS, message: progress }));
            text_result = await processor.extractText();
            if (request.type == CWT_EXTRACT_TEXT) { parentPort.postMessage({ type: WMT_EXTRACT_TEXT, message: text_result }); }
        }

        const responseChunkListener = (chunk) => { parentPort.postMessage({ type: WMT_GLOSSARY_CHUNK, message: chunk }); };
        const glossaryProgressListener = (chunk) => { parentPort.postMessage({ type: WMT_GLOSSARY_PROGRESS, message: chunk }); };

        if (request.type == CWT_EXTRACT_GLOSSARY) {
            glossary.on('response_chunk', responseChunkListener);
            glossary.on('progress', glossaryProgressListener);
            var result = await glossary.createGlossary(request.message);
            glossary.removeListener('response_chunk', responseChunkListener);
            glossary.removeListener('progress', glossaryProgressListener);
            parentPort.postMessage({ type: WMT_EXTRACT_GLOSSARY, message: result });
        }

        if (request.type == CWT_TEXT_GLOSSARY) {
            glossary.on('response_chunk', responseChunkListener);
            glossary.on('progress', glossaryProgressListener);
            var glossary_result = await glossary.createGlossary(text_result);
            glossary.removeListener('response_chunk', responseChunkListener);
            glossary.removeListener('progress', glossaryProgressListener);
            parentPort.postMessage({ type: WMT_TEXT_GLOSSARY, message: { text: text_result, glossary: glossary_result } });
        }
    });
})();