import config from "../../config.js";
import { z } from "zod";
import { GlossaryEntry, GlossaryGenerator, GlossaryReport } from "../glossary.js";
import { LLM, LLMPredictionFragment, LMStudioClient } from "@lmstudio/sdk";
import { Tokenizer } from "../tokenizer.js";
import { Utils } from "../../utils.js";

export class LMStudioGlossaryV2 extends GlossaryGenerator {
    private static DEFAULT_MODEL: string = 'mistralai/ministral-3-3b';
    private static DEFAULT_PROMPT =  'Your task is to analyze the sentence and create a glossary by identifying important terms, concepts, and acronyms based ONLY on the text provided below.\n\n' +
                                     'Instructions:\n' +
                                     '1. CRITICAL RULE: DO NOT translate any text.\n' +
                                     '2. Identify and extract terms, concepts, or acronyms directly from the sentence.\n' +
                                     '3. For each term, write a definition by summarizing and rephrasing the information found ONLY within the provided sentence. Your goal is to make the definition clear and concise.\n' +
                                     '4. CRITICAL RULE: You are strictly forbidden from using any external knowledge. All definitions must be synthesized exclusively from the information present in the text.\n' +
                                     '5. If the text contains no identifiable terms, you MUST return a glossary with an empty list.\n\n' +
                                     'Sentence to analyze:\n\n';
    private static DEFAULT_CONTEXT: number = 4096;
    private model: LLM;

    private constructor(model: LLM) {
        super(`LMStudioV2-${model.modelKey}`);
        this.model = model;
    }

    public async createGlossary(text: string): Promise<GlossaryReport> {
        if (!text || text.length === 0) { return { uid: crypto.randomUUID(), domain: '', language: '', implementation: `LMStudio-${this.model.modelKey}`, timestamp_start: Number(new Date()), timestamp_end: Number(new Date()), glossary: [] }; }
        const startTime = Number(new Date());

        const glossaryEntriesSchema = z.array(z.object({
            term: z.string().describe("The term, concept, or acronym."),
            definition: z.string().describe("The definition of the term."),
            language: z.string().regex(/^[a-z]{2}$/, "Language code must be 2 lowercase letters.").describe("The 2-letter language code (ISO 639) of the definition."),
        })).describe("The list of glossary entries, the list also may be empty if no terms were found.");

        const allEntrires: z.infer<typeof glossaryEntriesSchema>[] = [];
        const sentences = Tokenizer.chunkIntoSentences(text, 1536);

        for (var i = 0; i < sentences.length; i++) {
            console.debug(`[LMStudioGlossaryV2.promt] -> [${i+1}/${sentences.length}] input: ${sentences[i].slice(0, 500)}`);
            let response = this.model.respond(`${LMStudioGlossaryV2.DEFAULT_PROMPT}${sentences[i]}`, { structured: glossaryEntriesSchema, temperature: 0 });
            let interval = setInterval(async () => await response.cancel(), 5*60*1000);
            try { var result = await response; } catch (e) { console.error("[LMStudioGlossaryV2.createGlossary] -> Error during LM response:", e); continue; }
            clearInterval(interval);
            if (!(result as any)?.parsed) { console.error("[LMStudioGlossaryV2.createGlossary] -> Failed to parse LM response:", (result as any)?.text); continue; }
            this.emit('progress', (i+1)/sentences.length*100);
            if (config.DEBUG && (result as any).parsed) { console.dir(result.parsed, { depth: null }); }
            if ((result as any).parsed) { allEntrires.push((result as any).parsed); }
        }

        const uniqueGlossary = Array.from(new Map(allEntrires.flat().map((item) => [item.term.toLowerCase(), item])).values());

        const finalReport: GlossaryReport = {
            uid: crypto.randomUUID(),
            domain: 'unknown',
            language: Utils.mostCommonBy(uniqueGlossary, entry => entry.language) ?? 'unknown',
            implementation: this.implementation,
            timestamp_start: startTime,
            timestamp_end: Number(new Date()),
            glossary: uniqueGlossary.map(entry => ({ ...entry, generated: false, uid: crypto.randomUUID() })) as GlossaryEntry[],
        };

        this.emit('progress', 100);
        return finalReport;
    }

    public static async getInstance(): Promise<LMStudioGlossaryV2> {
        const client = new LMStudioClient();
        const identifier = `glossary-${process.pid}-${Date.now()}-${Math.floor(Math.random()*10000)}-${LMStudioGlossaryV2.DEFAULT_MODEL}`;
        let models = (await client.llm.listLoaded()).filter(m => !m.identifier.startsWith(`glossary-${process.pid}-`));
        await Promise.all(models.map(async (m) => { try { await client.llm.unload(m.identifier); } catch (e) {} }));

        const model = await client.llm.load(LMStudioGlossaryV2.DEFAULT_MODEL, {
            verbose: config.DEBUG, identifier: identifier,
            config: { contextLength: LMStudioGlossaryV2.DEFAULT_CONTEXT, seed: 0, flashAttention: true },
        });

        return new LMStudioGlossaryV2(model);
    }
}