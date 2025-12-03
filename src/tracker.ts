import * as socketio from 'socket.io';
import { OrderedQueue } from './queue.js';
import config from './config.js';

// Define the possible statuses a job can have
export enum JobStatus {
    QUEUED = 'Queued',
    UPLOADING = 'Uploading',
    EXTRACTING = 'Extracting',
    PROCESSING = 'Processing',
    FAILED = 'Failed',
}

// Define the structure for a tracked job
export interface TrackedJob {
    id: string;
    filename: string;
    status: JobStatus;
    progress: number; // A percentage from 0 to 100
    message?: string;
}

export interface QueuedItem {
    id: string;
    socketId?: string; //If client did not provide their id at uplaod then we wont know their socket id
    position: number;
}

/**
 * Describes the complete state of the queue at any given moment.
 */
export interface QueueState {
    queue: QueuedItem[]; /** The full list of items currently in the queue. */
    activeCount: number; /** The number of items currently being processed (at the front of the queue). */
    waitingCount: number; /** The number of items waiting for a free worker. */
    activePosition?: Number /** If a socketId was provided, this is their negative position in the active queue. */
    waitingPosition?: number; /** If a socketId was provided, this is their 1-based position in the waiting queue. */
}

class JobTrackerController {
    private io: socketio.Server | null = null;
    private jobs: Map<string, TrackedJob> = new Map();

    /**
     * Sets the Socket.IO server instance to enable broadcasting.
     * This should be called once during application startup.
     */
    public setIoServer(io: socketio.Server): void {
        this.io = io;
    }

    /**
     * Adds a new job to the tracker and notifies clients.
     */
    public addJob(filename: string, status: JobStatus, message?: string): string {
        const id = crypto.randomUUID();
        const job: TrackedJob = { id, filename, status, progress: 0, message };
        this.jobs.set(id, job);
        console.log(`[JOB TRACKER] -> added id: ${id}, status: ${status}, progress: 0, message: ${message}`);
        this.broadcastUpdates();
        return id;
    }

    /**
     * Updates an existing job's status and progress.
     */
    public updateJob(id: string, status: JobStatus, progress: number, message?: string): void {
        const job = this.jobs.get(id);
        if (!job) { return; }

        const newProgress = Math.min(100, Math.max(0, progress)); // Clamp progress between 0 and 100
        const statusChanged = job.status !== status;
        const messageChanged = message && job.message !== message;
        const progressChangedSignificantly = (newProgress - job.progress) > 0.5;
        if (!statusChanged && !messageChanged && !progressChangedSignificantly) { return; } // Determine if an update is significant enough to be broadcast

        job.status = status;
        job.progress = newProgress;
        if (message) { job.message = message; }

        this.jobs.set(id, job);
        console.log(`[JOB TRACKER] -> updated id: ${id}, status: ${status}, progress: ${progress}, message: ${message}`);
        this.broadcastUpdates();
    }

    /**
     * Removes a job from the tracker (e.g., when completed or after a failure timeout).
     */
    public removeJob(id: string): void {
        if (this.jobs.has(id)) {
            this.jobs.delete(id);
            console.log(`[JOB TRACKER] -> removed id: ${id}`);
            this.broadcastUpdates();
        }
    }

    /**
     * Retrieves the current list of all active jobs.
     */
    public getJobs(): TrackedJob[] {
        return Array.from(this.jobs.values());
    }

    /**
     * Sends the current list of jobs to all connected clients.
     */
    private broadcastUpdates(): void {
        if (this.io) {
            this.io.emit('tracker-update', this.getJobs());
        }
    }
}

/**
 * Manages the waiting queue and broadcasts its state.
 * Extends OrderedQueue to add socket awareness and broadcasting capabilities.
 */
class QueueTrackerController extends OrderedQueue {
    private io: socketio.Server | null = null;
    private socketIdMap: Map<string, string> = new Map(); // Maps queue item ID -> socketId
    private reverseMap: Map<string, string> = new Map(); // socketId -> queueId

    public setIoServer(io: socketio.Server): void {
        this.io = io;
    }

    /**
     * Adds a user to the end of the queue and associates them with their socket ID.
     * @param socketId The unique ID of the socket that is enqueuing.
     * @returns The unique identifier for the user's position in the queue.
     */
    public enqueue(socketId?: string): string | null {
        // Invalid or disconnected socket -> do NOT enqueue
        // Prevent duplicate entries -> do NOT enqueue
        if (socketId && !Array.from(this.getSockets()).some(socket => socket.socketId === socketId)) { return null; }

        const id = super.enqueue(); // Get a unique ID from the base class
        if (socketId) { this.socketIdMap.set(id, socketId); }
        if (socketId) { this.reverseMap.set(socketId, id); }
        console.log(`[QUEUE TRACKER] -> enqueue -> id: ${id}, socketId: ${socketId}, ${this.size()}/${this.max()} (MAX)`);
        this.broadcastUpdates(); // Broadcast the change
        return id;
    }

    /**
     * Removes a user from the queue and broadcasts the change.
     * @param id The unique identifier of the user to remove.
     * @returns `true` if the user was found and removed, otherwise `false`.
     */
    public dequeue(id: string): boolean {
        if (!super.dequeue(id)) { return false; }
        const socketId = this.socketIdMap.get(id);
        if (socketId) { this.reverseMap.delete(socketId); }
        this.socketIdMap.delete(id);
        console.log(`[QUEUE TRACKER] -> dequeue -> id: ${id}, socketId: ${socketId}, ${this.size()}/${this.max()} (MAX)`);
        this.broadcastUpdates(); // Broadcast the change
        return true;
    }

    /**
     * Gets a detailed state of the queue. If a socketId is provided,
     * it also calculates the specific position for that client.
     * @param socketId - (Optional) The unique ID of a client to find their position.
     * @returns A QueueState object with counts, the full queue, and an optional position.
     */
    public getQueueState(socketId?: string): QueueState {
        // Get the raw queue of item IDs from the base OrderedQueue class
        const fullQueue: QueuedItem[] = super.getQueue().map((id, idx) => {
            let position = idx >= super.max() ? (idx - super.max() + 1) : (idx - super.max());
            return { id, socketId: (this.socketIdMap.get(id) ?? ""), position }
        });

        // Calculate counts
        const activeCount = Math.min(fullQueue.length, super.max());
        const waitingCount = Math.max(0, fullQueue.length - activeCount);

        //Find socket's current possition in queue
        let activePosition = fullQueue.find(item => (item.socketId === socketId) && (item.position < 0))?.position || 0;
        let waitingPosition = fullQueue.find(item => (item.socketId === socketId) && (item.position > 0))?.position || 0;

        //We don't want to expose other clients ids
        fullQueue.forEach(item => { if (item.socketId !== socketId) { delete item.socketId }});

        // Return the final state object
        return { queue: fullQueue, activeCount, waitingCount, activePosition, waitingPosition }
    }

    public getSockets(): { socketId: string, emit: any }[] {
        return this.io.sockets.sockets.values();
    }

    /**
     * Sends a personalized queue state update ONLY to the clients
     * that are currently waiting in the queue.
     */
    private broadcastUpdates(): void {
        for (const socket of this.getSockets()) {
            if (!this.reverseMap.has(socket.socketId)) { continue; }
            socket.emit("queue-update", this.getQueueState(socket.socketId));
        }
    }
}

// Export a singleton instance of the tracker
export const JobTracker = new JobTrackerController();
export const QueueTracker = new QueueTrackerController(config.WORKER_COUNT);