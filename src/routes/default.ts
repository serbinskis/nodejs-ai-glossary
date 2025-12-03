import { IncomingMessage, ServerResponse } from 'http';
import config from '../config.js';
import { DatabaseManager } from '../database/manager.js';

export type ExtendedRequest = IncomingMessage & { [key: string]: any; };
export type ExtendedResponse = ServerResponse & { [key: string]: any; };
export type DoneCallback = (err?: Error) => void;

export class DefaultRoute {
    protected ip_address: string = null;
    protected req: ExtendedRequest;
    protected res: ExtendedResponse;
    protected done: DoneCallback;

    constructor(req: ExtendedRequest, res: ExtendedResponse, done: DoneCallback) {
        this.req = req;
        this.res = res;
        this.done = done;
    }

    protected async _post(): Promise<{ code: number, message: string, data?: any } | void> {
        return config.ERROR_CODES['444.0'];
    }

    protected async _get(): Promise<{ code: number, message: string, data?: any } | void> {
        return config.ERROR_CODES['444.0'];
    }

    public async post(): Promise<void> {
        this.ip_address = DefaultRoute.getIpId(this.req).ip;
        if (!this.ip_address || await DatabaseManager.isIPBanned(this.ip_address)) { return this.sendResponse(null, config.ERROR_CODES['403.1']); }
         try { var result = await this._post(); } catch(error) { console.error(error); return this.sendResponse(null, config.ERROR_CODES['500.0']); }
        if (result) { DefaultRoute.sendResponse(this.res, result.code, result); }
    }

    public async get(): Promise<void> {
        this.ip_address = DefaultRoute.getIpId(this.req).ip;
        if (!this.ip_address || await DatabaseManager.isIPBanned(this.ip_address)) { return this.sendResponse(null, config.ERROR_CODES['403.1']); }
        try { var result = await this._get(); } catch(error) { console.error(error); return this.sendResponse(null, config.ERROR_CODES['500.0']); }
        if (result) { this.sendResponse(result.code, result); }
    }

    public sendResponse(code?: number, data?: any): void {
        DefaultRoute.sendResponse(this.res, code, data);
    }

    public getIpId(): { ip: string, id: string } {
        return DefaultRoute.getIpId(this.req);
    }

    static getIpId(req: ExtendedRequest): { ip: string, id: string } {
        try { var ip = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress).split(':').pop(); } catch(e) { ip = ''; }
        try { var id = req.url.match(/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g)[0] } catch(e) { id = ''; }
        return { ip: ip, id: id }
    }

    static sendResponse(res: ExtendedResponse, code?: number, data?: any): void {
        if (!code && !data?.code) { throw new Error(`[DefaultRoute.sendResponse] Response code must be provided.`); }
        res.writeHead(code ? code : data?.code);
        if (data) { res.write(JSON.stringify(data)); }
        res.end();
    }
}