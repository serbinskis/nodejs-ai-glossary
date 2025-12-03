import { FileProcessor } from './file_processor.js';
import { ImageProcessor } from './image_processor.js';
import { extractPptx } from 'pptx-content-extractor';

export class PowerPointOpenXMLProcessor extends FileProcessor {
    protected async extractImplementation(): Promise<string | null> {
        if (!this.filePath) { throw new Error('File path is required for PowerPointOpenXMLProcessor'); }

        const getMedia = (pptx, mediaName) => {
            const media = pptx.media.find(m => m.name.endsWith(mediaName));
            if (!media?.content) { return ""; }
            return Buffer.from(media.content.split(',')[1], 'base64');
        }

        const traverse = async (pptx, element, elements: any[]) => {
            if (typeof element !== 'object' || element === null) { return; }
            if (element.text) { elements.push(element.text.join(' ')); }
            (element?.mediaNames || []).forEach(name => elements.push(getMedia(pptx, name)));
            for (const child of Object.values(element)) { await traverse(pptx, child, elements); }
            return elements;
        };

        var pptx = await extractPptx(this.filePath);
        const elements = await traverse(pptx, pptx.slides, []);
        await ImageProcessor.processArray(elements, async (progress) => await this.setProgress(10 + 90 * (progress / 100)));
        return elements.join('\n');
    }
}