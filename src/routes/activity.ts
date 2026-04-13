import config from '../config.js';
import { DatabaseManager } from '../database/manager.js';
import { DefaultRoute } from './default.js';

export class GlossaryActivity extends DefaultRoute {
    async _post(): Promise<{ code: number, message: string, data?: any } | void> {
        let { hashes, glossary_hash, entry_uid, event, data } = this.req.body;
        if (!Array.isArray(hashes) || hashes.length === 0 || hashes.some(h => typeof h !== 'string')) { return config.ERROR_CODES['400.1']; }
        if (hashes.some(h => !config.HASH_REGEX.test(h))) { return config.ERROR_CODES['400.1']; }

        data = data ? String(data).trim() : '';
        let success = await DatabaseManager.validateActivityEntry(hashes.join(';'), glossary_hash, entry_uid, event, data, this.ip_address);
        return success ? config.ERROR_CODES['200.0'] : config.ERROR_CODES['400.0'];
    }
}