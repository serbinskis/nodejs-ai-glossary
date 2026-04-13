import ffmpeg from "fluent-ffmpeg";
import { path as ffmpeg_path } from "@ffmpeg-installer/ffmpeg";
import { PassThrough, Writable, Readable } from "stream";
import { fileTypeStream, ReadableStreamWithFileType } from "file-type";
import { EventEmitter } from "events";
import config from "../config.js";


export class PCMConverter extends EventEmitter {
    private static UNSUPORTED_STREAM: string[] = ['mp4', 'mov'];
    private stream: PassThrough = new PassThrough();
    private input: string | Readable;
    private input_format: string = null as unknown as string;
    private codec: string = null as unknown as string;
    private format: string = null as unknown as string;
    private duration: number = 0;

    static { ffmpeg.setFfmpegPath(ffmpeg_path); }

    constructor(input: string | Buffer | Readable, codec?: string, format?: string) {
        super();
        this.codec = codec ? codec : 'pcm_s16le';
        this.format = format ? format : 's16le';
        this.input = Buffer.isBuffer(input) ? Readable.from(input) : input;
    }

    public static getPcmDurationInSeconds(pcmBuffer: Buffer): number {
        const bytesPerSample = 2;
        const totalSamples = pcmBuffer.length / (bytesPerSample * 1);
        return totalSamples / 16000;
    }

    public static encodeRawPcmToWav(pcmBuffer: Buffer, numChannels: number = 1, sampleRate: number = 16000, bitsPerSample: number = 16): Buffer {
        const blockAlign = numChannels * (bitsPerSample / 8);
        const byteRate = sampleRate * blockAlign;
        const pcmDataSize = pcmBuffer.length;

        const header = Buffer.alloc(44);

        header.write('RIFF', 0);
        header.writeUInt32LE(36 + pcmDataSize, 4);
        header.write('WAVE', 8);

        header.write('fmt ', 12);
        header.writeUInt32LE(16, 16);
        header.writeUInt16LE(1, 20);
        header.writeUInt16LE(numChannels, 22);
        header.writeUInt32LE(sampleRate, 24);
        header.writeUInt32LE(byteRate, 28);
        header.writeUInt16LE(blockAlign, 32);
        header.writeUInt16LE(bitsPerSample, 34);

        header.write('data', 36);
        header.writeUInt32LE(pcmDataSize, 40);

        return Buffer.concat([header, pcmBuffer]);
    }

    private timemarkToSeconds(timemark: string): number {
        const [hours, minutes, seconds] = timemark.split(':').map(parseFloat);
        return (hours * 3600) + (minutes * 60) + seconds;
    }

    private async getFormat() {
        this.input = await fileTypeStream(this.input as Readable);
        let ext = (this.input as ReadableStreamWithFileType).fileType!.ext;
        if (PCMConverter.UNSUPORTED_STREAM.includes(ext)) { throw new Error(`The file format '${ext}' is not supported for streaming conversion.`); }
        return ext;
    }

    private async start(codec: string, format: string, channels: number, frequency: number) {
        if (typeof this.input !== "string") {
            try {
                this.input_format = await this.getFormat();
            } catch (error: Error | any) {
                this.emit("error", error);
                return this.stream.destroy(error);
            }
        }

        const command = ffmpeg(this.input)
            .noVideo()
            .audioCodec(codec)
            .format(format)
            .audioChannels(channels)
            .audioFrequency(frequency)
            .on("start", (cmd: string) => this.emit("start", cmd))
            .on("progress", (p: { percent?: number, timemark?: string }) => {
                let percent = p.percent;
                if ((this.duration > 0) && p.timemark && !percent) { percent = (this.timemarkToSeconds(p.timemark) / this.duration) * 100; }
                if (config.DEBUG) { console.log(`[ffmpeg progress] -> p: ${JSON.stringify(p)}, p.percent: ${p.percent}, percent: ${percent}`); }
                this.emit("progress", Math.min(Math.max(percent ?? 0, 0), 100));
            })
            .on('stderr', (serr: string) => {
                if (config.DEBUG) { console.log('[ffmpeg output]: ' + serr); }
                if (this.duration > 0) { return; }

                const durationMatch = serr.match(/Duration: (\d{2}:\d{2}:\d{2}\.\d{2})/);
                if (!durationMatch || !durationMatch[1]) { return; }
                this.duration = this.timemarkToSeconds(durationMatch[1]);
                if (config.DEBUG) { console.log(`[ffmpeg duration]: Parsed duration: ${this.duration} seconds`); }
            })
            .on("error", (err: Error) => {
                if (config.DEBUG) { console.log('[ffmpeg error]: ' + err); }
                if (err.message == "Output stream closed") { return; }
                this.emit("error", err);
                this.stream.destroy(err);
            })
            .on("end", () => {
                if (config.DEBUG) { console.log('[ffmpeg end]: Stream ended'); }
                this.emit("progress", 100);
                this.emit("end");
            });

        if (this.input_format) { command.inputFormat(this.input_format); }
        command.pipe(this.stream, { end: true });
    }

    pipe(stream: Writable, options?: { end?: boolean }, codec?: string, format?: string): Writable {
        this.start(codec ? codec : this.codec, format ? format : this.format, 1, 16000);
        this.stream.pipe(stream, options);
        return stream;
    }

    async convertFormat(codec?: string, format?: string): Promise<Buffer> {
        const buffer = this.streamToBuffer(this.stream);
        this.start(codec ? codec : this.codec, format ? format : this.format, 1, 16000);
        return await buffer;
    }

    private async streamToBuffer(stream: Readable): Promise<Buffer> {
        return await new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            stream.on("data", (chunk: Buffer) => chunks.push(chunk));
            stream.on("end", () => resolve(Buffer.concat(chunks)));
            stream.on("error", (err) => reject(err));
        });
    }

    async convertPcmBuffer(): Promise<Buffer> {
        return await this.convertFormat('pcm_s16le', 's16le');
    }

    async convertPcmFloat32(): Promise<Float32Array> {
        const buffer = await this.convertFormat('pcm_f32le', 'f32le');;
        return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / Float32Array.BYTES_PER_ELEMENT);
    }
}