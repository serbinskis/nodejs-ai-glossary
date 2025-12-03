import config from '../config.js';
import { QueueTracker } from '../tracker.js';
import { UploadRoute } from './upload.js';

export class QueueStatusRoute extends UploadRoute {
    async _get(): Promise<{ code: number, message: string, data?: any } | void> {
        var { id: socketId } = this.getIpId();
        return { ...config.ERROR_CODES['200.0'], data: QueueTracker.getQueueState(socketId) };
    }

    async _post(): Promise<{ code: number, message: string, data?: any } | void> {}
}