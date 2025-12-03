import * as fsp from 'fs/promises';
import stripRtf from "@sigma/striprtf";
import { FileProcessor } from './file_processor.js';
import { ImageProcessor } from './image_processor.js';

export class WordRtfProcessor extends FileProcessor {
    /**
     * Processor for Rich Text Format (.rtf) files.
     * It extracts standard text and performs OCR on any embedded images.
     */
    protected async extractImplementation(): Promise<string | null> {
        if (this.filePath && !this.buffer) { this.buffer = await fsp.readFile(this.filePath); }
        const content = this.buffer.toString('ascii');
        const elements: any[] = [stripRtf(content).trim()];

        // Find, decode, and process all embedded images for OCR.
        const pattern = new RegExp([
            String.raw`{\\pict`,                              // Start with {\pict
            String.raw`.*?`,                                  // Non-greedy match for any props (e.g. \picwgoal, \picw, etc.)
            String.raw`\\(pngblip|jpegblip\d*)`,              // Match image type tag (\pngblip or \jpegblipX)
            String.raw`(?:[^{}]*?{\\\*\\blipuid\s[0-9a-fA-F]+})?`, // Optionally match the entire {\*\blipuid ...} block
            String.raw`\s*`,                                  // Allow whitespace after blipuid block
            String.raw`([0-9a-fA-F\s]+?)`,                    // Capture hex data (non-greedy)
            String.raw`}`,                                    // Match the final closing brace of the pict block
        ].join(""), "gs");                                    // g = global search, s = dot matches newlines

        // Extract images into buffers
        let match;
        while ((match = pattern.exec(content)) !== null) {
            if (!match[2]) { continue; }
            if (!(match[2] = match[2]?.replace(/[^0-9A-Fa-f]/g, ''))) { continue; }
            try { elements.push(Buffer.from(match[2], 'hex')); } catch (e) { continue; }
        }

        // Now, we process each element, performing OCR on images.
        await ImageProcessor.processArray(elements, async (progress) => await this.setProgress(10 + 90 * (progress / 100)));
        return elements.join('\n');
    }
}