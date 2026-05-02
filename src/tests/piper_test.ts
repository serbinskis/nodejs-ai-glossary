import { StreamPiper } from '../piper.js';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import config from '../config.js';

const UPLOAD_DIRECTORY = config.UPLAOD_DIRECTORY;
const MAX_MEMORY_SOURCE_SIZE = 10 * 1024 * 1024;

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(`Assertion Failed: ${message}`);
    }
}

export async function prepare(fileSize: number): Promise<{ hash: string, stream: Readable, buffer: Buffer, tempFilePath?: string }> {
    if (fileSize <= MAX_MEMORY_SOURCE_SIZE) {
        const buffer = crypto.randomBytes(fileSize);
        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        return { hash, stream: Readable.from(buffer), buffer };
    } else {
        const tempFilePath = path.join(UPLOAD_DIRECTORY, `piper_test_${Date.now()}_${Math.random()}.bin`);
        const writeStream = createWriteStream(tempFilePath);
        const hash = crypto.createHash('sha256');

        const first10MBChunks: Buffer[] = [];
        let bytesCollectedForBuffer = 0;

        const chunkSize = 65536;
        let bytesWritten = 0;

        while (bytesWritten < fileSize) {
            const sizeToGenerate = Math.min(chunkSize, fileSize - bytesWritten);
            const chunk = crypto.randomBytes(sizeToGenerate);

            hash.update(chunk);

            if (bytesCollectedForBuffer < MAX_MEMORY_SOURCE_SIZE) {
                const remainingSpace = MAX_MEMORY_SOURCE_SIZE - bytesCollectedForBuffer;
                const chunkToKeep = chunk.length > remainingSpace ? chunk.subarray(0, remainingSpace) : chunk;
                first10MBChunks.push(chunkToKeep);
                bytesCollectedForBuffer += chunkToKeep.length;
            }

            if (!writeStream.write(chunk)) {
                await new Promise(resolve => writeStream.once('drain', resolve));
            }

            bytesWritten += sizeToGenerate;
        }

        writeStream.end();
        await finished(writeStream);

        const finalHash = hash.digest('hex');
        const readStream = createReadStream(tempFilePath);
        const first10MBBuffer = Buffer.concat(first10MBChunks);

        return { hash: finalHash, stream: readStream, tempFilePath, buffer: first10MBBuffer };
    }
}

async function runTest(fileSize: number) {
    console.log(`\nStarting Test: File Size = ${fileSize} bytes`);

    const { hash: expectedHash, stream, buffer: sourceBuffer } = await prepare(fileSize);
    const outputPath = path.join(UPLOAD_DIRECTORY, `file-${fileSize}-bytes.bin`);
    const piper = new StreamPiper(stream, fileSize);

    console.log("Step 1: Getting header...");
    const header = await piper.getHeader();
    console.log(`[+] Header received. Length: ${header.length} bytes. Stream is now paused.`);
    const expectedHeaderSize = Math.min(fileSize, StreamPiper.HEADER_SIZE);
    assert(header.length === expectedHeaderSize, `Header length should be ${expectedHeaderSize}`);
    const expectedHeaderContent = sourceBuffer.subarray(0, expectedHeaderSize);
    assert(header.equals(expectedHeaderContent), 'Header content is incorrect');
    console.log("[+] Header is correct.");

    console.log("Step 2: Waiting for 500ms before writing...");
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log("[+] Delay complete.");

    console.log("Step 3: Writing stream to file...");
    await piper.writeFile(outputPath);
    console.log(`[+] File written to ${outputPath}`);

    const actualHash = await piper.getHash();
    let writtenFileBuffer: Buffer | null = null;
    if (fileSize <= MAX_MEMORY_SOURCE_SIZE) { writtenFileBuffer = await fs.readFile(outputPath); }

    assert(actualHash === expectedHash, "Hash mismatch!");
    if (fileSize <= MAX_MEMORY_SOURCE_SIZE) { assert(writtenFileBuffer!.equals(sourceBuffer), "File content mismatch!"); }
    console.log("[+] File content and hash are correct.");
}

export async function runPiperTest() {
    try {
        await fs.mkdir(UPLOAD_DIRECTORY, { recursive: true });
        console.log(`Test environment setup in: ${UPLOAD_DIRECTORY}`);

        await runTest(10*1024*1024);
        await runTest(2048);
        await runTest(512);
        await runTest(1024);
        await runTest(0);
        await runTest(1024*1024*1024);

        console.log('\nAll test scenarios passed successfully!');
    } catch (error) {
        console.error('\n[!] A test scenario failed!');
        console.error(error);
        process.exit(1);
    } finally {
        await fs.rm(UPLOAD_DIRECTORY, { recursive: true, force: true });
        console.log('Test environment cleaned up');
    }
};

(async () => {
    await runPiperTest();
    process.exit(0);
})();