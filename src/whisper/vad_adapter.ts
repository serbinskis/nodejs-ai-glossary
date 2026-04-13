import { Duplex } from 'stream';
import { FrameProcessorOptions, RealTimeVAD } from '@ericedouard/vad-node-realtime';
import { SpeechProbabilities } from '@ericedouard/vad-node-realtime/dist/common/index.js';
import * as VadLogging from '@ericedouard/vad-node-realtime/dist/common/logging.js';

export interface VadAdapterOptions extends FrameProcessorOptions  {
    minChunkDurationSeconds: number;

    maxChunkDurationSeconds: number;

    posSplitSpeechThreshold: number;

    prefixFramesCount: number;

    postfixFramesCount: number;
}

export const VAD_OPTIONS_DEFAULT: VadAdapterOptions = {
    minChunkDurationSeconds: 300,
    maxChunkDurationSeconds: 600,
    posSplitSpeechThreshold: 0.6,
    positiveSpeechThreshold: 0.6,
    negativeSpeechThreshold: 0.4,
    minSpeechFrames: 5,
    prefixFramesCount: 10,
    postfixFramesCount: 10,
} as VadAdapterOptions;

export const VAD_OPTIONS_FULL_AUDIO: VadAdapterOptions = {
    ...VAD_OPTIONS_DEFAULT,
    positiveSpeechThreshold: 0,
    negativeSpeechThreshold: 1,
    minSpeechFrames: 1,
    prefixFramesCount: 0,
    postfixFramesCount: 0,
} as VadAdapterOptions;

export class VadAdapter extends Duplex {
    private readonly options: VadAdapterOptions;
    private vad: RealTimeVAD | null = null;
    private totalSecondsProcessed: number = 0;
    private speechSegmentCollector: Buffer[] = [];
    private collectorDuration = 0;
    private pendingWriteCallback: ((err: any) => void) | null = null;
    private pendingFinilzied: boolean = false;
    private initializationPromise: any;

    private prefixCollector: Float32Array[] = [];
    private postfixFrameCounter: number = 0;

    constructor(options?: VadAdapterOptions) {
        super();

        this.options = { ...VAD_OPTIONS_DEFAULT, ...options, };

        if (this.options.minChunkDurationSeconds > this.options.maxChunkDurationSeconds) {
            throw new Error(`VadAdapterOptions: minChunkDurationSeconds (${this.options.minChunkDurationSeconds}) cannot be greater than maxChunkDurationSeconds (${this.options.maxChunkDurationSeconds}).`);
        }

        this._initialize();
    }

    public getTotalSecondsProcessed(): number {
        return this.totalSecondsProcessed;
    }

    private _initialize(): Promise<void> {
        if (this.initializationPromise) { return this.initializationPromise; }
        var VadLogging_log_debug = VadLogging.log.debug;
        VadLogging.log.debug = () => {};

        this.initializationPromise = (async () => {
            this.vad = await RealTimeVAD.new({
                ...this.options,
                onFrameProcessed: (probs: SpeechProbabilities, frame: Float32Array) => {
                    this.vad!.pause();
                    const isSpeech = probs.isSpeech >= this.options.positiveSpeechThreshold;
                    const frameDuration = frame.length / 16000;

                    if (!isSpeech && (this.postfixFrameCounter >= this.options.postfixFramesCount)) { this.prefixCollector.push(frame); }
                    if (this.prefixCollector.length > this.options.prefixFramesCount) { this.prefixCollector.shift(); }

                    if (!isSpeech && (this.speechSegmentCollector.length > 0) && (this.postfixFrameCounter < this.options.postfixFramesCount)) {
                        this.speechSegmentCollector.push(VadAdapter.float32ToPcmS16le(frame));
                        this.collectorDuration += frameDuration;
                        this.postfixFrameCounter++;
                    } else if (isSpeech) { this.postfixFrameCounter = 0; }

                    if (isSpeech && (this.prefixCollector.length > 0)) {
                        const prefixBuffer = Buffer.concat(this.prefixCollector.map(f => VadAdapter.float32ToPcmS16le(f)));
                        this.speechSegmentCollector.push(prefixBuffer);
                        this.collectorDuration += VadAdapter.getPcmDurationInSeconds(prefixBuffer);
                        this.prefixCollector = [];
                    }

                    if (isSpeech) { this.speechSegmentCollector.push(VadAdapter.float32ToPcmS16le(frame)); }
                    if (isSpeech) { this.collectorDuration += frameDuration; }

                    if (this.collectorDuration >= this.options.maxChunkDurationSeconds) { return this._finalize(); }

                    const isSpeechSplit = probs.isSpeech < this.options.posSplitSpeechThreshold;
                    const isPostfixComplete = this.postfixFrameCounter >= this.options.postfixFramesCount;
                    if (isSpeechSplit && isPostfixComplete && (this.collectorDuration >= this.options.minChunkDurationSeconds)) { return this._finalize(); }
                    this.vad!.start();
                },
            });

            VadLogging.log.debug = VadLogging_log_debug;
            this.vad.start();
        })();

        return this.initializationPromise;
    }

