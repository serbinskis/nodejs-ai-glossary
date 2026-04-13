import config from '../config.js';
import { GlossaryEntry, GlossaryReport } from '../glossary/glossary.js';
import Database from './database.js';
import { createHash } from 'node:crypto';

export class DatabaseManager {
    private static db: Database<typeof config.DATABASE_TABLES>;

    static async init(): Promise<void> {
        if (this.db && this.db.ready) { return console.warn("Database Manager has already been initialized."); }

        const databaseInstance = new Database({
            filename: config.DATABASE_FILEPATH,
            tables: config.DATABASE_TABLES,
            error_callback: (name, err) => { console.error(name, err.message); process.exit(1); },
            delete_unused: true,
            reorder: true,
            backup_interval: 60 * 60 * 1000,
            backup_enabled: true,
        });

        await databaseInstance.open();
        this.db = databaseInstance;
        console.log(`Opened database: "${this.db.filename.replace(config.BASE_DIRECTORY, '')}".`);
    }

    public static async isIPBanned(ip: string): Promise<boolean> {
        return Boolean((await this.db.models.users.find(ip))?.banned);
    }

    public static async setIPBanned(ip_address: string, banned: boolean) {
        var user = await this.db.models.users.find(ip_address);
        if (!user) { user = this.db.models.users.create(ip_address, 0, Date.now(), Date.now()); }
        if (user.banned == Number(banned)) { return; } else { user.banned = Number(banned); }
        await user.save();
    }

    public static async createFile(hash: string, filename: string, mimeType: string, size: number, text: string, glossary: GlossaryReport, ip_address: string): Promise<JSON> {
        var file = this.db.models.files.create(hash, filename, mimeType, size, text, JSON.stringify(glossary), glossary.implementation, ip_address, Date.now(), Date.now());
        await file.save();
        return file.toObject(false) as JSON;
    }

    public static async getFile(hash: string): Promise<JSON> {
        return (await this.db.models.files.find(hash))?.toObject() as JSON;
    }

    public static async getFileText(hash: string): Promise<string | null | undefined> {
        this.assertInitialized();
        return (await this.db.models.files.find(hash))?.extracted_text;
    }

    public static async getFileGlossary(hash: string): Promise<GlossaryReport | null> {
        this.assertInitialized();
        var extracted_glossary = (await this.db.models.files.find(hash))?.extracted_glossary;
        return extracted_glossary ? JSON.parse(extracted_glossary) : null;
    }

    public static async setFileText(hash: string, text: string): Promise<boolean> {
        this.assertInitialized();
        return (await this.db.models.files.columns.extracted_text.setValue(hash, text)).status as boolean;
    }

    private static async setActivityEntry(glossary_hash_combination: string, glossary_hash: string, entry_uid: string, event: string, data: string, ip_address: string): Promise<boolean> {
        const hash = createHash('sha256').update(glossary_hash_combination + glossary_hash + entry_uid + event + ip_address).digest('hex');
        let entry = await this.db.models.activity.find(hash);
        if (entry) { entry.data = data; entry.creation_date = Date.now(); }
        if (!entry) { entry = this.db.models.activity.create(hash, glossary_hash_combination, glossary_hash, entry_uid, event, data, ip_address, Date.now()); }
        return (await entry.save()).status as boolean;;
    }

    public static async validateActivityEntry(glossary_hash_combination: string, glossary_hash: string, entry_uid: string, event: string, data: string, ip_address: string): Promise<boolean> {
        event = event.toUpperCase();
        let glossaries = await Promise.all(glossary_hash_combination.split(';').map(async (hash) => await this.db.models.files.find(hash)));
        if (glossaries.some(g => !g) || glossaries.length === 0) { return false; }
        const THE_NULL = (null as unknown as string);

        if (event === 'MODIFIED_TERM') {
            let glossary = glossaries.find(g => g!.hash === glossary_hash);
            if (!glossary) { return false; }
            let extracted_glossary: GlossaryReport = JSON.parse(glossary.extracted_glossary);
            let entry = extracted_glossary.glossary.find(t => t.uid === entry_uid);
            if (!entry) { return false; }
            if (!data || data.length > config.MAX_FILENAME_LENGTH) { return false; }
            return await this.setActivityEntry(glossary_hash_combination, glossary_hash, entry_uid, event, data, ip_address);
        }

        if (event === 'MODIFIED_DEFINITION') {
            let glossary = glossaries.find(g => g!.hash === glossary_hash);
            if (!glossary) { return false; }
            let extracted_glossary: GlossaryReport = JSON.parse(glossary.extracted_glossary);
            let entry = extracted_glossary.glossary.find(t => t.uid === entry_uid);
            if (!entry) { return false; }
            if (!data || data.length > config.MAX_FILENAME_LENGTH*10) { return false; }
            return await this.setActivityEntry(glossary_hash_combination, glossary_hash, entry_uid, event, data, ip_address);
        }

        if (event === 'REMOVED_TERM') {
            let glossary = glossaries.find(g => g!.hash === glossary_hash);
            if (!glossary) { return false; }
            let extracted_glossary: GlossaryReport = JSON.parse(glossary.extracted_glossary);
            let entry = extracted_glossary.glossary.find(t => t.uid === entry_uid);
            if (!entry) { return false; }
            return await this.setActivityEntry(glossary_hash_combination, glossary_hash, entry_uid, event, "1", ip_address);
        }

        if (event === 'RESTORED_TERM') {
            let glossary = glossaries.find(g => g!.hash === glossary_hash);
            if (!glossary) { return false; }
            let extracted_glossary: GlossaryReport = JSON.parse(glossary.extracted_glossary);
            let entry = extracted_glossary.glossary.find(t => t.uid === entry_uid);
            if (!entry) { return false; }
            return await this.setActivityEntry(glossary_hash_combination, glossary_hash, entry_uid, 'REMOVED_TERM', "0", ip_address);
        }

        if (event === 'ADDED_TERM') {
            if (!data || data.length > config.MAX_FILENAME_LENGTH*10) { return false; }
            try { var entry: GlossaryEntry = JSON.parse(data); } catch (error) { return false; }
            if (!entry.term || !entry.definition) { return false; }
            let languages = glossaries.map(g => JSON.parse(g!.extracted_glossary).language);
            let language = languages.sort((a, b) => languages.filter(v => v === a).length - languages.filter(v => v === b).length).pop();
            let entry_json: string | null = JSON.stringify({ term: entry.term, definition: entry.definition, language: language || 'en' });
            let entry_hash = createHash('sha256').update(entry_json).digest('hex');
            if ((entry as any).remove) { entry_json = null; }
            return await this.setActivityEntry(glossary_hash_combination, THE_NULL, entry_hash, event, entry_json as string, ip_address);
        }

        if (event === 'EXPORTED_GLOSSARY') {
            return await this.setActivityEntry(glossary_hash_combination, THE_NULL, THE_NULL, event, THE_NULL, ip_address);
        }

        return false;
    }

    private static assertInitialized(): void {
        if (!this.ready) { throw new Error("DatabaseManager has not been initialized. Please call 'await DatabaseManager.init()'."); }
    }

    public static get ready(): boolean {
        return this.db ? this.db.ready : false;
    }

    public static async close(): Promise<void> {
        this.assertInitialized();
        await this.db.close();
    }

    public static async vacuum(): Promise<boolean> {
        this.assertInitialized();
        console.log('Running vacuum session to compress database size.');
        var result = await this.db.vacuum();
        console.log('Finished vacuum session.');
        return result.status as boolean;
    }
}