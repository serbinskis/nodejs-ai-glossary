import config from '../config.js';
import { DatabaseManager } from '../database/manager.js';
import { GlossaryReport } from '../glossary/glossary.js';
import { DefaultRoute } from './default.js';

export class GlossaryRoute extends DefaultRoute {
    async _post(): Promise<{ code: number, message: string, data?: any } | void> {
        const { hashes } = this.req.body;
        if (!Array.isArray(hashes) || hashes.length === 0 || hashes.some(h => typeof h !== 'string')) { return config.ERROR_CODES['400.1']; }
        if (hashes.some(h => !config.HASH_REGEX.test(h))) { return config.ERROR_CODES['400.1']; }
        const allGlossaries: GlossaryReport[] = [];

        for (const hash of hashes) {
            const glossary = await DatabaseManager.getFileGlossary(hash);
            if (!glossary) { return config.ERROR_CODES['404.0']; }
            const { implementation, debug_info, ...safeGlossary } = glossary;
            allGlossaries.push({ ...safeGlossary as GlossaryReport, hash: hash });
        }

        return { ...config.ERROR_CODES['200.0'], data: { glossaries: allGlossaries } };
    }
}