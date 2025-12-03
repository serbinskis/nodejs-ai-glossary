import { StreamPiper } from '../piper.js';
import { Readable } from 'stream';
import { promises as fs } from 'fs';
import path, { resolve } from 'path';
import os from 'os';
import crypto from 'crypto';
import config from '../config.js';

// --- Configuration ---
// The temporary directory for test file output.
const UPLOAD_DIRECTORY = config.UPLAOD_DIRECTORY;

/**
 * A simple assertion helper to make the test readable.
 * Throws an error if the condition is false.
 */
function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(`Assertion Failed: ${message}`);
    }
}

/**
 * A single, reusable function to test the StreamPiper with a file of a given size.
 * @param fileSize The size of the file to generate for the test.
 */
async function runTest(fileSize: number) {
    console.log(`\n--- Starting Test: File Size = ${fileSize} bytes ---`);

    // 1. Prepare source data for this specific test run.
    const sourceBuffer = crypto.randomBytes(fileSize);
    const expectedHash = crypto.createHash('sha256').update(sourceBuffer).digest('hex');
    const outputPath = path.join(UPLOAD_DIRECTORY, `file-${fileSize}-bytes.bin`);
    const piper = new StreamPiper(Readable.from(sourceBuffer), sourceBuffer.length);

    // 2. Get and verify the header.
    console.log("Step 1: Getting header...");
    const header = await piper.getHeader();
    console.log(`✔ Header received. Length: ${header.length} bytes. Stream is now paused.`);

    const expectedHeaderSize = Math.min(fileSize, StreamPiper.HEADER_SIZE);
    assert(header.length === expectedHeaderSize, `Header length should be ${expectedHeaderSize}`);
    
    const expectedHeaderContent = sourceBuffer.subarray(0, expectedHeaderSize);
    assert(header.equals(expectedHeaderContent), 'Header content is incorrect');
    console.log("✔ Header is correct.");

    // 3. Introduce a deliberate delay to ensure the paused stream holds its state.
    console.log("Step 2: Waiting for 500ms before writing...");
    await new Promise(resolve => setTimeout(resolve, 500)); // Special delay
    console.log("✔ Delay complete.");

    // 4. Write the file to disk. This should resume the stream correctly.
    console.log("Step 3: Writing stream to file...");
    await piper.writeFile(outputPath);
    console.log(`✔ File written to ${outputPath}`);
    
    // 5. Get the hash and read the written file back for verification.
    const actualHash = await piper.getHash();
    const writtenFileBuffer = await fs.readFile(outputPath);

    // 6. Final assertions.
    assert(actualHash === expectedHash, "Hash mismatch!");
    assert(writtenFileBuffer.equals(sourceBuffer), "File content mismatch!");
    console.log("✔ File content and hash are correct.");
}

// --- Execution and Cleanup ---
// We wrap the execution in a self-invoking async function to handle cleanup.
export async function runPiperTest() {
    try {
        await fs.mkdir(UPLOAD_DIRECTORY, { recursive: true });
        console.log(`--- Test environment setup in: ${UPLOAD_DIRECTORY} ---`);
        
        // Run the test for different scenarios using the same function.
        await runTest(9999999);  // A file larger than the header size.
        await runTest(2048);  // A file larger than the header size.
        await runTest(512);   // A file smaller than the header size.
        await runTest(1024);  // An edge case: file is exactly the header size.
        await runTest(0);     // An edge case: an empty file.

        console.log('\n✅ All test scenarios passed successfully!');
    } catch (error) {
        console.error('\n❌ A test scenario failed!');
        console.error(error);
        process.exit(1);
    } finally {
        await fs.rm(UPLOAD_DIRECTORY, { recursive: true, force: true });
        console.log('\n--- Test environment cleaned up ---');
    }
};