import config from "../../config.js";
import { GlossaryGenerator, GlossaryReport } from "../glossary.js";
import { LLM, LLMPredictionFragment, LLMRespondOpts, LMStudioClient, StructuredPredictionResult } from "@lmstudio/sdk";
import { Tokenizer } from "../tokenizer.js";
import { Utils } from "../../utils.js";
import { cpus } from 'os';
import { z } from "zod";

export class LMStudioGlossary extends GlossaryGenerator {
    private static MAX_32BIT_INT = 2_147_483_647;
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
    private static CPU_THREADS: number = config.LMSTUDIO.CPU_THREADS || Math.max(1, cpus().length - 1);
    private static SEED = config.LMSTUDIO.SEED || 42;

    private modelKey: string;
    private model: LLM;
    private client: LMStudioClient;
    private deffaultPrompt: string;
    private structuredTokens: number;
    private contextLength: number;
    private temperature: number;
    private safeMargin: number;
    private minProcessSize: number;
    private promptContext: number;
    private maxResponseTokens: number;
    private repeatPenalty: number;
    private maxTimeout: number;
    private retryCount: number;
    private cpuThreads: number;
    private seed: number;

    private constructor(client: LMStudioClient, model: LLM, modelKey?: string) {
        super(`LMStudio-${modelKey || model.modelKey}`);
        this.deffaultPrompt = config.LMSTUDIO.DEFAULT_PROMPT || LMStudioGlossary.DEFAULT_PROMPT;
        this.structuredTokens = config.LMSTUDIO.DEFAULT_STRCUTRED_TOKENS || LMStudioGlossary.DEFAULT_STRCUTRED_TOKENS;
        this.contextLength = config.LMSTUDIO.DEFAULT_CONTEXT || LMStudioGlossary.DEFAULT_CONTEXT;
        this.temperature = config.LMSTUDIO.DEFAULT_TEMPERATURE || LMStudioGlossary.DEFAULT_TEMPERATURE;
        this.safeMargin = config.LMSTUDIO.DEFAULT_SAFE_MARGIN || LMStudioGlossary.DEFAULT_SAFE_MARGIN;
        this.minProcessSize = config.LMSTUDIO.MIN_PROCESS_SIZE || LMStudioGlossary.MIN_PROCESS_SIZE;
        this.promptContext = this.contextLength - this.structuredTokens;
        this.maxResponseTokens = config.LMSTUDIO.MAX_RESPONSE_TOKENS || LMStudioGlossary.MAX_RESPONSE_TOKENS;
        this.repeatPenalty = config.LMSTUDIO.REPEAT_PENALTY || LMStudioGlossary.REPEAT_PENALTY;
        this.maxTimeout = config.LMSTUDIO.TIMEOUT || LMStudioGlossary.TIMEOUT;
        this.retryCount = config.LMSTUDIO.ERROR_RETRY_COUNT || LMStudioGlossary.ERROR_RETRY_COUNT;
        this.cpuThreads = config.LMSTUDIO.CPU_THREADS || LMStudioGlossary.CPU_THREADS;
        this.seed = config.LMSTUDIO.SEED || LMStudioGlossary.SEED;
        this.modelKey = modelKey || model.modelKey;
        this.model = model;
        this.client = client;
    }

