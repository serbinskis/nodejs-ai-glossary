import config from '../config.js';
import Database from './database.js';

export type GlossaryTerm = {
    name: string;
    definition: string;
    language: string;
    generated: boolean;
};

export type GlossaryObject = {
    glossary: GlossaryTerm[];
};

/**
 * A static singleton class to manage the global database connection.
 */
export class DatabaseManager {
    // The internal, private singleton instance of the Database class.
    private static db: Database<typeof config.DATABASE_TABLES>;

    /**
     * Initializes the global database connection using the settings from `config.ts`.
     * This must be called once at application startup before any other database methods are used.
     */
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

    public static async createFile(hash: string, filename: string, mimeType: string, size: number, text: string, glossary: JSON, ip_address): Promise<JSON> {
        var file = this.db.models.files.create(hash, filename, mimeType, size, text, JSON.stringify(glossary), ip_address, Date.now(), Date.now());
        await file.save();
        return file.toObject(false) as JSON;
    }

    public static async getFile(hash: string): Promise<JSON> {
        return (await this.db.models.files.find(hash))?.toObject() as JSON;
    }

    public static async getFileText(hash: string): Promise<string | null> {
        this.assertInitialized();
        return (await this.db.models.files.find(hash))?.extracted_text;
    }

    public static async getFileGlossary(hash: string): Promise<GlossaryObject | null> {
        this.assertInitialized();
        var extracted_glossary = (await this.db.models.files.find(hash))?.extracted_glossary;
        return extracted_glossary ? JSON.parse(extracted_glossary) : null;
    }

    public static async setFileText(hash: string, text: string): Promise<boolean> {
        this.assertInitialized();
        return (await this.db.models.files.columns.extracted_text.setValue(hash, text)).status;
    }

    /**
     * A private helper that throws a clear error if the database is accessed before it's ready.
     */
    private static assertInitialized(): void {
        if (!this.ready) { throw new Error("DatabaseManager has not been initialized. Please call 'await DatabaseManager.init()'."); }
    }

    /**
     * A flag indicating if the database connection is ready.
     */
    public static get ready(): boolean {
        return this.db ? this.db.ready : false;
    }

    /**
     * Closes the database connection gracefully.
     */
    public static async close(): Promise<void> {
        this.assertInitialized();
        await this.db.close();
    }

    public static async vacuum(): Promise<boolean> {
        this.assertInitialized();
        console.log('Running vacuum session to compress database size.');
        var result = await this.db.vacuum();
        console.log('Finished vacuum session.');
        return result.status;
    }
}