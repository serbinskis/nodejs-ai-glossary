import * as fsp from 'fs/promises';
import stripRtf from "@sigma/striprtf";
import { FileProcessor } from './file_processor.js';
import { ImageProcessor } from './image_processor.js';

export class WordRtfProcessor extends FileProcessor {
    protected async extractImplementation(): Promise<string | null> {
        if (this.filePath && !this.buffer) { this.buffer = await fsp.readFile(this.filePath); }
        const content = this.buffer!.toString('ascii');
        const elements: any[] = [stripRtf(content).trim()];

        const pattern = new RegExp([
            String.raw`{\\pict`,
            String.raw`.*?`,
            String.raw`\\(pngblip|jpegblip\d*)`,
            String.raw`(?:[^{}]*?{\\\*\\blipuid\s[0-9a-fA-F]+})?`,
            String.raw`\s*`,
            String.raw`([0-9a-fA-F\s]+?)`,
            String.raw`}`,
        ].join(""), "gs");

        let match;
        while ((match = pattern.exec(content)) !== null) {
            if (!match[2]) { continue; }
            if (!(match[2] = match[2]?.replace(/[^0-9A-Fa-f]/g, ''))) { continue; }
            try { elements.push(Buffer.from(match[2], 'hex')); } catch (e) { continue; }
        }

        await ImageProcessor.processArray(elements, async (progress) => await this.setProgress(10 + 90 * (progress / 100)));
        return elements.join('\n');
    }
}