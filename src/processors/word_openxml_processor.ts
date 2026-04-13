import mammoth from 'mammoth';
import { FileProcessor } from './file_processor.js';
import { ImageProcessor } from './image_processor.js';

export class WordOpenXMLProcessor extends FileProcessor {
    protected async extractImplementation(): Promise<string | null> {
        var source = this.filePath ? { path: this.filePath } : { buffer: this.buffer };

        const traverse = async (element: any, elements: any[]) => {
            if (element.type === 'text') { elements.push(element.value) }
            if (element.type === 'image') { elements.push(await element.readAsBuffer()) }
            for (const child of element.children || []) { await traverse(child, elements); }
            return elements;
        };

        const elements = await traverse(await new Promise<any>(async (resolve, reject) => {
            try {
                await mammoth.convertToHtml(source as any, { transformDocument: (e) => { resolve(e); return e; } });
            } catch (err) { reject(err); }
        }), []);

        await ImageProcessor.processArray(elements, async (progress) => await this.setProgress(10 + 90 * (progress / 100)));
        return elements.join('\n');
    }
}