    async _push(data: Buffer) {
        if (this.isPaused()) { await new Promise(resolve => this.once('resume', resolve)); }
        var result = this.push(data);
        if (!result) { await new Promise(resolve => this.once('drain', resolve)); }
        if (!result) { this.push(data); }
    }

    async _finalize() {
        this.pendingFinilzied = true;

        if (this.speechSegmentCollector.length > 0) {
            await this._push(Buffer.concat(this.speechSegmentCollector));
        }

        this.speechSegmentCollector = [];
        this.collectorDuration = 0;
        this.vad!.start();
        this._callback();
    }

    private _callback(error?: Error | null) {
        var callback = this.pendingWriteCallback;
        this.pendingWriteCallback = null;
        if (callback) { callback(error); }
    }

    async _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void): Promise<void> {
        await this._initialize();
        if (this.isPaused()) { return this.once('resume', () => this._write(chunk, encoding, callback)) as any; }

        try {
            this.pendingWriteCallback = callback;
            this.pendingFinilzied = false;
            const chunkDuration = VadAdapter.getPcmDurationInSeconds(chunk);
            const float32Chunk = VadAdapter.pcmS16leToFloat32(chunk);
            await this.vad!.processAudio(float32Chunk);
            this.totalSecondsProcessed += chunkDuration;
            this.emit('progress', this.totalSecondsProcessed);
            if (!this.pendingFinilzied) { this._callback(); }
        } catch (error: Error | any) {
            callback(error);
        }
    }

    async _final(callback: (error?: Error | null) => void): Promise<void> {
        try {
            await this._initialize();
            await this.vad!.flush();
            this.vad!.destroy();
            await this._finalize();
            this.push(null);
            callback();
        } catch (error: Error | any) {
            callback(error);
        }
    }

    _read(size: number): void {
    }

    public static getPcmDurationInSeconds(pcmBuffer: Buffer): number {
        const bytesPerSample = 2;
        const totalSamples = pcmBuffer.length / (bytesPerSample * 1);
        return totalSamples / 16000;
    }

    public static pcmS16leToFloat32(buffer: Buffer): Float32Array {
        const float32 = new Float32Array(buffer.length / 2);
        for (let i = 0; i < float32.length; i++) { float32[i] = buffer.readInt16LE(i * 2) / 32768; }
        return float32;
    }

    public static float32ToPcmS16le(float32: Float32Array): Buffer {
        const buffer = Buffer.alloc(float32.length * 2);
        const clamp = (num: number) => Math.max(-32768, Math.min(32767, num));
        for (let i = 0; i < float32.length; i++) { buffer.writeInt16LE(clamp(Math.floor(float32[i] * 32768)), i * 2); }
        return buffer;
    }
}