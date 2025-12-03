import { EventEmitter } from "events";
import { randomUUID } from "crypto";

export class SerialQueue {
    private items: any[] = [];
    private limit: number = 1;
    private working: boolean = false;
    private open: boolean = true;
    private callback: (...args: any[]) => Promise<boolean|void> | boolean | void;

    constructor(callback: any, limit: number) {
        this.callback = callback || (() => {});
        if (limit > 0) { this.limit = limit; }
    }

    size(): number { return this.items.length; }
    max(): number { return this.limit; }

    async push(...items: any): Promise<boolean> {
        await this.waitForQueue(false);
        if (!this.open) { return false; } else { this.items.push(items); }
        if (!this.working) { this.work(); }
        return true;
    }

    async waitForQueue(bEmpty: boolean): Promise<void> {
        if (bEmpty) { while (this.open && (this.items.length > 0)) { await new Promise(resolve => setTimeout(resolve, 1)); } }
        if (!bEmpty) { while (this.open && (this.items.length >= this.limit)) { await new Promise(resolve => setTimeout(resolve, 1)); } }
    }

    private async work(): Promise<void> {
        this.working = true;

        while (this.working && (this.items.length > 0)) {
            var b1 = await this.callback(...this.items[0]);
            if ((b1 !== undefined) && !b1) { this.close(); break; } else { this.items.shift(); }
        }

        this.working = false;
    }

    clear(): void {
        this.items = [];
    }

    close(): void {
        this.open = false;
        this.working = false;
        this.clear();
    }
}

export class ParalelQueue {
    private items: Map<number, any> = new Map();
    private limit: number = 1;
    private curr_working: number = 0;
    private push_order: number = 0;
    private work_order: number = 0;
    private outp_order: number = 0;
    private working: boolean = false;
    private clearing: boolean = false;
    private open: boolean = true;
    private func_callback: (...args: any[]) => Promise<any> | any;
    private outp_callback: (...args: any[]) => Promise<void> | void;

    constructor(func_callback: any, outp_callback: any, limit: number) {
        this.func_callback = func_callback || (() => {});
        this.outp_callback = outp_callback || (() => {});
        if (limit > 0) { this.limit = limit; }
    }

    size(): Number { return this.curr_working; }
    max(): Number { return this.limit; }

    async push(...args: any): Promise<boolean> {
        await this.waitForQueue(false);
        if (!this.open) { return false; } else { this.items.set(this.push_order, [this.push_order, args]); }
        this.push_order++;
        if (!this.working) { this.work(); }
        return true;
    }

    async waitForQueue(bEmpty: boolean): Promise<void> {
        if (bEmpty) { while (this.open && (this.outp_order != this.push_order)) { await new Promise(resolve => setTimeout(resolve, 1)); } }
        if (!bEmpty) { while (this.open && (this.items.size >= this.limit)) { await new Promise(resolve => setTimeout(resolve, 1)); } }
    }

    private async work(): Promise<void> {
        this.working = true;
        this.clearing = false;

        while (this.working && (this.items.size > 0) && (this.work_order < this.push_order)) {
            if (!this.items.has(this.work_order)) { this.work_order++; continue; } //Items can be cleard, so if we are working while that happends, we just skip them
            var item: any = this.items.get(this.work_order);
            this.work_order++;
            this.curr_working++;
            this.callback(item[0], item[1]);
            while (this.open && (this.curr_working >= this.limit)) { await new Promise(resolve => setTimeout(resolve, 1)); }
        }

        this.working = false;
    }

    private async callback(order: number, args: any[]): Promise<any> {
        if (this.open) { var result = await this.func_callback(...args); }
        while (!this.clearing && (this.outp_order != order)) { await new Promise(resolve => setTimeout(resolve, 1)); } //Wait for our turn to output
        if (this.clearing) { return this.outp_order = this.push_order; }
        if (this.open && this.items.has(order)) { await this.outp_callback(result); }
        this.items.delete(order); //WHY TF THIS IS HERE, I DONT REMEMBER, IT WAS PREVIOUSLY BEFORE outp_callback, BUT IT WAS CAUSING BUGS, SO I MOVED IT HERE
        this.curr_working--;
        this.outp_order++;
    }

    clear(): void {
        this.items.clear();
        this.clearing = true;
    }

