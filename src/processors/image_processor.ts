import { createWorker, ImageLike, OEM } from 'tesseract.js';
import { FileProcessor } from './file_processor.js';
import config from '../config.js';

export class ImageProcessor extends FileProcessor {
    private static WORKER_COUNT = 1;
    private static WORKER_INDEX = 0;
    private static callbacks: Map<string, ImageProcessor> = new Map();
    private static loading: boolean = false;
    private static workers: Tesseract.Worker[] = [];
    private jobId: string = crypto.randomUUID();

    public static async processArray(images: (Buffer | string)[], progressCallback: (progress: number) => void | Promise<void>) {
        const images_count = [images.filter(Buffer.isBuffer).length, 0];
        await progressCallback(0);

        for (let i = 0; i < images.length; i++) {
            if (!Buffer.isBuffer(images[i])) { continue ; }
            const imageProcessor = new ImageProcessor(images[i] as Buffer);

            imageProcessor.setCallback(async (progress: number) => {
                const progressFromPreviousImages = (images_count[1] / images_count[0]) * 100;
                const progressSliceForThisImage = (1 / images_count[0]) * 100;
                const progressWithinSlice = (progress / 100) * progressSliceForThisImage;
                const totalProgress = progressFromPreviousImages + progressWithinSlice;
                await progressCallback(totalProgress);
            });

            images[i] = await imageProcessor.extractText() as string;
            await progressCallback((++images_count[1] / images_count[0]) * 100);
        }
    }

    private static async createWorker(): Promise<Tesseract.Worker> {
        const worker = await createWorker(['eng', 'lav'], OEM.DEFAULT, { errorHandler: () => {}, logger: async (m) => {
            if (m.status !== 'recognizing text') { return ; }
            await ImageProcessor.callbacks.get(m.userJobId)?.setProgress(m.progress * 100);
        }});

        const { jobId: workerId } = await worker.setParameters({ user_defined_dpi: '300' });
        if (config.DEBUG) { console.log(`[ImageProcessor] Loaded Tesseract Worker: (${workerId})`); }
        return worker;
    }

    public static async loadTesseract() {
        while (this.loading) { await new Promise(res => setTimeout(res, 1)); }
        if (this.workers.length != this.WORKER_COUNT) { this.loading = true; }
        for (let i = this.workers.length; i < this.WORKER_COUNT; i++) { this.workers[i] = await this.createWorker(); }

        this.loading = false;
        this.WORKER_INDEX = (this.WORKER_INDEX + 1) % this.WORKER_COUNT;
        return this.workers[this.WORKER_INDEX];
    }

    protected async extractImplementation(): Promise<string | null> {
        const worker = await ImageProcessor.loadTesseract();
        const source = this.filePath ? this.filePath : this.buffer;
        ImageProcessor.callbacks.set(this.jobId, this);
        const { data: { text } } = await worker.recognize(source as ImageLike, {}, {}, this.jobId);
        ImageProcessor.callbacks.delete(this.jobId);
        return text;
    }
}