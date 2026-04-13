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
import { ContentWorker } from './worker.js';
import { UploadRoute } from './routes/upload.js';
import { GlossaryRoute } from './routes/glossary.js';
import { JobTracker, QueueTracker } from './tracker.js';
import { QueueStatusRoute } from './routes/queue/status.js';
import { CommandHandler } from './commands.js';
import { GlossaryFactory } from './glossary/factory.js';
import { GlossaryActivity } from './routes/activity.js';
import { SupportedRoute } from './routes/supported.js';
import { JobsStatusRoute } from './routes/jobs/status.js';

const app = express();
app.use(busboy());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('website', { index: false }));
const io = new socketio.Server({ maxHttpBufferSize: 100*1024 });

process.title = 'Glossary Extractor';
process.on('message', (message: any) => { if (message.command == 'SIGINT') { process.emit('SIGINT'); } });
process.on('SIGINT', () => { process.exit(); });
(console as any)._log = console.log;

console.log = (...args: any[]) => {
    const time = new Date().toLocaleString('sv-SE');
    const unsafe = String(args[0]).split(/\r\n?|\n/).map(line => `[${time}] ${line}`).join('\n');
    (console as any)._log(...((typeof args[0] === 'string') ? ((args[0] = unsafe), args) : args));
};

console.debug = (...args: any[]) => {
    if (config.DEBUG) { console.log(...args); }
};

(async () => {
    while (!await sutils.isOnline()) { await sutils.Wait(1000); }
    console.log(`[NodeJS] ${process.version}`);

    console.log(`[FACTORY] -> Using default glossary generator: "${GlossaryFactory.getDefaultGenerator()}"`);
    await DatabaseManager.init();
    await WhisperStream.setupWhisper(config.WHISER_OPTIONS.modelName);
    await ContentWorker.createWorkers();
    JobTracker.setIoServer(io);
    QueueTracker.setIoServer(io);

    scheduleJob({ hour: 6, minute: 0, date: 1 }, async () => {
        await DatabaseManager.vacuum();
    });

    process.addListener('message', ((message: { command: string, input?: string }) => {
        if (message.command != 'CMD') { return; }
        CommandHandler.onCommand(message.input || '', message.input?.split(/\s+/) || []);
    }) as NodeJS.MessageListener);

    try { await fsp.rm(config.UPLAOD_DIRECTORY, { recursive: true }); } catch (e: any) { if (e?.code != 'ENOENT') { console.log(`[RMDIR] -> ${e?.message}`); } }
    try { await fsp.mkdir(config.UPLAOD_DIRECTORY, { recursive: true }); } catch (e: any) { throw e; }

    let httpsOptions = {
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

    app.get('/', (_: any, res: any) => res.sendFile(`${config.SOURCE_DIRECTORY}/website/index.html`));
    app.route('/queue/status/*').get((req: any, res: any, done: any) => new QueueStatusRoute(req, res, done).get());
    app.route('/jobs/status/*').get((req: any, res: any, done: any) => new JobsStatusRoute(req, res, done).get());
    app.route('/supported/').post((req: any, res: any, done: any) => new SupportedRoute(req, res, done).post());
    app.route('/upload/*').post((req: any, res: any, done: any) => new UploadRoute(req, res, done).post());
    app.route('/glossary').post((req: any, res: any, done: any) => new GlossaryRoute(req, res, done).post());
    app.route('/activity').post((req: any, res: any, done: any) => new GlossaryActivity(req, res, done).post());

    io.sockets.on('connection', (socket: any) => {
        socket.socketId = crypto.randomUUID();
        socket.emit('unique-id', socket.socketId);
        socket.emit('tracker-update', JobTracker.getJobs());
    });
})();