import fs from 'fs';
import * as fsp from 'fs/promises';
import http from 'http';
import https from 'https';
import express from 'express';
import * as socketio from 'socket.io';
import bodyParser from 'body-parser';
import sutils from 'serbinskis-utils';
import busboy from 'connect-busboy';
import config from './config.js';
import { scheduleJob } from 'node-schedule';
import { DatabaseManager } from './database/manager.js'
import { WhisperStream } from './whisper/whisper.js';
import { ContentWorker, CWT_EXTRACT_TEXT } from './worker.js';
import { UploadRoute } from './routes/upload.js';
import { GlossaryRoute } from './routes/glossary.js';
import { JobTracker, QueueTracker } from './tracker.js';
import { QueueStatusRoute } from './routes/queue_status.js';
import path from 'path';
import { CommandHandler } from './commands.js';
import { runVadTests } from './tests/vad_test.js';

const app = express();
app.use(busboy());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('website', { index: false }));
const io = new socketio.Server({ maxHttpBufferSize: 1024*1024 });

process.title = 'Glossary Extractor';
process.on('message', (message: any) => { if (message.command == 'SIGINT') { process.emit('SIGINT'); } });
process.on('SIGINT', () => { process.exit(); });
(console as any)._log = console.log;

console.log = (...args: any[]) => {
    if (typeof args[0] === 'string') {
        args[0] = args[0].split(/\r\n?|\n/).map(line => `[${sutils.getTimeString()}]: ${line}`).join('\n');
    }

    (console as any)._log(...args);
};

console.debug = (...args: any[]) => {
    if (config.DEBUG) { console.log(...args); }
};

(async () => {
    await runVadTests();
    return;

    while (!await sutils.isOnline()) { await sutils.Wait(1000); }
    await DatabaseManager.init();
    await WhisperStream.setupWhisper(config.WHISER_OPTIONS.modelName);
    await ContentWorker.createWorkers();
    JobTracker.setIoServer(io);
    QueueTracker.setIoServer(io);

    scheduleJob({ hour: 6, minute: 0, date: 1 }, async () => {
        await DatabaseManager.vacuum();
    });

    process.addListener('message', (message: { command: string, input?: string }) => {
        if (message.command != 'CMD') { return; }
        CommandHandler.onCommand(message.input, message.input.split(/\s+/));
    });

    try { await fsp.rm(config.UPLAOD_DIRECTORY, { recursive: true }); } catch (e) { console.log(`[RMDIR] -> ${e.message}`); }
    try { await fsp.mkdir(config.UPLAOD_DIRECTORY, { recursive: true }); } catch (e) { throw e; }

    var httpsOptions = { //We dont care it data is null
        cert: await new Promise((resolve) => fs.readFile('./../../-(CERTIFICATE)-/certificate.crt', (err, data) => resolve(data))) as Buffer,
        ca: await new Promise((resolve) => fs.readFile('./../../-(CERTIFICATE)-/ca_bundle.crt', (err, data) => resolve(data))) as Buffer,
        key: await new Promise((resolve) => fs.readFile('./../../-(CERTIFICATE)-/private.key', (err, data) => resolve(data))) as Buffer,
    }

    if (Object.values(httpsOptions).some(e => !e)) { console.log('[HTTPS WARNING] A certificate was not provided.'); }

    io.attach(http.createServer(app).listen(config.HTTP_PORT, (process.env.DEBUG ? sutils.IPV4Address() : null), () => {
        console.log(`Listening on ${sutils.IPV4Address()}:${config.HTTP_PORT} (HTTP)`);
    }));

    io.attach(https.createServer(httpsOptions, app).listen(config.HTTPS_PORT, (process.env.DEBUG ? sutils.IPV4Address() : null), () => {
        console.log(`Listening on ${sutils.IPV4Address()}:${config.HTTPS_PORT} (HTTPS)`);
    }));

    app.get('/', (_, res) => res.sendFile(`${config.SOURCE_DIRECTORY}/website/index.html`)); //TODO: Relocate website location
    app.route('/queue/status/*').get((req, res, done) => new QueueStatusRoute(req, res, done).get());
    app.route('/upload/*').post((req, res, done) => new UploadRoute(req, res, done).post());
    app.route('/glossary').post((req, res, done) => new GlossaryRoute(req, res, done).post());

    io.sockets.on('connection', (socket) => {
        socket.socketId = crypto.randomUUID();
        socket.emit('unique-id', socket.socketId);
        socket.emit('tracker-update', JobTracker.getJobs());
    });
})();