import fs from "fs";
import path from "path";
import config from "../config.js";
import { Utils } from "../utils.js";
import { LMStudioClient } from "@lmstudio/sdk";
import { LMStudioGlossary } from "../glossary/models/lmstudio.js";
import { GoogleAIGlossary } from "../glossary/models/googleai.js";
import { ProgressLevel } from "../glossary/glossary.js";
import { Tokenizer } from "../glossary/tokenizer.js";
import { getProcessor } from "../supported.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";

function setDefaults() {
        config.LMSTUDIO.DEFAULT_CONTEXT = 4096;
        config.LMSTUDIO.DEFAULT_SAFE_MARGIN = 0.5;
        config.LMSTUDIO.DEFAULT_TEMPERATURE = 0.5;
        config.LMSTUDIO.DELTA_TEMPERATURE = -0.05;
        config.LMSTUDIO.REPEAT_PENALTY = -1;
        config.LMSTUDIO.DELTA_REPEAT_PENALTY = 0.05;
        config.LMSTUDIO.ERROR_RETRY_COUNT = 0;
        config.LMSTUDIO.FLASH_ATTENTION = true;
        config.LMSTUDIO.DEDUPLICATE = true;
        config.LMSTUDIO.MAX_RESPONSE_TOKENS = config.LMSTUDIO.DEFAULT_CONTEXT * config.LMSTUDIO.DEFAULT_SAFE_MARGIN * 2;
        config.LMSTUDIO.TIMEOUT = 9999 * 60 * 1000;
        config.LMSTUDIO.SEED = 42;

        config.GOOGLE_STUDIO.DEFAULT_CONTEXT = config.LMSTUDIO.DEFAULT_CONTEXT * (1 - config.LMSTUDIO.DEFAULT_SAFE_MARGIN);
        config.GOOGLE_STUDIO.DEFAULT_TEMPERATURE = config.LMSTUDIO.DEFAULT_TEMPERATURE;
        config.GOOGLE_STUDIO.RATE_LIMIT_TIMEOUT = 1000;
        config.GOOGLE_STUDIO.TIMEOUT = 30 * 60 * 1000;
        config.GOOGLE_STUDIO.DEDUPLICATE = config.LMSTUDIO.DEDUPLICATE;
        config.GOOGLE_STUDIO.SEED = config.LMSTUDIO.SEED;
}

async function getLLMModels(): Promise<{ modelKey: string, entries: any[], quantization: any, params: number }[]> {
    const client = new LMStudioClient();
    const models = await client.system.listDownloadedModels();
    const mkeys = [...new Set(models.map(m => m.modelKey))];

    const formatted = mkeys.map(mkey => {
        let filtered = models.filter(m => m.modelKey == mkey);
        filtered = filtered.filter(m => m.type == 'llm' && m.format == 'gguf' && m.maxContextLength >= 4096);
        filtered = filtered.filter(m => parseFloat(m.paramsString!.match(/\d+(\.\d+)?/)![0]) <= 70 && m.quantization!.bits == 4);
        return { modelKey: mkey, entries: filtered, quantization: filtered[0]?.quantization, params: parseFloat(filtered[0]?.paramsString!.match(/\d+(\.\d+)?/)![0]) };
    }).filter(f => f.entries.length > 0).sort((a, b) => a.params - b.params);

    return formatted;
}

async function getInputText(filename: string): Promise<string> {
    const inputf = path.join(config.EXPERIMENTS_DIRECTORY, "exper1", "input", filename);
    const text = await getProcessor(inputf)?.extractText() as string;
    const cleaned = Tokenizer.cleanText(text);
    console.log(`Input text length: ${text?.length} characters [${cleaned.slice(0, 100)}...]`);
    return text;
}

