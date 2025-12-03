import { FileProcessor } from './file_processor.js';
import { WhisperStream } from '../whisper/whisper.js';
import config from '../config.js';

export class AudioProcessor extends FileProcessor {
    protected async extractImplementation(): Promise<string | null> {
        var source = this.filePath ? this.filePath : this.buffer;
        const whisper = new WhisperStream(config.WHISER_OPTIONS, config.VAD_ADAPTER_OPTIONS);
        whisper.on('progress', (progress) => this.setProgress(progress));
        whisper.on('error', (error) => { throw error });
        return (await whisper.transcribe(source)).map(seg => seg.text).join(' ');
    }
}