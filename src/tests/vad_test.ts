import path from 'path';
import * as fsp from 'fs/promises';
import { fileURLToPath } from 'url';
import assert from 'assert';

// Adjust import paths if your project structure is different
import { VAD_OPTIONS_DEFAULT, VAD_OPTIONS_FULL_AUDIO, VadAdapter } from '../whisper/vad_adapter.js';
import { PCMConverter } from '../whisper/pcm_converter.js';

// --- Test Configuration ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const STORAGE_DIR = path.join(PROJECT_ROOT, 'storage');

// THE INPUT FILE
const INPUT_VIDEO_FILE = path.join(STORAGE_DIR, 'ice_video_20251104-102727.mp4');

// WHERE THE OUTPUT CHUNKS WILL BE SAVED
const TEST_OUTPUT_DIR = path.join(STORAGE_DIR, 'test_vad_adapter_output');


// --- [HELPER FUNCTIONS] ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to get a random duration in milliseconds for different purposes
function getRandomDuration(minMs, maxMs) {
    return Math.floor(Math.random() * (maxMs - minMs + 1) + minMs);
}

/**
 * [EXTERNAL PAUSING]
 * Runs a loop in the background to randomly pause and resume the VAD adapter,
 * simulating an unpredictable downstream consumer or network latency.
 * @param {VadAdapter} vadAdapter The adapter instance to control.
 * @param {{done: boolean}} stopSignal An object to signal when the loop should terminate.
 */
async function startRandomExternalPausing(vadAdapter, stopSignal) {
    console.log('[EXTERNAL] Rapid, short-duration pausing routine started.');

    while (!stopSignal.done) {
        try {
            // --- [MODIFIED] ---
            // Wait for a very short, random period before initiating a pause.
            const delayBeforePause = getRandomDuration(200, 500); // 0.2-0.9 seconds
            await sleep(delayBeforePause);

            if (stopSignal.done) break;

            // Pause the VAD stream for a very short, random duration.
            const pauseDuration = getRandomDuration(50, 100); // 0.05-0.4 seconds
            // --- [/MODIFIED] ---
            
            process.stdout.write('\n');
            console.log(`[EXTERNAL] Pausing VAD stream for ${pauseDuration.toFixed(0)}ms...`);
            vadAdapter.pause();

            await sleep(pauseDuration);

            if (stopSignal.done) break;

            console.log(`[EXTERNAL] Resuming VAD stream.`);
            process.stdout.write('\n');
            vadAdapter.resume();

        } catch (error) {
            console.error('[EXTERNAL] Error in pausing routine:', error);
            break;
        }
    }
    console.log('[EXTERNAL] Random pausing routine finished.');
}


/**
 * Tests the pipeline of PCMConverter streaming into VadAdapter with two types
 * of pausing: internal (per-chunk processing) and external (random interruptions).
 */
