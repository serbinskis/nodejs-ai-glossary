import config from "../../config.js";
import { GlossaryGenerator, GlossaryReport, ProgressLevel } from "../glossary.js";
import { LLM, LLMPredictionFragment, LLMRespondOpts, LMStudioClient, StructuredPredictionResult } from "@lmstudio/sdk";
import { Tokenizer } from "../tokenizer.js";
import { Utils } from "../../utils.js";
import { cpus } from 'os';
import { z } from "zod";

export class LMStudioGlossary extends GlossaryGenerator {
    protected static MAX_32BIT_INT = 2_147_483_647;
    private static CLASS_NAME = 'LMStudioGlossary';
    private static DEFAULT_MODEL: string = config.LMSTUDIO.DEFAULT_MODEL || 'google/gemma-3-4b';
    private static DEFAULT_PROMPT = 'Your task is to analyze the provided text and create a glossary.\n' +
                                    'Instructions:\n' +
                                    '1. Extract ALL terms and concepts from the text.\n' +
                                    '2. Define them using ONLY the provided text.\n' +
                                    '3. NO external knowledge. Synthesize exclusively from source.\n' +
                                    '4. DO NOT translate. Keep definitions in the source language.\n' +
                                    '5. If no terms found, return an empty list.\n\n' +
                                    'Text to analyze:\n\n';

    private static DEFAULT_STRCUTRED_TOKENS: number = config.LMSTUDIO.DEFAULT_STRCUTRED_TOKENS || 1024;
    private static DEFAULT_CONTEXT: number = config.LMSTUDIO.DEFAULT_CONTEXT || 4096;
    private static DEFAULT_TEMPERATURE: number = config.LMSTUDIO.DEFAULT_TEMPERATURE || 0.5;
    private static DEFAULT_SAFE_MARGIN: number = config.LMSTUDIO.DEFAULT_SAFE_MARGIN || 0.5;
    private static MIN_PROCESS_SIZE: number = config.LMSTUDIO.MIN_PROCESS_SIZE || 100;
    private static PROMPT_CONTEXT: number = LMStudioGlossary.DEFAULT_CONTEXT - LMStudioGlossary.DEFAULT_STRCUTRED_TOKENS;
    private static MAX_RESPONSE_TOKENS: number = config.LMSTUDIO.MAX_RESPONSE_TOKENS || -1;
    private static REPEAT_PENALTY: number = config.LMSTUDIO.REPEAT_PENALTY || -1;
    private static TIMEOUT: number = config.LMSTUDIO.TIMEOUT || 5 * 60 * 1000;
    private static ERROR_RETRY_COUNT: number = config.LMSTUDIO.ERROR_RETRY_COUNT || 0;
    private static DELTA_TEMPERATURE: number = config.LMSTUDIO.DELTA_TEMPERATURE || -0.05;
    private static DELTA_REPEAT_PENALTY: number = config.LMSTUDIO.DELTA_REPEAT_PENALTY || 0.05;
    private static CPU_THREADS: number = config.LMSTUDIO.CPU_THREADS || Math.max(1, cpus().length - 1);
    private static SEED = config.LMSTUDIO.SEED || 42;

    protected modelKey: string;
    protected model: LLM;
    protected client: LMStudioClient;
    protected deffaultPrompt: string;
    protected structuredTokens: number;
    protected contextLength: number;
    protected temperature: number;
    protected safeMargin: number;
    protected minProcessSize: number;
    protected promptContext: number;
    protected maxResponseTokens: number;
    protected repeatPenalty: number;
    protected maxTimeout: number;
    protected retryCount: number;
    protected deltaTemperature: number;
    protected deltaRepeatPenalty: number;
    protected cpuThreads: number;
    protected deduplicate: boolean;
    protected seed: number;

