import * as cheerio from 'cheerio';
import OdtConverter from 'odt2html';
import { FileProcessor } from './file_processor.js';
import { ImageProcessor } from './image_processor.js';

export class WordOpenDocumentProcessor extends FileProcessor {
    protected async extractImplementation(): Promise<string | null> {
        if (!this.filePath) { throw new Error('File path is required for WordOpenDocumentProcessor'); }

        const traverse = (node: any, elements: any[]) => {
            if (node.type === 'text') { elements.push(node?.data?.trim()); }
            if (node.type === 'tag' && node.tagName === 'img') { elements.push(Buffer.from(node.attribs.src.split(',')[1], 'base64')); }
            for (const child of node.childNodes || []) { traverse(child, elements); } // Recurse into other tags to find nested text/images
            return elements;
        }

        const htmlContent = await OdtConverter.toHTML({ path: this.filePath });
        const elements = traverse((cheerio.load(htmlContent))('body')[0], []);
        await ImageProcessor.processArray(elements, async (progress) => await this.setProgress(10 + 90 * (progress / 100)));
        return elements.join('\n');
    }
}