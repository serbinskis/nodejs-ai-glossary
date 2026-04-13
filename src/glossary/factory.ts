import { GlossaryGenerator } from './glossary.js';
import { GeminiGlossary } from './models/gemini.js';
import { LlamaGlossary } from './models/llama.js';
import { LMStudioGlossary } from './models/lmstudio.js';
import { LMStudioGlossaryV2 } from './models/lmstudioV2.js';
import { OpenAIGlossary } from './models/openai.js';

export type GeneratorType = 'lmstudio' | 'lmstudioV2' | 'llama' | 'gemini' | 'openai';

export class GlossaryFactory {
    private static DEFAULT_GENERATOR: GeneratorType = 'lmstudio';

    public static async getInstance(type: GeneratorType = GlossaryFactory.DEFAULT_GENERATOR): Promise<GlossaryGenerator> {
        switch (type) {
            case 'lmstudio': return await LMStudioGlossary.getInstance();
            case 'lmstudioV2': return await LMStudioGlossaryV2.getInstance();
            case 'llama': return await LlamaGlossary.getInstance();
            case 'gemini': return await GeminiGlossary.getInstance();
            case 'openai': return await OpenAIGlossary.getInstance();
            default: throw new Error(`Unknown generator type: '${type}'`);
        }
    }

    public static getDefaultGenerator(): GeneratorType {
        return GlossaryFactory.DEFAULT_GENERATOR;
    }
}