    protected constructor(client: LMStudioClient, model: LLM, modelKey?: string, implementation?: string) {
        super(implementation || `LMStudio-${modelKey || model?.modelKey}`);
        this.deffaultPrompt = (config.LMSTUDIO.DEFAULT_PROMPT !== undefined) ? config.LMSTUDIO.DEFAULT_PROMPT : LMStudioGlossary.DEFAULT_PROMPT;
        this.structuredTokens = (config.LMSTUDIO.DEFAULT_STRCUTRED_TOKENS !== undefined) ? config.LMSTUDIO.DEFAULT_STRCUTRED_TOKENS : LMStudioGlossary.DEFAULT_STRCUTRED_TOKENS;
        this.contextLength = (config.LMSTUDIO.DEFAULT_CONTEXT !== undefined) ? config.LMSTUDIO.DEFAULT_CONTEXT : LMStudioGlossary.DEFAULT_CONTEXT;
        this.temperature = (config.LMSTUDIO.DEFAULT_TEMPERATURE !== undefined) ? config.LMSTUDIO.DEFAULT_TEMPERATURE : LMStudioGlossary.DEFAULT_TEMPERATURE;
        this.safeMargin = (config.LMSTUDIO.DEFAULT_SAFE_MARGIN !== undefined) ? config.LMSTUDIO.DEFAULT_SAFE_MARGIN : LMStudioGlossary.DEFAULT_SAFE_MARGIN;
        this.minProcessSize = (config.LMSTUDIO.MIN_PROCESS_SIZE !== undefined) ? config.LMSTUDIO.MIN_PROCESS_SIZE : LMStudioGlossary.MIN_PROCESS_SIZE;
        this.promptContext = this.contextLength - this.structuredTokens;
        this.maxResponseTokens = (config.LMSTUDIO.MAX_RESPONSE_TOKENS !== undefined) ? config.LMSTUDIO.MAX_RESPONSE_TOKENS : LMStudioGlossary.MAX_RESPONSE_TOKENS;
        this.repeatPenalty = (config.LMSTUDIO.REPEAT_PENALTY !== undefined) ? config.LMSTUDIO.REPEAT_PENALTY : LMStudioGlossary.REPEAT_PENALTY;
        this.maxTimeout = (config.LMSTUDIO.TIMEOUT !== undefined) ? config.LMSTUDIO.TIMEOUT : LMStudioGlossary.TIMEOUT;
        this.retryCount = (config.LMSTUDIO.ERROR_RETRY_COUNT !== undefined) ? config.LMSTUDIO.ERROR_RETRY_COUNT : LMStudioGlossary.ERROR_RETRY_COUNT;
        this.deltaTemperature = (config.LMSTUDIO.DELTA_TEMPERATURE !== undefined) ? config.LMSTUDIO.DELTA_TEMPERATURE : LMStudioGlossary.DELTA_TEMPERATURE;
        this.deltaRepeatPenalty = (config.LMSTUDIO.DELTA_REPEAT_PENALTY !== undefined) ? config.LMSTUDIO.DELTA_REPEAT_PENALTY : LMStudioGlossary.DELTA_REPEAT_PENALTY;
        this.cpuThreads = (config.LMSTUDIO.CPU_THREADS !== undefined) ? config.LMSTUDIO.CPU_THREADS : LMStudioGlossary.CPU_THREADS;
        this.deduplicate = (config.LMSTUDIO.DEDUPLICATE !== undefined) ? config.LMSTUDIO.DEDUPLICATE : true;
        this.seed = (config.LMSTUDIO.SEED !== undefined) ? config.LMSTUDIO.SEED : LMStudioGlossary.SEED;
        this.modelKey = modelKey || model?.modelKey;
        this.model = model;
        this.client = client;
    }

