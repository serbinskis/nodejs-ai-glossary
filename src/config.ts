
import path from 'path';
import publicIp from 'qiao-get-ip';
import sutils from 'serbinskis-utils';
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
    DATABASE_FILEPATH: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'database', 'database.db'),
    HTTP_PORT: 82,
    HTTPS_PORT: 8445,

    WORKER_COUNT: 2, //Math.max(1, Math.floor(cpus().length/4)), //The amount of threads to process chunk decryption
    GLOSSARY_MODEL: 'LiquidAI/LFM2-1.2B-GGUF/LFM2-1.2B-Q8_0.gguf',
    GLOSSARY_OPTIONS: { model: { modelPath: null, gpuLayers: 'auto' }, llama: { gpu: 'auto' } } as { llama: LlamaOptions, model: LlamaModelOptions },

    WHISER_OPTIONS: { modelName: 'ggml-tiny.bin', gpu: false, threads: 2, beamSize: 5, temperature: 0, language: 'auto' } as WhisperOptions,
    VAD_ADAPTER_OPTIONS: VAD_OPTIONS_DEFAULT,

    MESSAGE_CACHE_TIME: 12*60*60*1000, //We need to reset urls, because they have expiration time (MAX: 20 Hours)
    MAX_FILE_SIZE: 5*1024*1024*1024*1024, //Max size for single file (5TB)
    MAX_FILENAME_LENGTH: 250, //Max length for filename
    CLEANUP_UNUSED_TIME: Number.MAX_SAFE_INTEGER, //365*24*60*60*1000, //Time after which file is considered as unused
    DO_CLEANUP: true, //Delete old unused files and folders
    HOST_BYPASS: true, //Allows host ip to have full access to all files and folders

    MAX_INT32: (Math.pow(2, 31)-1),
    PUBLIC_IP_ADDRESS: null as string,
    ECNRYPTION_ALGORITHM: 'aes-256-ctr',
    ECNRYPTION_KEY: '61dc949b-3554-4b89-a377-91af69734d92', //Used only to prevent discord from scanning files
    HASH_REGEX: new RegExp(/^[a-f0-9]{64}$/i), // Regex for a 64-character SHA-256 hash (case-insensitive).
    UUIDV4_REGEX: new RegExp(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i), // Standard UUIDv4 regex with dashes
    UUID_REGEX: new RegExp(/^(?:[0-9A-F]{32})?$/i), //UUIDv4 regex without '-' symbols and also allows empty strings

    DATABASE_TABLES: {
        'files': [
            { name: 'hash', type: 'TEXT', pkey: true },
            { name: 'filename', type: 'TEXT', },
            { name: 'content_type', type: 'TEXT' },
            { name: 'size', type: 'INTEGER' },
            { name: 'extracted_text', type: 'TEXT' },
            { name: 'extracted_glossary', type: 'TEXT' },
            { name: 'ip_address', type: 'TEXT', sensitive: true, },
            { name: 'creation_date', type: 'INTEGER' },
            { name: 'access_date', type: 'INTEGER', sensitive: true, },
        ],
        'users': [
            { name: 'ip_address', type: 'TEXT', pkey: true },
            { name: 'banned', type: 'INTEGER', default_value: 0 },
            { name: 'creation_date', type: 'INTEGER' },
            { name: 'access_date', type: 'INTEGER', sensitive: true, },
        ]
    } as const, //Must be const for VS IntelliSense
} as const

const ERROR_CODES = {
    '200.0': { code: 200, message: 'The operation completed successfully.' },
    '400.0': { code: 400, message: 'Bad request.' },
    '400.1': { code: 400, message: 'Bad request: "hashes" must be a non-empty array of strings of sha256.' },
    '400.2': { code: 400, message: `Bad request: Filename too short or too long.` },
    '400.3': { code: 400, message: `Bad request: Unsuported file type or too big size.` },
    '400.4': { code: 400, message: `Bad request: Incorrect queue identifier.` },
    '403.0': { code: 403, message: 'Access forbidden.' },
    '403.1': { code: 403, message: 'Invalid IP address.' },
    '403.6': { code: 403, message: `Access forbidden: File is too big (MAX: ${sutils.formatBytes(configuration.MAX_FILE_SIZE, 1)}).` },
    '404.0': { code: 404, message: 'Not found.' },
    '416.0': { code: 416, message: 'Range not satisfiable.' },
    '444.0': { code: 444, message: 'No response.' },
    '500.0': { code: 500, message: 'Internal server error.' },
} as const;

const config = {
    ...configuration,
    ERROR_CODES,
};

(async function get_ip() {
    try { config.PUBLIC_IP_ADDRESS = await publicIp.getIp(); }
    catch (err) { console.log("[CONFIG] -> Failed to get public IP:", err); }
    finally { setTimeout(get_ip, 5 * 60 * 1000); }
})();

export default config;