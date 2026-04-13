import config from "../../config.js";
import { z } from "zod";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { GlossaryGenerator, GlossaryReport } from "../glossary.js";
import { Tokenizer } from "../tokenizer.js";


export class OpenAIGlossary extends GlossaryGenerator {
    private static DEFAULT_MODEL: string = 'gpt-4o-mini';
    private static DEFAULT_TPM: number = 30_000;
    private static DEFAULT_MAX_TOKENS: number = OpenAIGlossary.DEFAULT_TPM - 5_000;
    private static DEFAULT_RATE_LIMIT: number = 1000;
    private static DEFAULT_TEMPERATURE: number = 0.2;
    private static SYSTEM_PROMPT = 'Your task is to analyze the provided text and create a glossary.\n' +
                                    'Instructions:\n' +
                                    '1. Extract terms, concepts, or acronyms from the text.\n' +
                                    '2. Define them using ONLY the provided text.\n' +
                                    '3. NO external knowledge. Synthesize exclusively from source.\n' +
                                    '4. DO NOT translate. Keep definitions in the source language.\n' +
                                    '5. If no terms found, return an empty list.';

    private ai: OpenAI;
    private lastPromptTime: number = 0;

    private constructor(ai: OpenAI) {
        super(`OpenAI-${OpenAIGlossary.DEFAULT_MODEL}`);
        this.ai = ai;
    }

    private async prompt(text: string): Promise<Partial<GlossaryReport> | null> {
        if (this.lastPromptTime + OpenAIGlossary.DEFAULT_RATE_LIMIT > Number(new Date())) {
            const waitTime = (this.lastPromptTime + OpenAIGlossary.DEFAULT_RATE_LIMIT) - Number(new Date());
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        const GlossaryEntrySchema = z.object({
            term: z.string().describe("The term, concept, or acronym."),
            definition: z.string().describe("The definition of the term."),
            language: z.string().length(2).describe("The 2-letter language code (ISO 639)."),
        });

        const GlossaryReportSchema = z.object({
            domain: z.string().describe("The domain or subject area."),
            glossary: z.array(GlossaryEntrySchema).describe("The list of glossary entries."),
        });

        this.lastPromptTime = Number(new Date());
        console.debug(`[OpenAIGlossary.prompt] -> input length: ${text.length}`);

        try {
            const completion = await this.ai.chat.completions.create({
                model: OpenAIGlossary.DEFAULT_MODEL,
                messages: [
                    { role: "system", content: OpenAIGlossary.SYSTEM_PROMPT },
                    { role: "user", content: `Text to analyze:\n${text}` }
                ],
                response_format: zodResponseFormat(GlossaryReportSchema, "glossary_report"),
                temperature: OpenAIGlossary.DEFAULT_TEMPERATURE,
                seed: 42,
            });

            const content = completion.choices[0].message.content;
            if (!content) { return null; }
            return JSON.parse(content) as Partial<GlossaryReport>;
        } catch (e) {
            console.error("[OpenAIGlossary.prompt] -> API Error:", e);
            return null;
        }
    }

    public async getModels(): Promise<any[]> {
        try {
            const list = await this.ai.models.list();
            return list.data;
        } catch (e) {
            return [];
        }
    }

    public async countTokens(text: string): Promise<number> {
        return await Tokenizer.countTokens(text);
    }

    public async createGlossary(text: string): Promise<GlossaryReport> {
        if (!text || text.length === 0) { return this.emptyReport(); }
        const startTime = Number(new Date());
        const allReports: Partial<GlossaryReport>[] = [];

        console.debug(`[OpenAIGlossary.createGlossary] -> input size: ${text.length}`);
        const { chunkSize, prompts } = await Tokenizer.preparePrompts(text, OpenAIGlossary.SYSTEM_PROMPT, OpenAIGlossary.DEFAULT_MAX_TOKENS,  async (t) => await this.countTokens(t), 0);
        console.debug(`[OpenAIGlossary.createGlossary] -> chunks: ${prompts.length}`);

        for (var i = 0; i < prompts.length; i++) {
            const result = await this.prompt(prompts[i]);
            this.emit('progress', (i + 1) / prompts.length * 100);
            if (result) { allReports.push(result); }
        }

        this.emit('progress', 100);
        return this.exportReport(allReports, startTime);
    }

    public static async getInstance(): Promise<OpenAIGlossary> {
        if (!config.OPENAI_API_KEY) { throw new Error("Missing OPENAI_API_KEY in configuration"); }
        const ai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
        return new OpenAIGlossary(ai);
    }
}