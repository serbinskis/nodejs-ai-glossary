import EventEmitter from 'events';
import { Tokenizer } from './tokenizer.js';
import { Utils } from '../utils.js';

export type GlossaryEntry = {
    uid: string;
    term: string;
    definition: string;
    sentence: string;
    language: string;
    generated: boolean;
};

export type GlossaryReport = {
    uid: string;
    hash?: string;
    domain: string;
    language: string;
    implementation: string;
    timestamp_start: number;
    timestamp_end: number;
    error_count?: number;
    retry_error_count?: number;
    debug_info?: { [key: string]: any };
    glossary: GlossaryEntry[];
};

export abstract class GlossaryGenerator extends EventEmitter {
    protected implementation: string = "unknown";
    protected error_count: number = 0;
    protected retry_error_count: number = 0;
    protected progress: number = 0;

    protected constructor(implementation: string) {
        super();
        this.implementation = implementation;
    }

    public async createGlossary(text: string): Promise<GlossaryReport | null> {
        throw new Error("Not implemented");
    }

    public static async getInstance(): Promise<GlossaryGenerator> {
        throw new Error("Not implemented");
    }

    public async countTokens(text: string): Promise<number> {
        return await Tokenizer.countTokens(text);
    }

    public setProgress(progress: number) {
        if (progress < this.progress) { return; }
        this.progress = progress;
        this.emit('progress', progress);
    }

    public emptyReport(): GlossaryReport {
        return {
            uid: crypto.randomUUID(),
            domain: '',
            language: '',
            implementation: this.implementation,
            timestamp_start: Number(new Date()),
            timestamp_end: Number(new Date()),
            error_count: 0,
            glossary: [] as GlossaryEntry[],
        };
    }

    public exportReport(allReports: Partial<GlossaryReport>[], startTime: number, debugInfo?: { [key: string]: any }, deduplicate: boolean = true): GlossaryReport {
        const trimGlossary = (report: GlossaryEntry[]): GlossaryEntry[] => { return report.map((entry) => ({ ...entry, term: entry.term.trim(), definition: entry.definition.trim() })); };
        const combinedGlossary = allReports.flatMap((report) => trimGlossary(report.glossary || []));

        let uniqueGlossary = combinedGlossary;
        if (deduplicate) { uniqueGlossary = Array.from(new Map(combinedGlossary.map((item) => [item?.term.toLowerCase(), item])).values()); }

        const finalReport: GlossaryReport = {
            uid: crypto.randomUUID(),
            domain: allReports[0]?.domain || 'unknown',
            language: Utils.mostCommonBy(uniqueGlossary, entry => entry?.language) ?? 'unknown',
            implementation: this.implementation,
            timestamp_start: startTime,
            timestamp_end: Number(new Date()),
            error_count: this.error_count,
            retry_error_count: this.retry_error_count,
            glossary: uniqueGlossary.map(entry => ({ ...entry, generated: false, uid: crypto.randomUUID() })) as GlossaryEntry[],
        };

        if (debugInfo) { finalReport.debug_info = debugInfo; }
        return finalReport;
    }
}