    private async prompt(text: string): Promise<Partial<GlossaryReport> | null> {
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

        let onPredictionFragment: ((fragment: LLMPredictionFragment) => void) | undefined = undefined;
        if (config.DEBUG) { onPredictionFragment = (fragment: LLMPredictionFragment) => { process.stdout.write(fragment.content); }; }
        let opts: LLMRespondOpts = { structured: glossaryReportSchema, temperature: this.temperature, contextOverflowPolicy: 'stopAtLimit', cpuThreads: this.cpuThreads, onPredictionFragment };
        if (this.maxResponseTokens > 0) { opts.maxTokens = this.maxResponseTokens; }
        if (this.repeatPenalty > 0) { opts.repeatPenalty = this.repeatPenalty; }
        let result: StructuredPredictionResult | null = null;

        for (let attempt = 0; attempt <= this.retryCount; attempt++) {
            let seed = this.seed + (attempt * Math.floor(Math.random() * 999999));
            opts.temperature = Math.min(this.temperature + (attempt * 0.1), 2);
            if (this.repeatPenalty > 0) { opts.repeatPenalty = Math.min(this.repeatPenalty + (attempt * 0.05), 1.5); }
            if (config.DEBUG) { console.log(`[LMStudioGlossary.prompt] -> Attempt ${attempt + 1} of ${this.retryCount + 1}, seed: ${seed}, temperature: ${opts.temperature}`); }
            if (attempt > 0) { this.retryCount++; }
            await this.reloadModel((p) => this.setProgress(p * 10), seed);
            let response = this.model.respond(text, opts);
            let interval = setInterval(async () => await response.cancel(), Math.min(this.maxTimeout, LMStudioGlossary.MAX_32BIT_INT));

            try { result = await response as StructuredPredictionResult; } catch (e) { console.error("[LMStudioGlossary.createGlossary] -> Error during LM response:", e); }
            clearInterval(interval);
            if (result?.parsed) { break; }
        }

        if (result && !result?.parsed) { console.error("[LMStudioGlossary.createGlossary] -> Failed to parse LM response:", (result as any)?.text); }
        if (config.DEBUG && result) { console.dir(result?.parsed || null, { depth: null }); }
        return result?.parsed ? result.parsed : null;
    }

    public async createGlossary(text: string): Promise<GlossaryReport> {
        if (!text || (text.length === 0)) { return this.emptyReport(); }
        const startTime = Number(new Date());
        const allReports: Partial<GlossaryReport>[] = [];

        if (config.DEBUG) { console.debug(`[LMStudioGlossary.createGlossary] -> input: "${Tokenizer.cleanText(text).slice(0, 100)}...", size: ${text?.length}/${Tokenizer.cleanText(text).length}`); }
        const tokenizer = async (input: string) => await this.model.countTokens(input);
        const { chunkSize, prompts } = await Tokenizer.preparePrompts(text, this.deffaultPrompt, this.promptContext, tokenizer, this.safeMargin);
        if (config.DEBUG) { console.debug(`[LMStudioGlossary.createGlossary] -> chunkSize: ${chunkSize}, prompts.length: ${prompts.length}`); }

        for (var i = 0; i < prompts.length; i++) {
            let result: Partial<GlossaryReport> | null = null;
            let isTooSmall = prompts[i].length - prompts.length < this.minProcessSize;
            if (!isTooSmall) { result = await this.prompt(prompts[i]); }
            this.setProgress(10 + ((i + 1) / prompts.length) * 90);
            if (!isTooSmall && !result) { this.error_count++; }
            allReports.push(result ? result : this.emptyReport())
        }

        this.setProgress(100);
        let debugInfo = { chunkSize: chunkSize, chunkCount: prompts.length, contextLength: this.contextLength, temperature: this.temperature, seed: this.seed, prompt: this.deffaultPrompt, elapsedTime: (Number(new Date()) - startTime) / 1000 };
        debugInfo = Object.assign(debugInfo, { safeMargin: this.safeMargin, maxResponseTokens: this.maxResponseTokens, maxTimeout: this.maxTimeout, repeatPenalty: this.repeatPenalty, inputSize: text.length });
        return this.exportReport(allReports, startTime, debugInfo, config.LMSTUDIO.DEDUPLICATE);
    }

    public async reloadModel(progress?: (percentage: number) => void, seed?: number): Promise<void> {
        await this.model.unload();
        seed = (seed !== undefined) ? seed : this.seed;
        let instance = await LMStudioGlossary.getInstance(progress, this.modelKey, seed);
        this.model = instance.model;
        if (progress) { progress(1); }
    }

    public async free(): Promise<void> {
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
                console.error(`[LMStudioGlossary.getInstance] -> Failed to load model "${modelKey}", Retrying.. in 5 seconds. Details:`, e);
                await Utils.wait(5000);
            }
        }

        return new LMStudioGlossary(client, model, modelKey);
    }
}