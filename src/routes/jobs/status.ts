import config from '../../config.js';
import { JobTracker } from '../../tracker.js';
import { UploadRoute } from '../upload.js';

export class JobsStatusRoute extends UploadRoute {
    async _get(): Promise<{ code: number, message: string, data?: any } | void> {
        return { ...config.ERROR_CODES['200.0'], data: JobTracker.getJobs() };
    }
}