    protected async prompt(text: string): Promise<Partial<GlossaryReport> | null> {
        if (config.DEBUG) { console.debug(`[LMStudioGlossary.prompt] -> input: ${text.slice(this.deffaultPrompt.length).replace(/\s+/g, ' ').slice(0, 500)}`); }

        const glossaryEntrySchema = z.object({
            term: z.string().describe("The term or concept."),
            definition: z.string().describe("The definition of the term."),
            sentence: z.string().describe("A sentence from the source text that contains the term and definition."),
            language: z.string().regex(/^[a-z]{2}$/, "Language code must be 2 lowercase letters (e.g., 'en', 'lv').").describe("The 2-letter language code (ISO 639) of the definition."),
        });

        const glossaryReportSchema = z.object({
            domain: z.string().describe("The domain or subject area of the glossary summarized in a few words."),
            glossary: z.array(glossaryEntrySchema).describe("The list of glossary entries, the list also may be empty if no terms were found."),
        });

        let predictCallbacks: ((fragment: LLMPredictionFragment) => void)[] = [];
        let onPredictionFragment: ((fragment: LLMPredictionFragment) => void) = (fragment: LLMPredictionFragment) => predictCallbacks.forEach(callback => callback(fragment));
        if (config.DEBUG) { predictCallbacks.push((fragment: LLMPredictionFragment) => { process.stdout.write(fragment.content); }); }
        let opts: LLMRespondOpts = { structured: glossaryReportSchema, temperature: this.temperature, contextOverflowPolicy: 'stopAtLimit', cpuThreads: this.cpuThreads, onPredictionFragment };
        if (this.maxResponseTokens > 0) { opts.maxTokens = this.maxResponseTokens; }
        if (this.repeatPenalty > 0) { opts.repeatPenalty = this.repeatPenalty; }
        let result: StructuredPredictionResult | null = null;

        for (let attempt = 0; attempt <= this.retryCount; attempt++) {
            let content = '';
            let totalTokenOutput: number = 0;
            predictCallbacks.push((fragment: LLMPredictionFragment) => {
                content += fragment.content;
                if (!(this.maxResponseTokens > 0)) { return; }
                totalTokenOutput += fragment.tokensCount || 0;
                let chunkProgress = (1 / this.totalChunks) * 90;
                let currentStart = 10 + (this.currentChunk / this.totalChunks) * 90;
                let responseProgress = Math.min((totalTokenOutput / this.maxResponseTokens) * 100, 100);
                let promptProgress = (attempt == 0) ? (responseProgress * 0.5) : (0.5 + (responseProgress * 0.5 * (attempt / this.retryCount)));
                let overallProgress = currentStart + (chunkProgress * (promptProgress / 100));
                this.setProgress(overallProgress, ProgressLevel.PROMPTING);
            });

            let seed = this.seed + (attempt * Math.floor(Math.random() * 999999));
            opts.temperature = Utils.clamp(this.temperature + (attempt * this.deltaTemperature), 0, 2);
            if (this.repeatPenalty > 0) { opts.repeatPenalty = Utils.clamp(this.repeatPenalty + (attempt * this.deltaRepeatPenalty), 1, 1.5); }
            if (config.DEBUG) { console.log(`[LMStudioGlossary.prompt] -> Attempt ${attempt + 1} of ${this.retryCount + 1}, seed: ${seed}, temperature: ${opts.temperature}, repeatPenalty: ${opts.repeatPenalty}`); }
            if (attempt > 0) { this.retry_error_count++; }
            await this.reloadModel((p) => this.setProgress(p * 10, ProgressLevel.LOADING_MODEL), seed);
            let response = this.model.respond(text, opts);
            let timeout = setTimeout(async () => await response.cancel(), Math.min(this.maxTimeout, LMStudioGlossary.MAX_32BIT_INT));

            try { result = await response as StructuredPredictionResult; } catch (e: any) { console.error("[LMStudioGlossary.createGlossary] -> Error during LM response:", e); }
            clearTimeout(timeout);
            predictCallbacks.pop();
            if (result?.parsed) { break; } else if (content) { this.addError(content); }
        }

        if (result && !result?.parsed) { console.error(`[${LMStudioGlossary.CLASS_NAME}.createGlossary] -> Failed to parse LM response:`, (result as any)?.text); }
        if (config.DEBUG && result) { console.dir(result?.parsed || null, { depth: null }); }
        return result?.parsed ? result.parsed : null;
    }

    protected async countTokens(text: string): Promise<number> {
        return await this.model.countTokens(text);
    }

