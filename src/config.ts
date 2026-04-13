
import path from 'path';
import publicIp from 'qiao-get-ip';
import { fileURLToPath } from 'url';
import { cpus } from 'os';
import { LlamaModelOptions, LlamaOptions } from 'node-llama-cpp';
import { VAD_OPTIONS_DEFAULT } from './whisper/vad_adapter.js';
import { WhisperOptions } from './whisper/whisper.js';

const configuration = {
    DEBUG: true,
    SOURCE_DIRECTORY: path.resolve(path.dirname(fileURLToPath(import.meta.url))),
    BASE_DIRECTORY: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    UPLAOD_DIRECTORY: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads'),
    EXPERIMENTS_DIRECTORY: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'experiments'),
    DATABASE_FILEPATH: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'database', 'database.db'),
    HTTP_PORT: 8080,
    HTTPS_PORT: 8443,

    WORKER_COUNT: 1,
    GLOSSARY_MODEL: 'LiquidAI/LFM2-1.2B-GGUF/LFM2-1.2B-Q8_0.gguf',
    GLOSSARY_OPTIONS: { model: { modelPath: null, gpuLayers: 'auto' }, llama: { gpu: 'vulkan' } } as unknown as { llama: LlamaOptions, model: LlamaModelOptions },
    GEMINI_API_KEY: (process.env.GEMINI_API_KEY || '').split(';')[0],
    OPENAI_API_KEY: (process.env.OPENAI_API_KEY || '').split(';')[0],

    WHISER_OPTIONS: { modelName: 'ggml-large-v3.bin' , gpu: true, threads: 8, beamSize: 5, temperature: 0, language: 'auto', backend: 'vulkan' } as WhisperOptions,
    VAD_ADAPTER_OPTIONS: VAD_OPTIONS_DEFAULT,

    MAX_FILENAME_LENGTH: 250,
    PUBLIC_IP_ADDRESS: null as unknown as string,
    HASH_REGEX: new RegExp(/^[a-f0-9]{64}$/i),
    UUIDV4_REGEX: new RegExp(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i),
    UUID_REGEX: new RegExp(/^(?:[0-9A-F]{32})?$/i),

    LMSTUDIO: {
        DEFAULT_PROMPT: 'Your task is to analyze the provided text and create a glossary.\n' +
                        'Instructions:\n' +
                        '1. Extract ALL terms and concepts from the text.\n' +
                        '2. Define them using ONLY the provided text.\n' +
                        '3. NO external knowledge. Synthesize exclusively from source.\n' +
                        '4. DO NOT translate. Keep definitions in the source language.\n' +
                        '5. If no terms found, return an empty list.\n\n' +
                        'Text to analyze:\n\n',
        DEFAULT_MODEL: 'google/gemma-2-9b',
        CPU_THREADS: Math.max(1, cpus().length - 1),
        DEDUPLICATE: true,
        FLASH_ATTENTION: true,
        DEFAULT_CONTEXT: 8192,
        DEFAULT_TEMPERATURE: 0.5,
        DEFAULT_STRCUTRED_TOKENS: 0,
        MIN_PROCESS_SIZE: 100,
        DEFAULT_SAFE_MARGIN: 0.5,
        MAX_RESPONSE_TOKENS: 4000,
        REPEAT_PENALTY: -1,
        ERROR_RETRY_COUNT: 0,
        TIMEOUT: 5 * 60 * 1000,
        SEED: 42,
    },

    DATABASE_TABLES: {
        'files': [
            { name: 'hash', type: 'TEXT', pkey: true },
            { name: 'filename', type: 'TEXT' },
            { name: 'content_type', type: 'TEXT' },
            { name: 'size', type: 'INTEGER' },
            { name: 'extracted_text', type: 'TEXT' },
            { name: 'extracted_glossary', type: 'TEXT' },
            { name: 'glossary_implementation', type: 'TEXT', sensitive: true },
            { name: 'ip_address', type: 'TEXT', sensitive: true },
            { name: 'creation_date', type: 'INTEGER' },
            { name: 'access_date', type: 'INTEGER', sensitive: true },
        ],
        'activity': [
            { name: 'hash', type: 'TEXT', pkey: true },
            { name: 'glossary_hash_combination', type: 'TEXT' },
            { name: 'glossary_hash', type: 'TEXT' },
            { name: 'entry_uid', type: 'TEXT' },
            { name: 'event', type: 'TEXT' },
            { name: 'data', type: 'TEXT' },
            { name: 'ip_address', type: 'TEXT', sensitive: true },
            { name: 'creation_date', type: 'INTEGER' },
        ],
        'users': [
            { name: 'ip_address', type: 'TEXT', pkey: true },
            { name: 'banned', type: 'INTEGER', default_value: 0 },
            { name: 'creation_date', type: 'INTEGER' },
            { name: 'access_date', type: 'INTEGER', sensitive: true },
        ]
    } as const,
};

const ERROR_CODES = {
    '200.0': { code: 200, message: 'The operation completed successfully.' },
    '400.0': { code: 400, message: 'Bad Request.' },
    '400.1': { code: 400, message: 'Bad Request: "hashes" must be a non-empty array of strings of sha256.' },
    '400.2': { code: 400, message: `Bad Request: Filename too short or too long.` },
    '400.3': { code: 400, message: `Bad Request: Unsuported file type or file size.` },
    '400.4': { code: 400, message: `Bad Request: Incorrect queue identifier.` },
    '403.0': { code: 403, message: 'Access Forbidden.' },
    '403.1': { code: 403, message: 'Invalid IP Address.' },
    '404.0': { code: 404, message: 'Not Found.' },
    '444.0': { code: 444, message: 'No Response.' },
    '500.0': { code: 500, message: 'Internal Server Error.' },
    '503.0': { code: 503, message: 'Service Unavailable.' },
} as const;

const config = {
    ...configuration,
    ERROR_CODES: Object.freeze(ERROR_CODES) as typeof ERROR_CODES,
};

(async function get_ip() {
    try { config.PUBLIC_IP_ADDRESS = await publicIp.getIp(); }
    catch (err) { console.log("[CONFIG] -> Failed to get public IP:", err); }
    finally { setTimeout(get_ip, 5 * 60 * 1000); }
})();

export default config;