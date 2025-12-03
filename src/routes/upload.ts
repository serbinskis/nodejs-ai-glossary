import * as fsp from 'fs/promises';
import path from 'path';
import sutils from 'serbinskis-utils';
import config from '../config.js';
import { Readable } from 'stream';
import { DefaultRoute } from './default.js';
import { isSupported, ValidationType } from '../supported.js';
import { ContentWorker, CWT_TEXT_GLOSSARY, WMT_EXTRACT_PROGRESS, WMT_GLOSSARY_CHUNK, WMT_GLOSSARY_PROGRESS } from '../worker.js';
import { DatabaseManager } from '../database/manager.js';
import { JobStatus, JobTracker, QueueTracker } from '../tracker.js';
import { StreamPiper } from '../piper.js';

export class UploadRoute extends DefaultRoute {
    async _post(): Promise<{ code: number, message: string, data?: any } | void> {
        //If busboy is not defined, then return error (Usually happens when request does not contain file stream)
        if (!this.req.busboy) { return config.ERROR_CODES['400.0']; }

        //Start file streaming, and resolve file info and stream
        this.req.pipe(this.req.busboy);

        //Resolve file info and stream, file event should be triggered first, and in that case we don't need to wait for finish event
        var { file_stream, file_info } = await new Promise<{ file_stream: Readable, file_info: any }>(resolve => {
            this.req.busboy.once('file', (_: any, file_stream: Readable, file_info: any) => resolve({ file_stream, file_info }));
            this.req.busboy.once('finish', () => resolve({ file_stream: null, file_info: null }));
        });

        //If file stream or file info is not defined, then return error
        if (!file_stream || !file_info) { return config.ERROR_CODES['400.0']; }

        //Fix for unicode filenames
        var filename = Buffer.from(file_info.filename, 'latin1').toString('utf8');

        //Check if filename is valid, and return error if it's not
        if (!filename || !sutils.between(filename.length, 1, config.MAX_FILENAME_LENGTH)) { return config.ERROR_CODES['400.2']; }

        //Add ourself to the queue
        var { id: socketId } = this.getIpId();
        let position = QueueTracker.enqueue(socketId); //Null socket is allowed
        if (!position) { return config.ERROR_CODES['400.4']; } //In case if provided socket is not valid

        this.req.on('close', () => {
            file_stream.destroy();
            console.log(!QueueTracker.inqueue(position));
            if (!QueueTracker.active(position)) { QueueTracker.dequeue(position); }
        }); //TODO: This is problem after uploading it will run, so we have to check if we started proccessing already

        //TODO: QueueTracker.wait(position) -> even if we do file_stream.destroy() this wont trigger dequeue
        //TODO: But this.req.on('close', ()) runs after file fisnished, but we cannot dequeue while proccessing
        //TODO file_stream.isPaused() will be true on first chunk -> { file_stream.pause(); resolve(chunk); });

        //Wait for our turn to upload
        let fileSize = Number(this.req.headers['content-length'] || 0);
        const piper = new StreamPiper(file_stream, fileSize); //This also pauses stream
        if (!await QueueTracker.wait(position)) { return }; //If client disconnected while in queue
        const tempFilePath = path.resolve(config.UPLAOD_DIRECTORY, `${Date.now()}_${Math.random()}.${path.extname(filename)}`);
        if (file_stream.destroyed) { return; }

        const jobId = JobTracker.addJob(filename, JobStatus.UPLOADING); // Immediately add the job to the tracker so that all users get feedback.
        piper.on('progress', (progress) => JobTracker.updateJob(jobId, JobStatus.UPLOADING, progress));

        try {
            const [supportStatus] = isSupported(filename, fileSize, await piper.getHeader());
            if (supportStatus !== ValidationType.IS_SUPPORTED) { file_stream.destroy(); return config.ERROR_CODES['400.3']; }

            await piper.writeFile(tempFilePath);
            JobTracker.updateJob(jobId, JobStatus.UPLOADING, 100);
            const fileHash = await piper.getHash();

            // If the same file hash already exists, we can stop here and return the existing data.
            const existingFile = await DatabaseManager.getFile(fileHash);
            if (existingFile) { return { ...config.ERROR_CODES['200.0'], data: existingFile }; }

            JobTracker.updateJob(jobId, JobStatus.EXTRACTING, 0);
            const worker = new ContentWorker(tempFilePath, CWT_TEXT_GLOSSARY);
            worker.on(WMT_EXTRACT_PROGRESS, (progress: number) => JobTracker.updateJob(jobId, JobStatus.EXTRACTING, progress));
            worker.on(WMT_GLOSSARY_PROGRESS, (progress: number) => JobTracker.updateJob(jobId, JobStatus.PROCESSING, progress));
            worker.once(WMT_GLOSSARY_CHUNK, () => JobTracker.updateJob(jobId, JobStatus.PROCESSING, 0));
            if (config.DEBUG) { worker.on(WMT_GLOSSARY_CHUNK, (chunk) => process.stdout.write(chunk.text)); }
            const { text, glossary, error } = await worker.waitResult();
            if (error) { throw error; }

            fileSize = (await fsp.stat(tempFilePath)).size;
            const newFile = await DatabaseManager.createFile(fileHash, filename, file_info.mimeType, fileSize, text, glossary, this.ip_address);
            return { ...config.ERROR_CODES['200.0'], data: newFile };
        } catch(error) {
            if (error.code === 'ERR_STREAM_PREMATURE_CLOSE') { return; } //this.req.on('close', () => file_stream.destroy());
            throw error;
        } finally {
            if (position !== undefined) { QueueTracker.dequeue(position); }
            await fsp.unlink(tempFilePath).catch(() => {});
            JobTracker.removeJob(jobId);
        }
    }
}