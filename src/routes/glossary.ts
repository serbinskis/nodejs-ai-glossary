import config from '../config.js';
import { DatabaseManager } from '../database/manager.js';
import { DefaultRoute } from './default.js';

export class GlossaryRoute extends DefaultRoute {
    async _post(): Promise<{ code: number, message: string, data?: any } | void> {
        const { hashes } = this.req.body; // Validate that 'hashes' is a non-empty array of strings.
        if (!Array.isArray(hashes) || hashes.length === 0 || hashes.some(h => typeof h !== 'string')) { return config.ERROR_CODES['400.1']; }
        if (hashes.some(h => !config.HASH_REGEX.test(h))) { return config.ERROR_CODES['400.1']; }
        const allGlossaries = [];

        for (const hash of hashes) { // Ensure that a valid glossary exists for EVERY hash provided.
            const glossaryJson = await DatabaseManager.getFileGlossary(hash);
            if (!glossaryJson) { return config.ERROR_CODES['404.0']; }
            allGlossaries.push(glossaryJson.glossary);
        }

        const combinedGlossaryTerms = allGlossaries.flat(); // If all checks pass, combine, deduplicate, and return the glossary.
        const uniqueGlossaryTerms = Array.from(new Map(combinedGlossaryTerms.map(item => [item.name, item])).values());
        return Object.assign(config.ERROR_CODES['200.0'], { data: { glossary: uniqueGlossaryTerms } });
    }
}