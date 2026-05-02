import * as fs from 'fs/promises';
import * as path from 'path';
import { isSupported } from './../supported.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_DIR = path.join(__dirname, '../..', 'storage');

const HEADER_READ_SIZE = 1024;

function formatStatus(status: string): string {
    const targetWidth = 17;
    const padding = Math.max(0, targetWidth - status.length);
    const padStart = Math.floor(padding / 2);
    const padEnd = padding - padStart;
    return `[${' '.repeat(padStart)}${status}${' '.repeat(padEnd)}]`;
}

async function runTests() {
    console.log(`Starting File Validation in '${STORAGE_DIR}'\n`);

    try { await fs.access(STORAGE_DIR); }
    catch (error) { return console.error(`Error: Directory not found: '${STORAGE_DIR}'`); }

    const filenames = (await fs.readdir(STORAGE_DIR)).sort();
    if (filenames.length === 0) { return console.log("Directory is empty. No files to test."); }

    for (const filename of filenames) {
        const fullPath = path.join(STORAGE_DIR, filename);
        let statusStr: string;

        try {
            const stats = await fs.stat(fullPath);
            if (!stats.isFile()) { continue; }
            const filesize = stats.size;

            const fileHandle = await fs.open(fullPath, 'r');
            const header = Buffer.alloc(HEADER_READ_SIZE);
            await fileHandle.read(header, 0, HEADER_READ_SIZE, 0);
            await fileHandle.close();

            const [status] = isSupported(fullPath, filesize, header);
            statusStr = formatStatus(status);
        } catch (e: any) {
            statusStr = formatStatus((e.code === 'EACCES' || e.code === 'EISDIR') ? 'ERROR_READING' : 'UNEXPECTED_ERROR');
            console.log(`${statusStr} ${filename} (Reason: ${e.message})`);
            continue;
        }

        console.log(`${statusStr} ${filename}`);
    }

    console.log("\nValidation Complete");
}

(async () => {
    await runTests();
    process.exit(0);
})();