import * as path from 'path';

import { FileProcessor } from './processors/file_processor.js';
import { ImageProcessor } from './processors/image_processor.js';
import { PdfProcessor } from './processors/pdf_processor.js';
import { WordOpenXMLProcessor } from './processors/word_openxml_processor.js';
import { WordOpenDocumentProcessor } from './processors/word_opendocument_processor.js';
import { WordRtfProcessor } from './processors/word_rtf_processor.js';
import { WordDocProcessor } from './processors/word_doc_processor.js';
import { PowerPointOpenXMLProcessor } from './processors/powerpoint_openxml_processor.js';
import { PowerPointOpenDocuemntProcessor } from './processors/powerpoint_opendocuemnt_processor.js';
import { AudioProcessor } from './processors/audio_processor.js';

export enum ValidationType {
    IS_SUPPORTED = 'IS_SUPPORTED',
    NO_PROCESSOR = 'NO_PROCESSOR',
    INVALID_EXTENSION = 'INVALID_EXTENSION',
    INVALID_HEADER = 'INVALID_HEADER',
    INVALID_SIZE = 'INVALID_SIZE',
}

const MAX_SIZE_TEXT = 0.1 * 1024 * 1024;
const MAX_SIZE_DOCUMENT = 20 * 1024 * 1024;
const MAX_SIZE_PDF = 30 * 1024 * 1024;
const MAX_SIZE_IMAGE = 10 * 1024 * 1024;
const MAX_SIZE_AUDIO = 100 * 1024 * 1024;
const MAX_SIZE_VIDEO = 1024 * 1024 * 1024;

interface SupportedInfo {
    description: string;
    headers: Buffer[];
    max_filesize: number;
    processor: any;
    offset?: number;
}

