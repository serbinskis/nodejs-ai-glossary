import config from '../config.js';
import { Utils } from '../utils.js';
import { DefaultRoute } from './default.js';
import { isSupported, ValidationType } from '../supported.js';

export class SupportedRoute extends DefaultRoute {
    async _post(): Promise<{ code: number, message: string, data?: any } | void> {
        const { filename, filesize, header } = this.req.body;
        if (!filename || !Utils.between(filename.length, 1, config.MAX_FILENAME_LENGTH)) { return config.ERROR_CODES['400.2']; }
        const headerBuffer = Array.isArray(header) ? Buffer.from(header) : Buffer.alloc(0);
        const [supportStatus] = isSupported(filename, (filesize || 0), headerBuffer);
        return (supportStatus === ValidationType.IS_SUPPORTED) ? config.ERROR_CODES['200.0'] : config.ERROR_CODES['400.3'];
    }
}