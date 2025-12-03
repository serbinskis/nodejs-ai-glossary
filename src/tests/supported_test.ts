import * as fs from 'fs/promises';
import * as path from 'path';
import { isSupported, ValidationType } from './../supported.js';
import { fileURLToPath } from 'url';

// The directory to scan, located one level up from the 'src' directory.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_DIR = path.join(__dirname, '../..', 'storage');

// How many bytes to read from the start of a file to check its header.
const HEADER_READ_SIZE = 32;

/**
 * A helper function to format the status string with padding,
 * mimicking the Python f-string formatting `f"[{status.name:^17}]"`.
 * @param status The status string to format.
 * @returns A formatted string like "[   IS_SUPPORTED    ]".
 */
function formatStatus(status: string): string {
    const targetWidth = 17;
    const padding = Math.max(0, targetWidth - status.length);
    const padStart = Math.floor(padding / 2);
    const padEnd = padding - padStart;
    return `[${' '.repeat(padStart)}${status}${' '.repeat(padEnd)}]`;
}


/**
 * Scans files in the STORAGE_DIR, runs them through the validator,
 * and prints a detailed report to the console.
 */
async function runTests() {
    console.log(`--- Starting File Validation in '${STORAGE_DIR}' ---\n`);

    try {
        // Check if the directory exists first. fs.readdir() would also throw, but this is more explicit.
        await fs.access(STORAGE_DIR);
    } catch (error) {
        console.error(`Error: Directory not found: '${STORAGE_DIR}'`);
        return;
    }

    const filenames = (await fs.readdir(STORAGE_DIR)).sort();

    if (filenames.length === 0) {
        console.log("Directory is empty. No files to test.");
        return;
    }

    // Process each file
    for (const filename of filenames) {
        const fullPath = path.join(STORAGE_DIR, filename);
        let statusStr: string;

        try {
            const stats = await fs.stat(fullPath);

            // Skip if it's a directory
            if (!stats.isFile()) {
                continue;
            }

            const filesize = stats.size;

            // Open the file and read only the header portion
            const fileHandle = await fs.open(fullPath, 'r');
            const header = Buffer.alloc(HEADER_READ_SIZE);
            await fileHandle.read(header, 0, HEADER_READ_SIZE, 0);
            await fileHandle.close();

            const [status] = isSupported(fullPath, filesize, header);
            statusStr = formatStatus(status);

        } catch (e: any) {
            if (e.code === 'EACCES' || e.code === 'EISDIR') {
                statusStr = formatStatus('ERROR_READING');
            } else {
                statusStr = formatStatus('UNEXPECTED_ERROR');
            }
            console.log(`${statusStr} ${filename} (Reason: ${e.message})`);
            continue;
        }

        console.log(`${statusStr} ${filename}`);
    }

    console.log("\n--- Validation Complete ---");
}

export { runTests };