import WordExtractor from 'word-extractor';
import { FileProcessor } from './file_processor.js';

export class WordDocProcessor extends FileProcessor {
    protected async extractImplementation(): Promise<string | null> {
        var source = this.filePath ? this.filePath : this.buffer;
        var document = (await new WordExtractor().extract(source));
        return `${document.getBody()}\n${document.getTextboxes({ includeBody: true })}`
    }
}