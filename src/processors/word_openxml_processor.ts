import mammoth from 'mammoth';
import { FileProcessor } from './file_processor.js';
import { ImageProcessor } from './image_processor.js';

export class WordOpenXMLProcessor extends FileProcessor {
    protected async extractImplementation(): Promise<string | null> {
        var source = this.filePath ? { path: this.filePath } : { buffer: this.buffer };

        // First, we need to traverse the document to find all text and image elements.
        const traverse = async (element, elements: any[]) => {
            if (element.type === 'text') { elements.push(element.value) }
            if (element.type === 'image') { elements.push(await element.readAsBuffer()) }
            for (const child of element.children || []) { await traverse(child, elements); }
            return elements;
        };

        // Traverse the document to collect text and image elements.
        const elements = await traverse(await new Promise<any>(async (resolve, reject) => {
            try {
                await mammoth.convertToHtml(source, { transformDocument: (e) => { resolve(e); return e; } });
            } catch (err) { reject(err); }
        }), []);

        // Now, we process each element, performing OCR on images.
        await ImageProcessor.processArray(elements, async (progress) => await this.setProgress(10 + 90 * (progress / 100)));
        return elements.join('\n');
    }
}