const SUPPORTED_FORMATS: Record<string, SupportedInfo> = {
    ".txt": {
        description: "Plain Text File",
        headers: [],
        max_filesize: MAX_SIZE_TEXT,
        processor: FileProcessor,
    },

    ".docx": {
        description: "Microsoft Word OpenXML Document",
        headers: [Buffer.from([0x50, 0x4B, 0x03, 0x04])],
        max_filesize: MAX_SIZE_DOCUMENT,
        processor: WordOpenXMLProcessor,
    },
    ".dotx": {
        description: "Microsoft Word OpenXML Template",
        headers: [Buffer.from([0x50, 0x4B, 0x03, 0x04])],
        max_filesize: MAX_SIZE_DOCUMENT,
        processor: WordOpenXMLProcessor,
    },
    ".docm": {
        description: "Microsoft Word Macro-Enabled Document",
        headers: [Buffer.from([0x50, 0x4B, 0x03, 0x04])],
        max_filesize: MAX_SIZE_DOCUMENT,
        processor: WordOpenXMLProcessor,
    },
    ".dotm": {
        description: "Microsoft Word Macro-Enabled Template",
        headers: [Buffer.from([0x50, 0x4B, 0x03, 0x04])],
        max_filesize: MAX_SIZE_DOCUMENT,
        processor: WordOpenXMLProcessor,
    },
    ".doc": {
        description: "Microsoft Word 97–2003 Document",
        headers: [Buffer.from([0xD0, 0xCF, 0x11, 0xE0])],
        max_filesize: MAX_SIZE_DOCUMENT,
        processor: WordDocProcessor,
    },
    ".dot": {
        description: "Microsoft Word 97–2003 Template",
        headers: [Buffer.from([0xD0, 0xCF, 0x11, 0xE0])],
        max_filesize: MAX_SIZE_DOCUMENT,
        processor: WordDocProcessor,
    },
    ".odt": {
        description: "OpenDocument Text",
        headers: [Buffer.from([0x50, 0x4B, 0x03, 0x04])],
        max_filesize: MAX_SIZE_DOCUMENT,
        processor: WordOpenDocumentProcessor,
    },
    ".rtf": {
        description: "Rich Text Format",
        headers: [Buffer.from([0x7B, 0x5C, 0x72, 0x74])],
        max_filesize: MAX_SIZE_DOCUMENT,
        processor: WordRtfProcessor,
    },

    ".pptx": {
        description: "PowerPoint Presentation OpenXML Document",
        headers: [Buffer.from([0x50, 0x4B, 0x03, 0x04])],
        max_filesize: MAX_SIZE_DOCUMENT,
        processor: PowerPointOpenXMLProcessor,
    },
    ".potx": {
        description: "PowerPoint Presentation OpenXML Template",
        headers: [Buffer.from([0x50, 0x4B, 0x03, 0x04])],
        max_filesize: MAX_SIZE_DOCUMENT,
        processor: PowerPointOpenXMLProcessor,
    },
    ".pptm": {
        description: "PowerPoint Presentation Macro-Enabled Presentation",
        headers: [Buffer.from([0x50, 0x4B, 0x03, 0x04])],
        max_filesize: MAX_SIZE_DOCUMENT,
        processor: PowerPointOpenXMLProcessor,
    },
    ".potm": {
        description: "PowerPoint Presentation Macro-Enabled Template",
        headers: [Buffer.from([0x50, 0x4B, 0x03, 0x04])],
        max_filesize: MAX_SIZE_DOCUMENT,
        processor: PowerPointOpenXMLProcessor,
    },
    ".ppt": {
        description: "PowerPoint 97–2003 Presentation",
        headers: [Buffer.from([0xD0, 0xCF, 0x11, 0xE0])],
        max_filesize: MAX_SIZE_DOCUMENT,
        processor: null,
    },
    ".odp": {
        description: "OpenDocument Presentation",
        headers: [Buffer.from([0x50, 0x4B, 0x03, 0x04])],
        max_filesize: MAX_SIZE_DOCUMENT,
        processor: PowerPointOpenDocuemntProcessor,
    },

    ".pdf": {
        description: "Portable Document Format",
        headers: [Buffer.from("%PDF")],
        max_filesize: MAX_SIZE_PDF,
        processor: PdfProcessor,
    },

    ".jpg": {
        description: "JPEG Image",
        headers: [Buffer.from([0xFF, 0xD8, 0xFF])],
        max_filesize: MAX_SIZE_IMAGE,
        processor: ImageProcessor,
    },
    ".jpeg": {
        description: "JPEG Image",
        headers: [Buffer.from([0xFF, 0xD8, 0xFF])],
        max_filesize: MAX_SIZE_IMAGE,
        processor: ImageProcessor,
    },
    ".png": {
        description: "PNG Image",
        headers: [Buffer.from([0x89, 0x50, 0x4E, 0x47])],
        max_filesize: MAX_SIZE_IMAGE,
        processor: ImageProcessor,
    },
    ".gif": {
        description: "GIF Image",
        headers: [Buffer.from("GIF8")],
        max_filesize: MAX_SIZE_IMAGE,
        processor: ImageProcessor,
    },
    ".bmp": {
        description: "Bitmap Image",
        headers: [Buffer.from("BM")],
        max_filesize: MAX_SIZE_IMAGE,
        processor: ImageProcessor,
    },
    ".tiff": {
        description: "TIFF Image",
        headers: [Buffer.from([0x49, 0x49, 0x2A, 0x00]), Buffer.from([0x4D, 0x4D, 0x00, 0x2A])],
        max_filesize: MAX_SIZE_IMAGE,
        processor: ImageProcessor,
    },
    ".tif": {
        description: "TIFF Image",
        headers: [Buffer.from([0x49, 0x49, 0x2A, 0x00]), Buffer.from([0x4D, 0x4D, 0x00, 0x2A])],
        max_filesize: MAX_SIZE_IMAGE,
        processor: ImageProcessor,
    },
    ".webp": {
        description: "WebP Image",
        headers: [Buffer.from("RIFF")],
        max_filesize: MAX_SIZE_IMAGE,
        processor: ImageProcessor,
    },

    ".mp3": {
        description: "MP3 Audio",
        headers: [Buffer.from("ID3"), Buffer.from([0xFF, 0xFB])],
        max_filesize: MAX_SIZE_AUDIO,
        processor: AudioProcessor,
    },
    ".wav": {
        description: "WAV Audio",
        headers: [Buffer.from("RIFF")],
        max_filesize: MAX_SIZE_AUDIO,
        processor: AudioProcessor,
    },
    ".flac": {
        description: "FLAC Audio",
        headers: [Buffer.from("fLaC")],
        max_filesize: MAX_SIZE_AUDIO,
        processor: AudioProcessor,
    },
    ".ogg": {
        description: "OGG Audio",
        headers: [Buffer.from("OggS")],
        max_filesize: MAX_SIZE_AUDIO,
        processor: AudioProcessor,
    },
    ".m4a": {
        description: "MPEG-4 Audio",
        headers: [Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4D, 0x34, 0x41])],
        max_filesize: MAX_SIZE_AUDIO,
        processor: AudioProcessor,
    },
    ".amr": {
        description: "Adaptive Multi-Rate Audio Codec",
        headers: [Buffer.from("#!AMR\n")],
        max_filesize: MAX_SIZE_AUDIO,
        processor: AudioProcessor,
    },

    ".mp4": {
        description: "MPEG-4 Video",
        headers: [Buffer.from("ftypisom"), Buffer.from("ftypmp42"), Buffer.from("ftypiso2"), Buffer.from("ftypavc1"), Buffer.from("ftypM4V ")],
        max_filesize: MAX_SIZE_VIDEO,
        processor: AudioProcessor,
        offset: 4,
    },
    ".avi": {
        description: "AVI Video",
        headers: [Buffer.from("RIFF")],
        max_filesize: MAX_SIZE_VIDEO,
        processor: AudioProcessor,
    },
    ".mkv": {
        description: "Matroska Video",
        headers: [Buffer.from([0x1A, 0x45, 0xDF, 0xA3])],
        max_filesize: MAX_SIZE_VIDEO,
        processor: AudioProcessor,
    },
    ".mov": {
        description: "QuickTime Video",
        headers: [Buffer.from("ftypqt  ")],
        max_filesize: MAX_SIZE_VIDEO,
        processor: AudioProcessor,
        offset: 4,
    },
    ".flv": {
        description: "Flash Video",
        headers: [Buffer.from("FLV")],
        max_filesize: MAX_SIZE_VIDEO,
        processor: AudioProcessor,
    },
    ".webm": {
        description: "WebM Video",
        headers: [Buffer.from([0x1A, 0x45, 0xDF, 0xA3])],
        max_filesize: MAX_SIZE_VIDEO,
        processor: AudioProcessor,
    },
};