async function runExperiment1(filename: string) {
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

    const jsonSchema = zodToJsonSchema(glossaryReportSchema, "GlossaryReport");
    console.log(JSON.stringify(jsonSchema, null, 2));

    const fixPunctuation = String.prototype.fixPunctuation;
    const models = await getLLMModels();
    const text = await getInputText(filename);
    setDefaults();

    for (let i = 0; i < models.length; i++) {

        let model = `${models[i].modelKey}@${models[i].entries[0].quantization.name}`;
        let outputf = path.join(config.EXPERIMENTS_DIRECTORY, "exper1", "output", `${filename}-${model.replace(/\//g, '_')}.json`);
        if (fs.existsSync(outputf)) { console.log(`[EXP1] Output (${path.basename(outputf)}) for model "${model}" already exists, skipping...`); continue; }

        let glossary = await LMStudioGlossary.getInstance((p) => console.log(`Loading "${model}" ${p}%`), model);
        glossary.on('progress', (p: number, level: ProgressLevel) => { if (level != ProgressLevel.PROMPTING) console.log(`Processing with "${model}" ${p}% (${level})`); });
        String.prototype.fixPunctuation = function () { return this.toString(); }
        let result = await glossary.createGlossary(text);
        String.prototype.fixPunctuation = fixPunctuation;

        console.dir(result, { depth: null });
        console.log(`Finished processing with "${model}", extracted ${result.glossary.length} terms.`);
        fs.writeFileSync(outputf, JSON.stringify(result, null, 2));
    }
}

async function runExperiment2(filename: string) {
    const models = await getLLMModels();
    const text = await getInputText(filename);
    const allowed = ["qwen/qwen3-vl-4b", "google/gemma-2-9b", "google/gemma-2-27b", "google/gemma-3-27b", "google/gemma-4-e4b", "google/gemma-3n-e4b", "google/gemma-3-12b", "mistralai/mistral-nemo-instruct-2407"];
    const filtered = models.filter(m => allowed.includes(m.modelKey));

    const runSubExperiment = async (modelKey: string, taskName: string, description: string) => {
        let outputf = path.join(config.EXPERIMENTS_DIRECTORY, "exper2", "output", taskName, `${filename}-${modelKey.replace(/\//g, '_')}#${description}.json`);
        if (fs.existsSync(outputf)) { console.log(`[EXP2] Output (${path.basename(outputf)}) for model "${modelKey}" already exists, skipping...`); return; }
        let glossary = await LMStudioGlossary.getInstance((p) => console.log(`Loading "${modelKey}" ${p}%`), modelKey);
        glossary.on('progress', (p: number, level: ProgressLevel) => { if (level != ProgressLevel.PROMPTING) console.log(`Processing with "${modelKey}" ${p}% (${level})`); });
        let result = await glossary.createGlossary(text);

        console.dir(result, { depth: null });
        console.log(`Finished processing with "${modelKey}", extracted ${result.glossary.length} terms.`);
        fs.mkdirSync(path.dirname(outputf), { recursive: true });
        fs.writeFileSync(outputf, JSON.stringify(result, null, 2));
    };

    for (let i = 0; i < filtered.length; i++) {
        for (let temp of [0.01, 0.25, 0.5, 0.75, 1.0]) {
            setDefaults();
            config.LMSTUDIO.DEFAULT_TEMPERATURE = temp;
            let model = `${filtered[i].modelKey}@${filtered[i].entries[0].quantization.name}`;
            await runSubExperiment(model, "temperature", `temp_${temp}`);
        }

        for (let rp of [1.0, 1.1, 1.2, 1.3, 1.4, 1.5]) {
            setDefaults();
            config.LMSTUDIO.REPEAT_PENALTY = rp;
            let model = `${filtered[i].modelKey}@${filtered[i].entries[0].quantization.name}`;
            await runSubExperiment(model, "repeat_penalty", `rp_${rp}`);
        }

        for (let window of [2048, 4096, 8192]) {
            setDefaults();
            config.LMSTUDIO.DEFAULT_CONTEXT = window;
            config.LMSTUDIO.MAX_RESPONSE_TOKENS = config.LMSTUDIO.DEFAULT_CONTEXT * config.LMSTUDIO.DEFAULT_SAFE_MARGIN * 2;
            let model = `${filtered[i].modelKey}@${filtered[i].entries[0].quantization.name}`;
            await runSubExperiment(model, "context_window", `ctx_window_${window}`);
        }

        for (let margin of [0.25, 0.5, 0.75]) {
            setDefaults();
            config.LMSTUDIO.DEFAULT_SAFE_MARGIN = margin;
            config.LMSTUDIO.MAX_RESPONSE_TOKENS = config.LMSTUDIO.DEFAULT_CONTEXT * config.LMSTUDIO.DEFAULT_SAFE_MARGIN * 2;
            let model = `${filtered[i].modelKey}@${filtered[i].entries[0].quantization.name}`;
            await runSubExperiment(model, "safe_margin", `sf_margin_${margin}`);
        }

        for (let quant of ["Q4_K_M", "Q6_K", "Q8_0"]) {
            if (filtered[i].modelKey == "google/gemma-3-27b") { continue; }
            setDefaults();
            let model = `${filtered[i].modelKey}@${quant}`;
            await runSubExperiment(model, "quantization", `quant_${quant}`);
        }

        let custom_exp: string[][] = [];
        custom_exp.push(['0.01',  '0.05', '1.10', '4096', '0.500', '2']);
        custom_exp.push(['0.01',  '0.05', '1.10', '8192', '0.625', '2']);
        custom_exp.push(['0.25', '-0.05', '1.15', '8192', '0.625', '2']);

        for (const exp of custom_exp) {
            setDefaults();
            config.LMSTUDIO.DEFAULT_TEMPERATURE = parseFloat(exp[0]);
            config.LMSTUDIO.DELTA_TEMPERATURE = parseFloat(exp[1]);
            config.LMSTUDIO.REPEAT_PENALTY = parseFloat(exp[2]);
            config.LMSTUDIO.DEFAULT_CONTEXT = parseInt(exp[3]);
            config.LMSTUDIO.DEFAULT_SAFE_MARGIN = parseFloat(exp[4]);
            config.LMSTUDIO.ERROR_RETRY_COUNT = parseInt(exp[5]);
            config.LMSTUDIO.MAX_RESPONSE_TOKENS = config.LMSTUDIO.DEFAULT_CONTEXT * config.LMSTUDIO.DEFAULT_SAFE_MARGIN * 2;
            let model = `${filtered[i].modelKey}@${filtered[i].entries[0].quantization.name}`;
            let description = `custom_t${exp[0].replace('.', '')}_rp${exp[2].replace('.', '')}_ctx${exp[3]}_sf${exp[4].replace('.', '')}_rc${exp[5]}`;
            await runSubExperiment(model, "custom", description);
        }
    }
}

