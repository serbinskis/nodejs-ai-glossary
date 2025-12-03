import sharp from 'sharp'
import * as fsp from 'fs/promises';
import { extractText, extractImages, getDocumentProxy } from 'unpdf'
import { FileProcessor } from './file_processor.js';
import { ImageProcessor } from './image_processor.js';

export class PdfProcessor extends FileProcessor {
    async extractImage(
        imgData: { data: Uint8ClampedArray, width: number, height: number, channels: number },
        i: number,        // Current page index
        j: number,        // Current image index on this page
        totalPages: number, // Total pages in the document
        totalImagesOnPage: number // Total images on this specific page
    ): Promise<string> {
        // Calculate progress slices
        const pageProgressSlice = 80 / totalPages;
        const imageProgressSlice = pageProgressSlice / totalImagesOnPage;
        const imageStartProgress = 20 + (i * pageProgressSlice) + (j * imageProgressSlice);

        // --- Task 1: Image Conversion (weighted as 10% of this image's task) ---
        const imageBuffer = await sharp(imgData.data, {
            raw: { width: imgData.width, height: imgData.height, channels: imgData.channels as any }
        }).png().toBuffer();
        this.setProgress(imageStartProgress + imageProgressSlice * 0.10);

        // --- Task 2: Image OCR (weighted as 90% of this image's task) ---
        const imageProcessor = new ImageProcessor(imageBuffer);
        const ocrStartProgress = imageStartProgress + imageProgressSlice * 0.10;

        // Map the OCR tool's 0-100% progress into the tiny slice allocated for this task.
        imageProcessor.setCallback(async (ocrProgress) => { // ocrProgress is 0-100
            const progressInSlice = (ocrProgress / 100) * (imageProgressSlice * 0.90);
            await this.setProgress(ocrStartProgress + progressInSlice);
        });

        return await imageProcessor.extractText();
    }

    protected async extractImplementation(): Promise<string | null> {
        if (this.filePath && !this.buffer) { this.buffer = await fsp.readFile(this.filePath); }
        this.setProgress(10);
        const pdf = await getDocumentProxy(new Uint8Array(this.buffer), { verbosity: 0 });
        let text_pages = (await extractText(pdf)).text;
        this.setProgress(20);

        // Process pages sequentially
        for (let i = 0; i < text_pages.length; i++) {
            const text = text_pages[i] ?? '';
            const images = (await extractImages(pdf, i + 1)) as any[] || [];
            for (let j = 0; j < images.length; j++) { images[j] = await this.extractImage(images[j], i, j, text_pages.length, images.length); }
            text_pages[i] = `${text} ${images.join('\n')}`;
            this.setProgress(20 + Math.floor(80 * (i + 1) / text_pages.length));
        }

        if (this.filePath && this.buffer) { this.buffer = null; } // Free memory
        return text_pages.join('\n');
    }
}