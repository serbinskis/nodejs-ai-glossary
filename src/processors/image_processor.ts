import { createWorker, OEM } from 'tesseract.js';
import { FileProcessor } from './file_processor.js';
import sutils from 'serbinskis-utils';
import config from '../config.js';

export class ImageProcessor extends FileProcessor {
    private static WORKER_COUNT = 1; //Optional, but not needed since we will process images sequentially.
    private static WORKER_INDEX = 0;
    private static callbacks: Map<string, ImageProcessor> = new Map();
    private static loading: boolean = false;
    private static workers: Tesseract.Worker[] = [];
    private jobId: string = sutils.uuidv4(true);

    /**
     * Processes an array containing image buffers and strings.
     * It extracts text from the image buffers, replacing them in-place with the extracted text.
     * The function reports its progress via a callback.
     *
     * @param images An array of Buffers and strings. Buffers will be processed and replaced.
     * @param progressCallback A function to call with progress updates (a number from 0 to 100).
     */
    public static async processArray(images: (Buffer | string)[], progressCallback: (progress: number) => void | Promise<void>) {
        const images_count = [images.filter(Buffer.isBuffer).length, 0];
        await progressCallback(0);

        // Iterate through the entire array to find the buffers.
        for (let i = 0; i < images.length; i++) {
            if (!Buffer.isBuffer(images[i])) { continue ; }
            const imageProcessor = new ImageProcessor(images[i] as Buffer);

            imageProcessor.setCallback(async (progress: number) => {
                const progressFromPreviousImages = (images_count[1] / images_count[0]) * 100; // Calculate the progress made from already completed images.
                const progressSliceForThisImage = (1 / images_count[0]) * 100; // Calculate the "slice" of the total progress bar this single image represents.
                const progressWithinSlice = (progress / 100) * progressSliceForThisImage; // Map the current image's 0-100% progress to its slice.
                const totalProgress = progressFromPreviousImages + progressWithinSlice; // The total progress is the sum of previous work and the current granular progress.
                await progressCallback(totalProgress); // Report the overall progress using the main callback function.
            });

            //Await the text extraction and modify the array in-place.
            images[i] = await imageProcessor.extractText();
            await progressCallback((++images_count[1] / images_count[0]) * 100);
        }
    }

    private static async createWorker(): Promise<Tesseract.Worker> {
        var worker = await createWorker(['eng', 'lav'], OEM.DEFAULT, { errorHandler: () => {}, logger: async (m) => {
            if (m.status !== 'recognizing text') { return ; } // We only care about the 'recognizing text' status for the progress bar.
            await ImageProcessor.callbacks.get(m.userJobId)?.setProgress(m.progress * 100);
        }});

        var { jobId } = await worker.setParameters({ user_defined_dpi: '300' }); //This is needed to disable Warning: Invalid resolution %d DPI. Using 70 instead.
        if (config.DEBUG) { console.log(`[ImageProcessor] Loaded Tesseract Worker: (${jobId})`); }
        return worker;
    }

    public static async loadTesseract() {
        while (this.loading) { await new Promise(res => setTimeout(res, 1)); } // Wait if already loading
        if (this.workers.length != this.WORKER_COUNT) { this.loading = true; } // Prevent multiple simultaneous loads
        for (let i = this.workers.length; i < this.WORKER_COUNT; i++) { this.workers[i] = await this.createWorker(); } // Load workers

        this.loading = false;
        this.WORKER_INDEX = (this.WORKER_INDEX + 1) % this.WORKER_COUNT;
        return this.workers[this.WORKER_INDEX];
    }

    protected async extractImplementation(): Promise<string | null> {
        const worker = await ImageProcessor.loadTesseract();
        const source = this.filePath ? this.filePath : this.buffer;
        ImageProcessor.callbacks.set(this.jobId, this);
        const { data: { text } } = await worker.recognize(source, {}, {}, this.jobId);
        ImageProcessor.callbacks.delete(this.jobId);
        return text;
    }
}