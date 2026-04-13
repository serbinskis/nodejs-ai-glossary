import * as fsp from 'fs/promises';
import path from 'path';
import config from '../config.js';
import { Utils } from '../utils.js';
import { Readable } from 'stream';
import { DefaultRoute } from './default.js';
import { isSupported, ValidationType } from '../supported.js';
import { ContentWorker, CWT_TEXT_GLOSSARY, WMT_EXTRACT_PROGRESS, WMT_GLOSSARY_CHUNK, WMT_GLOSSARY_PROGRESS } from '../worker.js';
import { DatabaseManager } from '../database/manager.js'
import { GlossaryReport } from '../glossary/glossary.js';;
import { JobStatus, JobTracker, QueueTracker } from '../tracker.js';
import { StreamPiper } from '../piper.js';

export class UploadRoute extends DefaultRoute {
    async _post(): Promise<{ code: number, message: string, data?: any } | void> {

        var { id: socketId } = this.getIpId();
        let position: string | null = QueueTracker.enqueue(socketId);
        if (!position) { return config.ERROR_CODES['400.4']; }

        let dequeue = () => QueueTracker.dequeue(position);
        this.req.on('close', dequeue);
        let interval = setInterval(() => this.heartbeat(), 500);

        if (config.DEBUG) { console.log(`[DEBUG] QUEUE WAITING 1 -> QueueTracker.inqueue(${position}): ${QueueTracker.inqueue(position)}`); }
        let queue_success = await QueueTracker.wait(position);
        this.req.off('close', dequeue);
        clearInterval(interval);
        if (config.DEBUG) { console.log(`[DEBUG] QUEUE WAITING 2 -> QueueTracker.inqueue(${position}): ${QueueTracker.inqueue(position)}, queue_success: ${queue_success}`); }
        if (!queue_success) { return config.ERROR_CODES['444.0']; };


        if (!this.req.busboy) { dequeue(); return config.ERROR_CODES['400.0']; }

        this.req.pipe(this.req.busboy);

        var { file_stream, file_info } = await new Promise<{ file_stream: Readable | null, file_info: any }>(resolve => {
            this.req.busboy.once('file', (_: any, file_stream: Readable, file_info: any) => resolve({ file_stream, file_info }));
            this.req.busboy.once('finish', () => resolve({ file_stream: null, file_info: null }));
        });

        if (!file_stream || !file_info) { dequeue(); return config.ERROR_CODES['400.0']; }

        let filename = Buffer.from(file_info.filename, 'latin1').toString('utf8');

        let fileSize = Math.max(1, (Number(this.req.headers['content-length']) - 1024*20) || 0);

        if (!filename || !Utils.between(filename.length, 1, config.MAX_FILENAME_LENGTH)) { dequeue(); return config.ERROR_CODES['400.2']; }

        const piper = new StreamPiper(file_stream, fileSize);
        this.req.once('close', () => { console.debug(`[DEBUG] FILE UPLOAD 0 -> REQ CLOSED`); piper.destroy(); });

        const [supportStatus] = isSupported(filename, fileSize, await piper.getHeader());
        if (config.DEBUG) { console.log(`[DEBUG] FILE UPLOAD 1 -> supportStatus: ${supportStatus}, filename: ${filename}, fileSize: ${fileSize}, header: (${(await piper.getHeader()).subarray(0, 16).toString('ascii').replace(/[^\x20-\x7E]/g, '')})`); }
        if (supportStatus !== ValidationType.IS_SUPPORTED) { piper.destroy(); }
        if (supportStatus !== ValidationType.IS_SUPPORTED) { dequeue(); return config.ERROR_CODES['400.3']; }

        const jobId = JobTracker.addJob(filename, JobStatus.UPLOADING, piper.getProgress());
        piper.on('progress', (progress) => JobTracker.updateJob(jobId, JobStatus.UPLOADING, progress));
        const tempFilePath = path.resolve(config.UPLAOD_DIRECTORY, `${Date.now()}_${Math.random()}.${path.extname(filename)}`);

        let cleanup = () => { dequeue(); JobTracker.removeJob(jobId); fsp.unlink(tempFilePath).catch(() => {}); }

        let write_success = await piper.writeFile(tempFilePath);
        if (config.DEBUG) { console.log(`[DEBUG] FILE UPLOAD 2 -> write_success: ${write_success}, QueueTracker.inqueue(${position}): ${QueueTracker.inqueue(position)}`); }
        if (!write_success) { cleanup(); return config.ERROR_CODES['444.0']; }
        JobTracker.updateJob(jobId, JobStatus.UPLOADING, 100);
        const fileHash = await piper.getHash();


        const existingFile = await DatabaseManager.getFile(fileHash);
        if (existingFile) { cleanup(); return { ...config.ERROR_CODES['200.0'], data: existingFile }; }

        JobTracker.updateJob(jobId, JobStatus.EXTRACTING, 0);
        const worker = new ContentWorker(tempFilePath, CWT_TEXT_GLOSSARY);
        worker.once(WMT_GLOSSARY_CHUNK, () => JobTracker.updateJob(jobId, JobStatus.PROCESSING, 0));
        worker.on(WMT_EXTRACT_PROGRESS, (progress: number) => JobTracker.updateJob(jobId, JobStatus.EXTRACTING, progress));
        worker.on(WMT_GLOSSARY_PROGRESS, (progress: number) => JobTracker.updateJob(jobId, JobStatus.PROCESSING, progress));
        const { text, glossary, error } = await worker.waitResult() as { text: string, glossary: GlossaryReport, error?: Error };
        if (error) { cleanup(); return config.ERROR_CODES['500.0']; }

        fileSize = (await fsp.stat(tempFilePath)).size;
        const newFile = await DatabaseManager.createFile(fileHash, filename, file_info.mimeType, fileSize, text, glossary, this.ip_address);
        cleanup();
        return { ...config.ERROR_CODES['200.0'], data: newFile };
    }
}