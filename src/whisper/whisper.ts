
import path from 'path';
import * as fsp from 'fs/promises';
import extract from 'extract-zip';
import sutils from 'serbinskis-utils';
import config from '../config.js';
import { Readable } from 'stream';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { PCMConverter } from './pcm_converter.js';
import { VadAdapter, VadAdapterOptions } from './vad_adapter.js';
import { initWhisper, TranscribeNewSegmentsResult, WhisperContext } from '@fugood/whisper.node'


export type TranscriptionSegment = {
    start: number;
    end: number;
    text: string;
};

export type DetectedLanguage = {
    language: string;
    probability: number;
};

export type WhisperOptions = {
    modelName?: string;
    language?: string;
    gpu?: boolean;
    threads?: number;
    beamSize?: number;
    temperature?: number;
    backend?: 'default' | 'vulkan' | 'cuda';
};

export class WhisperStream extends EventEmitter {
    public static WHISPER_DIRECTORY = path.resolve(config.BASE_DIRECTORY, 'whisper');
    public static MODELS_DIRECTORY = path.resolve(WhisperStream.WHISPER_DIRECTORY, 'models');
    public static WHISPER_WIN_URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.2/whisper-bin-x64.zip';
    public static WHISPER_DEFAULT_MODEL = 'ggml-base.bin';
    private static WHISPER_NODE = true;
    private static models: string[] = [];
    private static loading: boolean | null = false;
    private transcribing: boolean = false;
    private audioInput: string | Buffer | Readable = undefined as unknown as string;
    private options: WhisperOptions;
    private vad_options: VadAdapterOptions;

    constructor(options?: WhisperOptions, vad_options?: VadAdapterOptions) {
        super();
        this.options = options as WhisperOptions;
        this.vad_options = vad_options as VadAdapterOptions;
    }

    public async transcribe(audioInput: string | Buffer | Readable): Promise<TranscriptionSegment[]> {
        return new Promise((resolve, reject) => {
            this.audioInput = audioInput;
            const segments: TranscriptionSegment[] = [];
            const pmcConverter = new PCMConverter(this.audioInput);
            const vadAdapter = new VadAdapter(this.vad_options);

            let activeTranscriptionJobs = 0;
            let isVadFinished = false;
            let conversionProgress = 0;
            let progressMarker = 0;

            const checkCompletion = () => {
                if (isVadFinished && activeTranscriptionJobs === 0) {
                    this.emit('progress', 100);
                    resolve(segments);
                }
            };

            pmcConverter.on("progress", (percent) => { conversionProgress = percent; });
            pmcConverter.on("error", reject);
            vadAdapter.on("error", reject);
            pmcConverter.pipe(vadAdapter);

            vadAdapter.on("data", async (chunk: Buffer) => {
                activeTranscriptionJobs++;
                vadAdapter.pause();

                if (this.transcribing) { await new Promise(resolve => this.once('resume', resolve)); }
                this.transcribing = true;
                vadAdapter.resume();

                const sliceStart = progressMarker;
                const sliceEnd = conversionProgress;
                const sliceSize = Math.max(0, sliceEnd - sliceStart);
                progressMarker = conversionProgress;

                const chunkEndTimeSeconds = vadAdapter.getTotalSecondsProcessed();
                const chunkDurationSeconds = PCMConverter.getPcmDurationInSeconds(chunk);
                const chunkStartTimeSeconds = Math.max(0, chunkEndTimeSeconds - chunkDurationSeconds);

                try {
                    const whisperNode = WhisperStream.WHISPER_NODE ? new WhisperNode(chunk, this.options) : new WhisperPCM(chunk, this.options);

                    whisperNode.on('language', (language) => this.emit('language', language));
                    whisperNode.on('transcription', (segment) => {
                        segment = { ...segment, start: segment.start + chunkStartTimeSeconds, end: segment.end + chunkStartTimeSeconds };
                        segments.push(segment);
                        this.emit('transcription', segment);
                    });

                    whisperNode.on('progress', (chunkProgress) => {
                        const progressWithinSlice = (chunkProgress / 100) * sliceSize;
                        const overallProgress = sliceStart + progressWithinSlice;
                        if (config.DEBUG) { console.log(`[WhisperStream] -> CProgress: ${chunkProgress}, OProgress: ${overallProgress}, sliceSize: ${sliceSize}, sliceStart: ${sliceStart}, sliceEnd: ${sliceEnd}`); }
                        this.emit('progress', overallProgress);
                    });

                    whisperNode.on('error', (error) => {
                        vadAdapter.destroy();
                        reject(error);
                    });

                    whisperNode.on('end', () => {
                        activeTranscriptionJobs--;
                        this.transcribing = false;
                        this.emit('resume');
                        this.emit('progress', sliceEnd);
                        vadAdapter.resume();
                        checkCompletion();
                    });

                    await whisperNode.transcribe();
                } catch (error) {
                    reject(error);
                }
            });

            vadAdapter.on('finish', () => {
                isVadFinished = true;
                checkCompletion();
            });
        });
    }