    close(): void {
        this.open = false;
        this.working = false;
        this.clear();
    }
}

/**
 * A queue that allows a limited number of users to be "active" at the front.
 * Users are processed in the order they are enqueued (FIFO).
 */
export class OrderedQueue extends EventEmitter {
    private queue: string[] = [];
    private waiting = new Map<string, { resolve: (status: boolean) => void; promise: Promise<boolean>; }>();
    private readonly limit: number;

    /**
     * Creates an instance of OrderedQueue.
     * @param limit The maximum number of users that can be "active" at the front of the queue.
     */
    constructor(limit: number) {
        super();
        if (limit < 1) { throw new Error("Limit cannot be less than 1."); }
        this.limit = limit;
    }

    /**
     * Checks if a user is in the queue
     * @param id The unique identifier of the user to remove.
     * @returns `true` if the user was found, otherwise `false`.
     */
    public inqueue(id: string): boolean {
        return this.queue.includes(id);
    }

    /**
     * Checks if a user is currently active (at the front of the queue).
     * @param id The unique identifier of the user.
     * @returns `true` if the user is in the active zone, otherwise `false`.
     */
    public active(id: string): boolean {
        const index = this.queue.indexOf(id);
        return index > -1 && index < this.limit;
    }

    /**
     * Adds a user to the end of the queue.
     * @returns A unique identifier for the user's position in the queue.
     */
    public enqueue(): string {
        const id = randomUUID();
        this.queue.push(id);
    
        // Create a new promise that will be resolved when the user is active.
        let resolver: (status: boolean) => void;
        const promise = new Promise<boolean>((resolve) => { resolver = resolve; });
        this.waiting.set(id, { resolve: resolver!, promise });

        // Check if this new user (or any other) can become active.
        this.processQueue();
        return id;
    }

    /**
     * Removes a user from the queue, regardless of their position.
     * @param id The unique identifier of the user to remove.
     * @returns `true` if the user was found and removed, otherwise `false`.
     */
    public dequeue(id: string): boolean {
        const index = this.queue.indexOf(id);

        if (index > -1) {
            this.queue.splice(index, 1); // Remove the user from the ordered queue.
            const waiter = this.waiting.get(id);
            if (waiter) { waiter.resolve(false); } // Signal failure to the waiting promise.
            this.waiting.delete(id); // Remove the associated waiting promise.
            this.emit('dequeue', id);
            this.processQueue(); // Re-evaluate the queue as a spot may have opened up for another user.
            return true;
        }

        return false;
    }

    /**
     * Returns a promise that resolves when the user is at the front of the queue (within the limit).
     * @param id The unique identifier of the user.
     * @returns A promise that resolves when the user becomes active.
     */
    public async wait(id: string): Promise<boolean> {
        const waiter = this.waiting.get(id);
        if (!waiter) { return false; } // If the waiter doesn't exist, it was likely dequeued before `wait` was even called.
        return waiter.promise; // Await the promise. It will resolve to true (active) or false (dequeued).
    }

    /**
     * Checks the queue and resolves the promises for all users who are now in the "active" zone.
     * This method is called internally whenever the queue's state changes.
     */
    private processQueue(): void {
        const activeUsers = this.queue.slice(0, this.limit);

        for (const id of activeUsers) {
            const waiter = this.waiting.get(id);
            if (!waiter) { continue; } // ↓ This will only resolve the promise the first time. Subsequent calls have no effect.
            waiter.resolve(true); // Resolving the promise will unblock any `await wait(id)` call.
            this.emit('active', id);
        }
    }

    /**
     * Gets the current position (index) of a user in the queue.
     * @param id The unique identifier of the user.
     * @returns The 0-based index of the user, or -1 if not found.
     */
    public getPosition(id: string): number {
        return this.queue.indexOf(id);
    }

    /**
     * Gets a copy of the current queue array.
     * @returns An array of user identifiers.
     */
    public getQueue(): string[] {
        return [...this.queue]; // Return a copy to prevent external modification
    }
    
    /**
     * Gets the current number of users in the queue.
     * @returns The total number of users waiting.
     */
    public size(): number {
        return this.queue.length;
    }
    
    /**
     * Gets the configured concurrency limit of the queue.
     * @returns The maximum number of active users.
     */
    public max(): number {
        return this.limit;
    }
}