async function runVadTests() {
    console.log("--- Starting VAD Adapter Pipeline Test (with Internal & External Pausing) ---");
    console.log(`[INPUT]  File: ${INPUT_VIDEO_FILE}`);
    console.log(`[OUTPUT] Dir:  ${TEST_OUTPUT_DIR}`);

    // 1. SETUP
    try {
        await fsp.rm(TEST_OUTPUT_DIR, { recursive: true, force: true });
        await fsp.mkdir(TEST_OUTPUT_DIR, { recursive: true });
    } catch (error) {
        console.error(`[FATAL] Failed to set up output directory:`, error);
        throw error;
    }

    // 2. CONFIGURE
    const vadOptions = VAD_OPTIONS_DEFAULT;
    console.log(`[CONFIG] Using default VAD options. Chunks expected between ~${vadOptions.minChunkDurationSeconds}s and ${vadOptions.maxChunkDurationSeconds}s.`);

    // 3. EXECUTE
    try {
        await new Promise((resolve, reject) => {
            const pcmConverter = new PCMConverter(INPUT_VIDEO_FILE);
            const vadAdapter = new VadAdapter(vadOptions);

            let chunkCounter = 0;
            const savedChunkDurations = [];
            const baseOutputName = path.parse(INPUT_VIDEO_FILE).name;
            
            // Signal to stop the external pausing loop when the stream ends or errors.
            const stopPausingSignal = { done: false };
            const cleanupAndSignal = () => {
                if (!stopPausingSignal.done) {
                    stopPausingSignal.done = true;
                }
            };

            vadAdapter.on('data', async (chunk) => {
                // --- [INTERNAL PAUSING LOGIC] ---
                // This simulates the consumer being busy processing a chunk.
                vadAdapter.pause();

                const chunkIndex = chunkCounter++;
                const chunkDuration = PCMConverter.getPcmDurationInSeconds(chunk);
                savedChunkDurations.push(chunkDuration);

                const outputFileName = `${baseOutputName}_chunk_${chunkIndex}.wav`;
                const outputFilePath = path.join(TEST_OUTPUT_DIR, outputFileName);

                process.stdout.write('\n');
                console.log(`[CHUNK ${chunkIndex}] Received. Duration: ${chunkDuration.toFixed(2)}s.`);
                
                // Simulate processing time
                const processingTime = getRandomDuration(3000, 5000) * 0.1;
                console.log(`[INTERNAL] Paused. Simulating processing for ${processingTime}ms...`);
                await sleep(processingTime);
                
                // Save the file after the simulated processing
                await fsp.writeFile(outputFilePath, PCMConverter.encodeRawPcmToWav(chunk));
                console.log(`[INTERNAL] Chunk saved. Resuming stream.`);
                
                vadAdapter.resume();
                // --- [END INTERNAL PAUSING] ---
            });

            vadAdapter.on('finish', () => {
                cleanupAndSignal(); // Signal the external pausing loop to stop
                process.stdout.write('\n');
                console.log("\n[INFO] Pipeline finished. Verifying output...");

                assert(chunkCounter > 0, "TEST FAILED: No chunks were produced.");
                console.log(`  [PASS] Produced ${chunkCounter} audio chunk(s).`);

                const allButLastChunk = savedChunkDurations.slice(0, -1);
                if (allButLastChunk.length > 0) {
                    allButLastChunk.forEach((duration, i) => {
                        assert(
                            duration >= vadOptions.minChunkDurationSeconds,
                            `TEST FAILED: Chunk ${i} duration (${duration.toFixed(2)}s) is SHORTER than default min spec (${vadOptions.minChunkDurationSeconds}s)`
                        );
                        assert(
                            duration <= vadOptions.maxChunkDurationSeconds + 1, // Tolerance
                            `TEST FAILED: Chunk ${i} duration (${duration.toFixed(2)}s) is LONGER than default max spec (${vadOptions.maxChunkDurationSeconds}s)`
                        );
                    });
                     console.log(`  [PASS] All intermediate chunks have valid durations.`);
                }
                
                const totalInputDuration = vadAdapter.getTotalSecondsProcessed();
                const totalOutputDuration = savedChunkDurations.reduce((sum, duration) => sum + duration, 0);
                const durationDifference = totalInputDuration - totalOutputDuration;

                console.log("\n[INFO] Duration Comparison:");
                console.log(`  - Total Input Duration (from VAD input):  ${totalInputDuration.toFixed(3)}s`);
                console.log(`  - Total Output Duration (sum of chunks): ${totalOutputDuration.toFixed(3)}s`);
                console.log(`  - Difference (Input - Output):              ${durationDifference.toFixed(3)}s`);

                resolve(1);
            });
            
            const handleError = (origin, err) => {
                cleanupAndSignal();
                reject(new Error(`Error from ${origin}: ${err.message}`));
            };
            pcmConverter.on('error', (err) => handleError('PCMConverter', err));
            vadAdapter.on('error', (err) => handleError('VadAdapter', err));

            // Start the pipeline
            pcmConverter.pipe(vadAdapter);

            // Start the external random pausing routine concurrently
            //startRandomExternalPausing(vadAdapter, stopPausingSignal);
        });

        console.log("\n--- VAD Adapter Pipeline Test Complete: SUCCESS ---");
    } catch (error) {
        console.error("\n--- VAD Adapter Pipeline Test Complete: FAILED ---");
        console.error(error);
        throw error;
    }
}

// Export the function instead of calling it directly.
export { runVadTests };