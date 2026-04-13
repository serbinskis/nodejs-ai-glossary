import config from "../../config.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { GoogleGenAI, HarmBlockThreshold, HarmCategory, Model } from "@google/genai";
import { GlossaryEntry, GlossaryGenerator, GlossaryReport } from "../glossary.js";
import { Tokenizer } from "../tokenizer.js";
import { Utils } from "../../utils.js";


export class GeminiGlossary extends GlossaryGenerator {
    private static DEFAULT_MODEL: string = 'gemma-3-27b-it';
    private static DEFAULT_TPM: number = 15_000;
    private static DEFAULT_MAX_TOKENS: number = GeminiGlossary.DEFAULT_TPM - 5_000;
    private static DEFAULT_RATE_LIMIT: number = 60_000 + 1_000;
    private static DEFAULT_TEMPERATURE: number = 0.2;
    private static DEFAULT_PROMPT = 'Your task is to analyze the provided text and create a glossary.\n' +
                                    'Instructions:\n' +
                                    '1. Extract terms, concepts, or acronyms from the text.\n' +
                                    '2. Define them using ONLY the provided text.\n' +
                                    '3. NO external knowledge. Synthesize exclusively from source.\n' +
                                    '4. DO NOT translate. Keep definitions in the source language.\n' +
                                    '5. Return a ONLY JSON list with the following structure:\n' +
                                    '[\n' +
                                    '  {\n' +
                                    '    "term": "Example Term 1",\n' +
                                    '    "definition": "The definition extracted from the text for the first term.",\n' +
                                    '    "language": "The 2-letter language code (ISO 639)."\n' +
                                    '  },\n' +
                                    '  {\n' +
                                    '    "term": "Example Term 2",\n' +
                                    '    "definition": "The definition for the second term.",\n' +
                                    '    "language": "The 2-letter language code (ISO 639)."\n' +
                                    '  }\n' +
                                    ']\n' +
                                    '6. If no terms found, return an empty list.\n\n' +
                                    'Text to analyze:\n';
    private ai: GoogleGenAI;
    private lastPromptTime: number = 0;

    private constructor(ai: GoogleGenAI) {
        super(`Gemini-${GeminiGlossary.DEFAULT_MODEL}`);
        this.ai = ai;
    }

    private async prompt(text: string): Promise<Partial<GlossaryReport> | null> {
        if (this.lastPromptTime + GeminiGlossary.DEFAULT_RATE_LIMIT > Number(new Date())) {
            const waitTime = (this.lastPromptTime + GeminiGlossary.DEFAULT_RATE_LIMIT) - Number(new Date());
            console.debug(`[GeminiGlossary.prompt] -> Rate limit in effect, waiting for ${waitTime} ms`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        const GlossaryEntrySchema = z.object({
            term: z.string().describe("The term, concept, or acronym."),
            definition: z.string().describe("The definition of the term."),
            language: z.string().length(2).describe("The 2-letter language code (ISO 639)."),
        });

        const GlossaryReportSchema = z.object({
            domain: z.string().describe("The domain or subject area."),
            language: z.string().length(2).describe("The 2-letter language code of the source."),
            glossary: z.array(GlossaryEntrySchema).describe("The list of glossary entries."),
        });

        this.lastPromptTime = Number(new Date());
        console.debug(`[GeminiGlossary.prompt] -> input: ${text.slice(GeminiGlossary.DEFAULT_PROMPT.length).replace(/\s+/g, ' ').slice(0, 500)}`);

        const response = await this.ai.models.generateContent({
            model: GeminiGlossary.DEFAULT_MODEL,
            contents: text,
            config: {
                seed: 42,
                temperature: GeminiGlossary.DEFAULT_TEMPERATURE,
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                ]
            },
        });


        try {
            let entryList = z.array(GlossaryEntrySchema).parse(Utils.extractJSON(response?.text));
            return { domain: "", language: "", glossary: entryList as GlossaryEntry[] };
        } catch (e) {
            console.error("[GeminiGlossary.prompt] -> Failed to parse response:", response?.text, e);
            return null;
        }
    }

    public async getModels(): Promise<Model[]> {
        const models = await Utils.fromGenerator(await this.ai.models.list());
        return models.filter(m => m.supportedActions.includes('countTokens') && m.supportedActions.includes('generateContent'));
    }

    public async countTokens(text: string): Promise<number> {
        return (await this.ai.models.countTokens({ model: GeminiGlossary.DEFAULT_MODEL, contents: text })).totalTokens;
    }

    public async createGlossary(text: string): Promise<GlossaryReport> {
        if (!text || text.length === 0) { return this.emptyReport(); }
        const startTime = Number(new Date());
        const allReports: Partial<GlossaryReport>[] = [];

        console.debug(`[GlossaryGenerator.createGlossary] -> input: "${Tokenizer.cleanText(text).slice(0, 100)}...", size: ${text?.length}/${Tokenizer.cleanText(text).length}`);
        const { chunkSize, prompts } = await Tokenizer.preparePrompts(text, GeminiGlossary.DEFAULT_PROMPT, GeminiGlossary.DEFAULT_MAX_TOKENS, async (text) => await this.countTokens(text), 0);
        console.debug(`[GlossaryGenerator.createGlossary] -> chunkSize: ${chunkSize}, prompts.length: ${prompts.length}`);

        for (var i = 0; i < prompts.length; i++) {
            const result = await this.prompt(prompts[i]);
            this.emit('progress', (i+1)/prompts.length*100);
            if (result) { allReports.push(result); }
        }

        this.emit('progress', 100);
        return this.exportReport(allReports, startTime);
    }

    public static async getInstance(): Promise<GeminiGlossary> {
        if (!config.GEMINI_API_KEY) { throw new Error("Missing GEMINI_API_KEY in configuration"); }
        const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
        return new GeminiGlossary(ai);
    }
}