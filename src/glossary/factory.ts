import config from '../config.js';
import { GlossaryGenerator } from './glossary.js';
import { GoogleAIGlossary } from './models/googleai.js';
import { LlamaGlossary } from './models/llama.js';
import { LMStudioGlossary } from './models/lmstudio.js';
import { LMStudioGlossaryV2 } from './models/lmstudioV2.js';
import { OpenAIGlossary } from './models/openai.js';

export type GlossaryGeneratorType = 'lmstudio' | 'lmstudioV2' | 'llama' | 'googleai' | 'openai';

export class GlossaryFactory {
    private static DEFAULT_GENERATOR: GlossaryGeneratorType = config.DEFAULT_GLOSSARY_GENERATOR;

    public static async getInstance(type: GlossaryGeneratorType = GlossaryFactory.DEFAULT_GENERATOR): Promise<GlossaryGenerator> {
        switch (type) {
            case 'lmstudio': return await LMStudioGlossary.getInstance();
            case 'lmstudioV2': return await LMStudioGlossaryV2.getInstance();
            case 'llama': return await LlamaGlossary.getInstance();
            case 'googleai': return await GoogleAIGlossary.getInstance();
            case 'openai': return await OpenAIGlossary.getInstance();
            default: throw new Error(`Unknown generator type: '${type}'`);
        }
    }

    public static getDefaultGenerator(): GlossaryGeneratorType {
        return GlossaryFactory.DEFAULT_GENERATOR;
    }
}