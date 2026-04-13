import * as socketio from 'socket.io';
import { OrderedQueue } from './queue.js';
import config from './config.js';
import path from 'path';

export enum JobStatus {
    QUEUED = 'Queued',
    UPLOADING = 'Uploading',
    EXTRACTING = 'Extracting',
    PROCESSING = 'Processing',
    FAILED = 'Failed',
}

export interface TrackedJob {
    id: string;
    filename: string;
    masked: string;
    status: JobStatus;
    progress: number;
    message?: string;
}

export interface QueuedItem {
    id: string;
    socketId?: string;
    position: number;
}

export interface QueueState {
    queue: QueuedItem[];
    activeCount: number;
    waitingCount: number;
    activePosition?: Number
    waitingPosition?: number;
}

class JobTrackerController {
    private io: socketio.Server | null = null;
    private jobs: Map<string, TrackedJob> = new Map();

    public setIoServer(io: socketio.Server): void {
        this.io = io;
    }

    public addJob(filename: string, status: JobStatus, progress: number = 0, message?: string): string {
        const id = crypto.randomUUID();
        const masked = crypto.randomUUID().replaceAll('-', '');
        const job: TrackedJob = { id, filename, masked, status, progress, message };
        this.jobs.set(id, job);
        console.log(`[JOB TRACKER] -> added id: ${id}, status: ${status}, progress: 0, message: ${message}`);
        this.broadcastUpdates();
        return id;
    }

    public updateJob(id: string, status: JobStatus, progress: number, message?: string): void {
        const job = this.jobs.get(id);
        if (!job) { return; }

        const newProgress = Math.min(100, Math.max(0, progress));
        const statusChanged = job.status !== status;
        const messageChanged = message && job.message !== message;
        const progressChangedSignificantly = (newProgress - job.progress) > 0.5;
        if (!statusChanged && !messageChanged && !progressChangedSignificantly) { return; }

        job.status = status;
        job.progress = newProgress;
        if (message) { job.message = message; }

        this.jobs.set(id, job);
        if (config.DEBUG) { console.log(`[JOB TRACKER] -> updated id: ${id}, status: ${status}, progress: ${progress}, message: ${message}, filename: ${job.filename}, masked: ${job.masked}`); }
        this.broadcastUpdates();
    }

    public removeJob(id: string): void {
        if (this.jobs.has(id)) {
            const job = this.jobs.get(id);
            this.jobs.delete(id);
            console.log(`[JOB TRACKER] -> removed id: ${id}, filename: ${job?.filename}, masked: ${job?.masked}`);
            this.broadcastUpdates();
        }
    }

    public getJobs(mask: boolean = true): TrackedJob[] {
        return Array.from(this.jobs.values()).map(job => {
            const parsed = path.parse(job.filename);
            const filename = mask ? (job.masked + parsed.ext) : job.filename;
            return { ...job, filename };
        });
    }

    private broadcastUpdates(): void {
        if (!this.io) { return; }
        this.io.emit('tracker-update', this.getJobs());
    }
}

class QueueTrackerController extends OrderedQueue {
    private io: socketio.Server | null = null;
    private socketIdMap: Map<string, string> = new Map();
    private reverseMap: Map<string, Set<string>> = new Map();

    public setIoServer(io: socketio.Server): void {
        this.io = io;
    }

    public enqueue(socketId?: string): string | null {
        if (socketId && !Array.from(this.getSockets()).some(socket => socket.socketId === socketId)) { return null; }

        const id = super.enqueue() as string;
        if (socketId) { this.socketIdMap.set(id, socketId); }
        if (socketId && !this.reverseMap.has(socketId)) { this.reverseMap.set(socketId, new Set()); }
        if (socketId) { this.reverseMap.get(socketId)!.add(id); }
        console.log(`[QUEUE TRACKER] -> enqueue -> id: ${id}, socketId: ${socketId}, ${this.size()}/${this.max()} (MAX)`);
        this.broadcastUpdates();
        return id;
    }

    public dequeue(id: string): boolean {
        if (!super.dequeue(id)) { return false; }
        const socketId = this.socketIdMap.get(id);

        if (socketId) {
            const userIds = this.reverseMap.get(socketId);
            if (userIds) { userIds.delete(id); }
            if (userIds?.size === 0) { this.reverseMap.delete(socketId); }
        }

        this.socketIdMap.delete(id);
        console.log(`[QUEUE TRACKER] -> dequeue -> id: ${id}, socketId: ${socketId}, ${this.size()}/${this.max()} (MAX)`);
        this.broadcastUpdates();
        return true;
    }

    public getQueueState(socketId?: string): QueueState {
        const fullQueue: QueuedItem[] = super.getQueue().map((id, idx) => {
            let position = idx >= super.max() ? (idx - super.max() + 1) : (idx - super.max());
            return { id, socketId: (this.socketIdMap.get(id) ?? ""), position }
        });

        const activeCount = Math.min(fullQueue.length, super.max());
        const waitingCount = Math.max(0, fullQueue.length - activeCount);

        let activePosition = fullQueue.find(item => (item.socketId === socketId) && (item.position < 0))?.position || 0;
        let waitingPosition = fullQueue.find(item => (item.socketId === socketId) && (item.position > 0))?.position || 0;

        fullQueue.forEach(item => { if (item.socketId !== socketId) { delete item.socketId }});

        return { queue: fullQueue, activeCount, waitingCount, activePosition, waitingPosition }
    }

    public getSockets(): { socketId: string, emit: any }[] {
        return this.io.sockets.sockets.values();
    }

    private broadcastUpdates(): void {
        for (const socket of this.getSockets()) {
            if (!this.reverseMap.has(socket.socketId)) { continue; }
            socket.emit("queue-update", this.getQueueState(socket.socketId));
        }
    }
}

export const JobTracker = new JobTrackerController();
export const QueueTracker = new QueueTrackerController(config.WORKER_COUNT);