async function runExperiment3(filename: string) {
    const fixPunctuation = String.prototype.fixPunctuation;
    const text = await getInputText(filename);
    await Utils.wait(filename.startsWith("LAT") ? 0 : 1 * 1000);


    let models = ["gemini-flash-latest",    "gemini-flash-lite-latest",      "gemini-pro-latest",
                  "gemini-3-flash-preview", "gemini-3.1-flash-lite-preview", "gemini-3.1-pro-preview",
                  "gemini-2.5-flash",       "gemini-2.5-flash-lite",         "gemini-2.5-pro"];

    await Promise.all(models.map(async (model, idx) => {
        await Utils.wait(1000 + idx * 2000);
        setDefaults();
        config.GOOGLE_STUDIO.DEFAULT_MODEL = model;

        let outputf = path.join(config.EXPERIMENTS_DIRECTORY, "exper3", "output", `${filename}-${model.replace(/\//g, '_')}.json`);
        if (fs.existsSync(outputf)) { return console.log(`[EXP3] Output (${path.basename(outputf)}) for model "${model}" already exists, skipping...`); }
        fs.mkdirSync(path.dirname(outputf), { recursive: true });

        let glossary = await GoogleAIGlossary.getInstance();
        glossary.on('progress', (p: number, level: ProgressLevel) => { if (level != ProgressLevel.PROMPTING) console.log(`Processing with "${model}" ${p}% (${level})`); });
        String.prototype.fixPunctuation = function () { return this.toString(); }
        let result = await glossary.createGlossary(text);
        String.prototype.fixPunctuation = fixPunctuation;

        console.dir(result, { depth: null });
        console.log(`Finished processing with "${model}", extracted ${result.glossary.length} terms.`);
        fs.writeFileSync(outputf, JSON.stringify(result, null, 2));
    }));
}

(async () => {
    console.log(`[NodeJS] ${process.version}`);
    await runExperiment1("ENG_konspekts.docx");
    await runExperiment1("LAT_konspekts.docx");
    await runExperiment2("LAT_konspekts.docx");
    await Promise.all([runExperiment3("LAT_konspekts.docx"), runExperiment3("ENG_konspekts.docx")]);
    process.exit(0);
})();