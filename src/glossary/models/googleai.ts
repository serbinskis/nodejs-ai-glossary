import config from "../../config.js";
import { z } from "zod";
import { GenerateContentResponse, GoogleGenAI, HarmBlockThreshold, HarmCategory, Model } from "@google/genai";
import { GlossaryReport, ProgressLevel } from "../glossary.js";
import { Utils } from "../../utils.js";
import { LMStudioGlossary } from "./lmstudio.js";
import { zodToJsonSchema } from "zod-to-json-schema";


export class GoogleAIGlossary extends LMStudioGlossary {
    private lastPromptTime: number = 0;
    private ai: GoogleGenAI;

    protected constructor(ai: GoogleGenAI) {
        super(null as any, null as any, null as any, `GoogleAI-${config.GOOGLE_STUDIO.DEFAULT_MODEL}`);
        this.safeMargin = 0;
        this.modelKey = config.GOOGLE_STUDIO.DEFAULT_MODEL;
        this.deffaultPrompt = config.GOOGLE_STUDIO.DEFAULT_PROMPT;
        this.contextLength = config.GOOGLE_STUDIO.DEFAULT_CONTEXT;
        this.promptContext = this.contextLength - this.structuredTokens;
        this.temperature = config.GOOGLE_STUDIO.DEFAULT_TEMPERATURE;
        this.repeatPenalty = config.GOOGLE_STUDIO.REPEAT_PENALTY;
        this.minProcessSize = config.GOOGLE_STUDIO.MIN_PROCESS_SIZE;
        this.maxTimeout = config.GOOGLE_STUDIO.TIMEOUT;
        this.deduplicate = config.GOOGLE_STUDIO.DEDUPLICATE;
        this.seed = config.GOOGLE_STUDIO.SEED;
        this.ai = ai;
    }

    protected async prompt(text: string): Promise<Partial<GlossaryReport> | null> {
        if (this.lastPromptTime + config.GOOGLE_STUDIO.RATE_LIMIT_TIMEOUT > Number(new Date())) {
            const waitTime = (this.lastPromptTime + config.GOOGLE_STUDIO.RATE_LIMIT_TIMEOUT) - Number(new Date());
            console.debug(`[GoogleAIGlossary.prompt] -> Rate limit in effect, waiting for ${waitTime} ms`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

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

        if (config.DEBUG) { console.log(`[GoogleAIGlossary.prompt] -> input: ${text.slice(this.deffaultPrompt.length).replace(/\s+/g, ' ').slice(0, 500)}`); }
        const totalTime = Math.min(this.maxTimeout, LMStudioGlossary.MAX_32BIT_INT);
        const currentStart = 10 + (this.currentChunk / this.totalChunks) * 90;
        const currentEnd = 10 + (this.currentChunk + 1 / this.totalChunks) * 90;
        const additionalProgress = (currentEnd - currentStart) / Math.ceil(totalTime / 1000);
        const controller = new AbortController();
        const timeout = setTimeout(async () => await controller.abort(), totalTime);
        const timer = setInterval(() => this.setProgress(this.progress + additionalProgress, ProgressLevel.PROMPTING), 1000);
        let response: GenerateContentResponse = null as any;

        const cleanup = () => {
            clearTimeout(timeout);
            clearInterval(timer);
            this.lastPromptTime = Number(new Date());
        }

        try {
            response = await this.ai.models.generateContent({
                model: this.modelKey,
                contents: text,
                config: {
                    seed: this.seed,
                    temperature: this.temperature,
                    responseMimeType: "application/json",
                    responseJsonSchema: zodToJsonSchema(glossaryReportSchema),
                    abortSignal: controller.signal,
                    safetySettings: [
                        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    ]
                },
            });
        } catch (e: any) {
            cleanup();
            console.error("[GoogleAIGlossary.prompt] -> Error during LLM response:", e);
            try { var json = JSON.parse(e?.message); } catch (e) {};
            if ((json?.error?.code == 503) && (json?.error?.status == "UNAVAILABLE")) { await new Promise(resolve => setTimeout(resolve, config.GOOGLE_STUDIO.RATE_LIMIT_TIMEOUT)); }
            if ((json?.error?.code == 503) && (json?.error?.status == "UNAVAILABLE")) { return await this.prompt(text); }
            if ((json?.error?.code == 429) && (json?.error?.status == "RESOURCE_EXHAUSTED")) { await new Promise(resolve => setTimeout(resolve, 10 * 60 * 1000)); }
            if ((json?.error?.code == 429) && (json?.error?.status == "RESOURCE_EXHAUSTED")) { return await this.prompt(text); }
        }

        try {
            cleanup();
            if (!response?.text) { console.debug("[GoogleAIGlossary.prompt] -> output: null"); return null; }
            const reportEntry = glossaryReportSchema.parse(JSON.parse(response.text!)) as Partial<GlossaryReport>;
            if (config.DEBUG) { console.debug(`[GoogleAIGlossary.prompt] -> output: ${JSON.stringify(reportEntry, null, 2)}`); }
            return reportEntry;
        } catch (e: any) {
            console.error("[GoogleAIGlossary.prompt] -> Failed to parse response:", response?.text, e);
            this.addError(String(response?.text));
            return null;
        }
    }

    public async getModels(): Promise<Model[]> {
        const models = await Utils.fromGenerator(await this.ai.models.list());
        return models.filter(m => m.supportedActions!.includes('countTokens') && m.supportedActions!.includes('generateContent'));
    }

    public async countTokens(text: string): Promise<number> {
        return (await this.ai.models.countTokens({ model: this.modelKey, contents: text })).totalTokens!;
    }

    protected async free(): Promise<void> {
    }

    public static async getInstance(): Promise<GoogleAIGlossary> {
        if (!config.GOOGLE_STUDIO.API_KEY) { throw new Error("Missing GOOGLE_STUDIO.API_KEY in configuration"); }
        const ai = new GoogleGenAI({ apiKey: config.GOOGLE_STUDIO.API_KEY });
        return new GoogleAIGlossary(ai);
    }
}