    public static async getModels(): Promise<string[]> {
        try {
            if (WhisperStream.models.length > 0) { return WhisperStream.models; }
            const HUGGING_FACE_API_URL = 'https://huggingface.co/api/models/ggerganov/whisper.cpp';
            const data = await (await fetch(HUGGING_FACE_API_URL)).json();
            WhisperStream.models = data.siblings.filter((file: any) => file.rfilename.endsWith('.bin')).map((file: any) => file.rfilename);
            return WhisperStream.models;
        } catch (error) {
            console.error("Fatal: Could not fetch the list of downloadable models.", error);
            return [];
        }
    }

    public static async getModel(modelName: string): Promise<string | null> {
        while (WhisperStream.loading) { await new Promise(res => setTimeout(res, 1)); }
        if (!(await WhisperStream.getModels()).includes(modelName)) { throw new Error(`Model "${modelName}" is not a valid model. Available models are: ${WhisperStream.models.join(', ')}`); }
        WhisperStream.loading = true;

        const downloadUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelName}`;
        const headResponse = await fetch(downloadUrl, { method: 'HEAD' });
        const contentLength = parseInt(headResponse?.headers?.get('content-length') || "-1");

        const modelPath = path.resolve(WhisperStream.MODELS_DIRECTORY, modelName);
        try { await fsp.mkdir(WhisperStream.MODELS_DIRECTORY, { recursive: true }); } catch (e) { return WhisperStream.loading = null; }
        try { var fsize = (await fsp.stat(modelPath)).size } catch (e) { fsize = 0; }
        if (fsize === contentLength) { return modelPath; }

        var result = await sutils.download(downloadUrl, {}, modelPath, { text: `Downloading model "${modelName}"` });
        WhisperStream.loading = false;
        return result.status ? modelPath : null;
    }

    public static async getWhisper(): Promise<string> {
        if (process.platform !== 'win32') {
            throw new Error('Unsupported Operating System: Whisper CLI setup is currently only supported on Windows.');
        }

        const executablePath = path.resolve(WhisperStream.WHISPER_DIRECTORY, 'whisper-cli.exe');
        const zipPath = path.resolve(WhisperStream.WHISPER_DIRECTORY, 'whisper.zip');
        const releaseFolderPath = path.resolve(WhisperStream.WHISPER_DIRECTORY, 'Release');

        try {
            try { if ((await fsp.stat(executablePath)).size) { return executablePath; } } catch (e) {}
            while (WhisperStream.loading) { await new Promise(res => setTimeout(res, 1)); }
            WhisperStream.loading = true;

            await fsp.mkdir(WhisperStream.WHISPER_DIRECTORY, { recursive: true });
            const downloadResult = await sutils.download(WhisperStream.WHISPER_WIN_URL, {}, zipPath, { text: 'Downloading Whisper CLI' });
            if (!downloadResult.status) { throw new Error('Failed to download Whisper CLI zip file.'); }

            await extract(zipPath, { dir: WhisperStream.WHISPER_DIRECTORY });
            const filesToMove = await fsp.readdir(releaseFolderPath);

            for (const file of filesToMove) {
                const oldPath = path.resolve(releaseFolderPath, file);
                const newPath = path.resolve(WhisperStream.WHISPER_DIRECTORY, file);
                await fsp.rename(oldPath, newPath);
            }

            return executablePath;
        } catch (error: Error | any) {
            throw new Error(`Failed to get Whisper CLI: ${error.message}`);
        } finally {
            await fsp.unlink(zipPath).catch(() => {}),
            await fsp.rm(releaseFolderPath, { recursive: true, force: true }).catch(() => {})
            WhisperStream.loading = false;
        }
    }

    public static async setupWhisper(modelName?: string): Promise<{ whisperPath: string, modelPath: string }> {
        const whisperPath = await WhisperStream.getWhisper();
        const modelPath = await WhisperStream.getModel(modelName || WhisperStream.WHISPER_DEFAULT_MODEL);
        return { whisperPath, modelPath } as { whisperPath: string, modelPath: string };
    }
}



export class WhisperPCM extends EventEmitter {
    private static TIMESTAMP_REGEX = /\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.*)/;
    private static PROGRESS_REGEX = /whisper_print_progress_callback: progress\s*=\s*(\d+)/;
    private static LANGUAGE_REGEX = /auto-detected language: (\w+)\s*\(p\s*=\s*([\d.]+)\)/;
    protected audio_length: number = 0;
    protected progress: number = -1;
    protected transcriptionSegments: TranscriptionSegment[] = [];
    protected options: WhisperOptions;
    protected pcm: Buffer | ArrayBuffer;

    constructor(pcm: Buffer, options?: WhisperOptions, rawPcm: boolean = true) {
        super();
        this.audio_length = PCMConverter.getPcmDurationInSeconds(pcm);
        this.pcm = rawPcm ? pcm : PCMConverter.encodeRawPcmToWav(pcm);
        this.options = { modelName: WhisperStream.WHISPER_DEFAULT_MODEL, language: 'auto', gpu: false, threads: 4, beamSize: 5, temperature: 0, ...options };
    }

    protected parseTimestamp(timestamp: string): number {
        const [h, m, s] = timestamp.split(':');
        return parseFloat(h) * 3600 + parseFloat(m) * 60 + parseFloat(s);
    }

    protected setProgress(progress: number) {
        progress = isNaN(progress) ? 0 : Math.min(100, progress);
        if (this.progress >= progress) { return; }
        this.emit('progress', this.progress = progress);
    }

    protected parseLine(line: string) {
        const timestampMatch = line.match(WhisperPCM.TIMESTAMP_REGEX);
        if (timestampMatch) {
            const segment: TranscriptionSegment = {
                start: this.parseTimestamp(timestampMatch[1]),
                end: this.parseTimestamp(timestampMatch[2]),
                text: timestampMatch[3].trim(),
            };
            this.transcriptionSegments.push(segment);
            this.emit('transcription', segment);
            return this.setProgress(Math.floor((segment.end / this.audio_length) * 100));
        }

        const progressMatch = line.match(WhisperPCM.PROGRESS_REGEX);
        if (progressMatch) { return this.setProgress(parseInt(progressMatch[1], 10)); }

        const languageMatch = line.match(WhisperPCM.LANGUAGE_REGEX);
        if (languageMatch) {
            const lang: DetectedLanguage = {
                language: languageMatch[1],
                probability: parseFloat(languageMatch[2])
            };
            return this.emit('language', lang);
        }
    }

    public async transcribe(): Promise<TranscriptionSegment[]> {
        return await new Promise(async (resolve, reject) => {
            try {
                const { whisperPath, modelPath } = await WhisperStream.setupWhisper(this.options?.modelName);

                const whisperProcess = spawn(whisperPath, [
                    '-pp',
                    !this.options.gpu ? '--no-gpu' : '',
                    '--language', this.options.language as string,
                    '--threads', this.options.threads!.toString(),
                    '--beam-size', this.options.beamSize!.toString(),
                    '--temperature', this.options.temperature!.toString(),
                    '-m', modelPath,
                    '-of', '1',
                    '-f', '-',
                ]);

                whisperProcess.stdout.on('data', (data) => {
                    if (config.DEBUG) { console.log(data.toString().trim().split(/\r\n?|\n/).map((line: string) => `[whisper stdout] -> ${line}`).join('\n')); }
                    (data.toString() as string).split(/\r\n?|\n/).forEach((line) => this.parseLine(line));
                });

                whisperProcess.stderr.on('data', (data) => {
                    if (config.DEBUG) { console.log(data.toString().trim().split(/\r\n?|\n/).map((line: string) => `[whisper stderr] -> ${line}`).join('\n')); }
                    (data.toString() as string).split(/\r\n?|\n/).forEach((line) => this.parseLine(line));
                });

                whisperProcess.on('error', (err: Error) => {
                    this.emit('error', new Error(`Failed to start Whisper process: ${err.message}`));
                });

                whisperProcess.on('close', (code: number) => {
                    if (code === 0) {
                        this.emit('end', this.transcriptionSegments);
                        resolve(this.transcriptionSegments);
                    } else {
                        const error = new Error(`Whisper process exited with code ${code}.`);
                        this.emit('error', error);
                        reject(error);
                    }
                });

                Readable.from(this.pcm as Buffer).pipe(whisperProcess.stdin);
            } catch (error) {
                reject(error);
                this.emit('error', error);
            }
        });
    }
}


export class WhisperNode extends WhisperPCM {
    constructor(pcm: Buffer, options?: WhisperOptions) {
        super(pcm, options, false);
        const buf: Buffer = this.pcm as Buffer;
        this.pcm = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    }

    public async transcribe(): Promise<TranscriptionSegment[]> {
        return await new Promise(async (resolve, reject) => {
            let context: WhisperContext | null = null;

            try {
                const { whisperPath, modelPath } = await WhisperStream.setupWhisper(this.options?.modelName);
                context = await initWhisper({ filePath: modelPath, useGpu: this.options.gpu }, this.options.backend);

                const { stop, promise } = context.transcribeData(this.pcm as ArrayBuffer, {
                    language: this.options.language,
                    maxThreads: this.options.threads,
                    beamSize: this.options.beamSize,
                    temperature: this.options.temperature,
                    onProgress: (progress) => this.setProgress(progress),
                    onNewSegments: (result: TranscribeNewSegmentsResult) => {
                        result.segments.forEach(segment => {
                            const adjustedSegment: TranscriptionSegment = { start: segment.t0 / 1000, end: segment.t1 / 1000, text: segment.text };
                            this.transcriptionSegments.push(adjustedSegment);
                            this.emit('transcription', adjustedSegment);
                        });
                    },
                });

                const result = await promise;
                await context.release();
                this.emit('end', this.transcriptionSegments);
                resolve(this.transcriptionSegments);
            } catch (error) {
                await context?.release().catch(() => {})
                reject(error);
                this.emit('error', error);
            }
        });
    }
}