    public async createGlossary(text: string): Promise<GlossaryReport> {
        if (!text || (text.length === 0)) { return this.emptyReport(); }
        const startTime = Number(new Date());
        const allReports: Partial<GlossaryReport>[] = [];

        if (config.DEBUG) { console.debug(`[${LMStudioGlossary.CLASS_NAME}.createGlossary] -> input: "${Tokenizer.cleanText(text).slice(0, 100)}...", size: ${text?.length}/${Tokenizer.cleanText(text).length}`); }
        const tokenizer = async (input: string) => await this.countTokens(input);
        const { chunkSize, prompts } = await Tokenizer.preparePrompts(text, this.deffaultPrompt, this.promptContext, tokenizer, this.safeMargin);
        if (config.DEBUG) { console.debug(`[${LMStudioGlossary.CLASS_NAME}.createGlossary] -> chunkSize: ${chunkSize}, prompts.length: ${prompts.length}`); }

        for (var i = 0; i < prompts.length; i++) {
            let result: Partial<GlossaryReport> | null = null;
            let isTooSmall = prompts[i].length - prompts.length < this.minProcessSize;
            this.setProgressInfo(i, prompts.length);
            if (!isTooSmall) { result = await this.prompt(prompts[i]); }
            this.setProgress(10 + ((i + 1) / prompts.length) * 90, ProgressLevel.CHUNKING);
            if (!isTooSmall && !result) { this.error_count++; }
            allReports.push(result ? result : this.emptyReport())
        }

        await this.free();
        this.setProgress(100, ProgressLevel.CHUNKING);
        let debugInfo = { chunkSize: chunkSize, chunkCount: prompts.length, contextLength: this.contextLength, temperature: this.temperature, seed: this.seed, prompt: this.deffaultPrompt, elapsedTime: (Number(new Date()) - startTime) / 1000 };
        debugInfo = Object.assign(debugInfo, { safeMargin: this.safeMargin, maxResponseTokens: this.maxResponseTokens, maxTimeout: this.maxTimeout, repeatPenalty: this.repeatPenalty, inputSize: text.length, retryCount: this.retryCount, deltaTemperature: this.deltaTemperature, deltaRepeatPenalty: this.deltaRepeatPenalty });
        return this.exportReport(allReports, startTime, debugInfo, this.deduplicate);
    }

    private async reloadModel(progress?: (percentage: number) => void, seed?: number): Promise<void> {
        await this.model.unload();
        seed = (seed !== undefined) ? seed : this.seed;
        let instance = await LMStudioGlossary.getInstance(progress, this.modelKey, seed);
        this.model = instance.model;
        if (progress) { progress(1); }
    }

    protected async free(): Promise<void> {
        await this.model.unload();
    }

    public static async getInstance(progress?: (percentage: number) => void, modelKey?: string, seed?: number): Promise<LMStudioGlossary> {
        modelKey = modelKey || config.LMSTUDIO.DEFAULT_MODEL || LMStudioGlossary.DEFAULT_MODEL;
        seed = (seed !== undefined) ? seed : config.LMSTUDIO.SEED || LMStudioGlossary.SEED;
        let contextLength = config.LMSTUDIO.DEFAULT_CONTEXT || LMStudioGlossary.DEFAULT_CONTEXT;
        let timeout = config.LMSTUDIO.TIMEOUT || LMStudioGlossary.TIMEOUT;

        let model: LLM | null = null;
        const client = new LMStudioClient();
        const identifier = `glossary-${process.pid}-${Date.now()}-${Math.floor(Math.random()*10000)}-${modelKey}`;
        let models = (await client.llm.listLoaded()).filter(m => !m.identifier.startsWith(`glossary-${process.pid}-`));
        await Promise.all(models.map(async (m) => { try { await client.llm.unload(m.identifier); } catch (e) {} }));

        while (!model) {
            try {
                model = await client.llm.load(modelKey, {
                    verbose: config.DEBUG, identifier: identifier, ttl: Math.floor(timeout * 2 / 1000),
                    config: { contextLength: contextLength, seed: seed, flashAttention: config.LMSTUDIO.FLASH_ATTENTION, },
                    onProgress: progress || (() => {}),
                });
            } catch (e) {
                console.error(`[${LMStudioGlossary.CLASS_NAME}.getInstance] -> Failed to load model "${modelKey}", Retrying.. in 5 seconds. Details:`, e);
                await Utils.wait(5000);
            }
        }

        return new LMStudioGlossary(client, model, modelKey);
    }
}