import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getProcessor } from './../supported.js';

// The directory to scan, located one level up from the 'src' directory.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_DIR = path.join(__dirname, '../..', 'storage');

/**
 * Scans files in STORAGE_DIR, attempts text extraction, and displays progress.
 */
async function runExtractionTests() {
    console.log(`--- Starting Text Extraction Test in '${STORAGE_DIR}' ---\n`);

    try {
        await fs.access(STORAGE_DIR);
    } catch (error) {
        console.error(`Error: Directory not found: '${STORAGE_DIR}'`);
        return;
    }

    const filenames = (await fs.readdir(STORAGE_DIR)).sort();
    const totalFiles = filenames.length;

    if (totalFiles === 0) {
        console.log("Directory is empty.");
        return;
    }

    let fileCounter = 0;
    for (const filename of filenames) {
        fileCounter++;
        const progressPrefix = `[${fileCounter.toString().padStart(totalFiles.toString().length, ' ')}/${totalFiles}]`;
        const fullPath = path.join(STORAGE_DIR, filename);

        // Skip directories
        try {
            const stats = await fs.stat(fullPath);
            if (!stats.isFile()) {
                console.log(`${progressPrefix} [SKIPPING DIR] ${filename}`);
                console.log("-".repeat(50));
                continue;
            }
        } catch {
            continue; // Skip if we can't get stats
        }

        console.log(`${progressPrefix} [PROCESSING] ${filename}`);

        try {
            const processor = getProcessor(fullPath);

            if (processor) {
                let progressLogged = false;
                // Set the callback to render a progress bar in the console.
                processor.setCallback((progress) => {
                    progressLogged = true;
                    const barWidth = 25;
                    const filledWidth = Math.round((barWidth * progress) / 100);
                    const emptyWidth = barWidth - filledWidth;
                    const bar = '█'.repeat(filledWidth) + '─'.repeat(emptyWidth);
                    const percentage = Math.round(progress).toString().padStart(3);
                    
                    // Use process.stdout.write with a carriage return (\r) to
                    // overwrite the same line in the terminal.
                    process.stdout.write(`   PROGRESS: [${bar}] ${percentage}%\r`);
                });

                const text = await processor.extractText();

                // After the await, the progress is complete. Move to a new line.
                if (progressLogged) {
                    process.stdout.write('\n');
                }

                if (text) {
                    const snippet = text.substring(0, 100).replace(/\s+/g, ' ').trim();
                    console.log(`   STATUS:   SUCCESS (${text.length} chars extracted)`);
                    console.log(`   SNIPPET:  "${snippet}..."`);
                } else {
                    console.log("   STATUS:   FAILED (Processor returned empty text)");
                }
            } else {
                console.log("   STATUS:   UNSUPPORTED (No processor for this file type)");
            }
        } catch (e: any) {
            // Ensure we move to a new line if an error occurred mid-progress
            process.stdout.write('\n');
            console.log(`   STATUS:   ERROR (${e.message})`);
        }

        console.log("-".repeat(50));
    }

    console.log("\n--- Extraction Test Complete ---");
}

export { runExtractionTests };