function bufferStartsWith(buf: Buffer, prefix: Buffer): boolean {
    if (!Buffer.isBuffer(buf) || !Buffer.isBuffer(prefix)) { throw new TypeError('Both arguments must be Buffers'); }
    if (prefix.length > buf.length) { return false; }
    return Buffer.compare(buf.subarray(0, prefix.length), prefix) === 0;
}

export function findByExtension(ext: string): SupportedInfo | null {
    return SUPPORTED_FORMATS[ext.toLowerCase()];
}

export function findByHeader(header: Buffer, ext?: string): { ext: string, info: SupportedInfo } | null {
    let entries: [string, SupportedInfo][] = SUPPORTED_FORMATS[ext as string] ? [[ext as string, SUPPORTED_FORMATS[ext as string]]] : Object.entries(SUPPORTED_FORMATS) as [string, SupportedInfo][];

    for (const [ext, info] of entries) {
        const bufferToCheck = header.slice(info.offset ?? 0);
        const hasValidHeader = info.headers.some(sig => bufferStartsWith(bufferToCheck, sig));
        if (hasValidHeader) { return { ext, info }; }
    }

    return null;
}

export function isSupported(filePath: string, filesize: number, header: Buffer): [ValidationType, string] {
    const ext = path.extname(filePath).toLowerCase();
    const extInfo = findByExtension(ext);
    if (!extInfo) { return [ValidationType.INVALID_EXTENSION, ext]; }

    if (filesize > extInfo.max_filesize) { return [ValidationType.INVALID_SIZE, ext]; }
    if (filesize <= 0 || header.length === 0) { return [ValidationType.INVALID_SIZE, ext]; }

    const hasValidHeader = (ext == ".txt") || findByHeader(header, ext);
    if ((extInfo.headers.length > 0) && !hasValidHeader) { return [ValidationType.INVALID_HEADER, ext]; }

    if (!extInfo.processor) { return [ValidationType.NO_PROCESSOR, ext]; }

    return [ValidationType.IS_SUPPORTED, ext];
}


export function getProcessor(source?: string | Buffer): FileProcessor | null {
    if (!source) { throw new Error("Must provide either 'filePath' or 'buffer'."); }
    let info: SupportedInfo | null = null;

    if (typeof source === 'string') {
        info = findByExtension(path.extname(source));
    } else if (source instanceof Buffer) {
        const match = findByHeader(source);
        info = match ? match.info : null;
    }

    if (info?.processor) { return new (info.processor as typeof FileProcessor)(source); }
    return null;
}