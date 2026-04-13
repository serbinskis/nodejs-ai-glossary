interface ChunkState {
    buffer: string;
    chunks: string[];
    sentences: string[];
    limit: number;
}

declare global {
    interface String {
        fixPunctuation(): string;
    }
}

export class Tokenizer {
    public static MIN_CHUNK_SIZE = 512;

    static {
        String.prototype.fixPunctuation = function (): string {
            return Tokenizer.fixPunctuation(this.toString());
        };
    }

    public static fixPunctuation(text: string): string {
        return text
            .replace(/\s+([.,!?;:])/g, '$1')

            .replace(/([(\["“])\s+/g, '$1')

            .replace(/\s+([)\]"”])/g, '$1')

            .replace(/([)\]"”])([(\["“])/g, '$1 $2')
    }


    public static cleanText(text: string): string {
        return text
            .normalize('NFKC')

            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')

            .fixPunctuation()

            .replace(/(?:https?:\/\/|www\.)[^\s]+/g, '')

            .replace(/[\p{Extended_Pictographic}\p{So}]/gu, '')

            .replace(/\s+/g, ' ').trim();
    }

    public static async calculateSafeChunkSize(contextSize: number, text?: string, prompt?: string, tokenizer?: (input: string) => Promise<number> | number, safetyMargin: number = 0.1): Promise<number> {

        const textDensity = await Tokenizer.getCharsPerToken(text, tokenizer);
        const promptDensity = await Tokenizer.getCharsPerToken(prompt, tokenizer);
        const promptTokens = (prompt?.length || 0) / promptDensity;
        const textTokens = Math.max(0, contextSize - promptTokens);
        const textChars = textTokens * textDensity
        const safeLimit = textChars * (1 - safetyMargin);
        return Math.floor(safeLimit);
    }

    public static async preparePrompts(text: string, prompt: string, contextSize: number, tokenizer?: (input: string) => Promise<number> | number, safetyMargin?: number): Promise<{ chunkSize: number, prompts: string[] }> {
        const clean = Tokenizer.cleanText(text);
        const totalSafeChars = await Tokenizer.calculateSafeChunkSize(contextSize, clean, prompt, tokenizer, safetyMargin);
        const chunkSize = Math.max(Tokenizer.MIN_CHUNK_SIZE, totalSafeChars);
        return { chunkSize, prompts: Tokenizer.chunkText(clean, chunkSize, false).map(chunk => `${prompt}${chunk}`) }
    }

    public static async countTokens(text: string, tokenizer?: (input: string) => Promise<number> | number): Promise<number> {
        if (tokenizer) { return await tokenizer(text); }
        let charsPerToken = await Tokenizer.getCharsPerToken(text);
        return Math.ceil(text.length / charsPerToken);
    }

    public static async getCharsPerToken(text?: string, tokenizer?: (input: string) => Promise<number> | number): Promise<number> {
        if (text && tokenizer) {
            try {
                const sample = text.slice(0, 5000);
                const tokenCount = await tokenizer(sample);
                if (tokenCount > 0) { return sample.length / tokenCount; }
            } catch (e) {
                console.warn("Tokenizer failed, falling back to heuristics.", e);
            }
        }

        if (text) {
            const sample = text.slice(0, 5000);

            const codeSymbols = (sample.match(/[\{\}\(\)\[\];=<>]/g) || []).length;
            const isCode = (codeSymbols / sample.length) > 0.05;

            const nonAscii = (sample.match(/[^\x00-\x7F]/g) || []).length;
            const isComplex = (nonAscii / sample.length) > 0.05;

            if (isCode) { return 3.1; }
            if (isComplex) { return 2.8; }
            return 3.8;
        }

        return 4;
    }

    public static chunkText(text: string, chunkSize: number, clean: boolean = true): string[] {
        if (chunkSize <= 0) { throw new Error("Size must be a positive number."); }
        if (clean) { text = this.cleanText(text); }

        const state: ChunkState = { buffer: "", chunks: [], sentences: [], limit: chunkSize };

        let sentences = this.splitSentences(text, false);

        sentences = sentences.filter(s => (s.length > 5) && s.includes(' '));

        sentences.forEach(sentence => this.processUnit(sentence, 'sentence', state));

        if (state.buffer.length > 0) { state.chunks.push(state.buffer.trim()); }

        return state.chunks;
    }

    public static chunkIntoSentences(text: string, max: number, clean: boolean = true): string[] {
        if (max <= 0) { throw new Error("Size must be a positive number."); }
        if (clean) { text = this.cleanText(text); }

        const state: ChunkState = { buffer: "", chunks: [], sentences: [], limit: max };

        const sentences = this.splitSentences(text, false);

        for (const sentence of sentences) {
            this.processUnit(sentence, 'sentence', state);
            state.sentences.push(...state.chunks.map(c => c.trim()));
            if (state.buffer.length > 0) { state.sentences.push(state.buffer.trim()); }
            state.chunks = [];
            state.buffer = '';
        }

        return state.sentences.filter(s => (s.length > 5) && s.includes(' '));
    }

    public static splitSentences(text: string, clean: boolean = true): string[] {
        if (clean) { text = this.cleanText(text); }
        if (!text) { return []; }




        const abbreviations = [
            'Dr', 'Prof', 'Mr', 'Mrs', 'Ms', 'Rev', 'Jr', 'Sr', 'St',
            'etc', 'vs', 'e.g', 'i.e', 'et al', 'ca', 'Corp', 'Inc', 'Ltd',
            'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
            'janv', 'febr', 'apr', 'jūn', 'jūl', 'aug', 'sept', 'okt', 'nov', 'dec',
            'pirmd', 'otrd', 'trešd', 'ceturtd', 'piektd', 'sestd', 'svētd',
            'utt', 'piem', 'gs', 'g', 'lpp', 'tālr', 'resp', 'u.c', 'plkst', 'u.tml', 'tūkst', 'nr',
        ];

        const abbrevPattern = `\\b(?:${abbreviations.join('|')})\\.`;
        const initialismPattern = `[A-Za-z]\\.[A-Za-z]\\.|(^|\\s)[A-Za-z]\\.`;

        const regex = new RegExp(`(?<!${abbrevPattern}|${initialismPattern})(?<=[.?!])(?=\\s+|[A-ZĀ-Ž])`, 'gi');
        const sentences = text.split(regex).map(s => s?.trim()).filter(s => s?.length > 0);

        for (let i = 0; i < sentences.length - 1; i++) {
            if (/\d\.$/.test(sentences[i]) && /^\p{Ll}/u.test(sentences[i + 1])) {
                sentences[i] = sentences[i] + ' ' + sentences[i + 1];
                sentences.splice(i + 1, 1);
                i--;
            }
        }

        return sentences;
    }

    private static processUnit(text: string, level: 'sentence' | 'word' | 'char', state: ChunkState) {
        if (level === 'sentence') { text = text.trim() + ' '; }
        const len = text.length;

        if (state.buffer.length + len <= state.limit) {
            return state.buffer += text;
        }

        if (len <= state.limit) {
            if (state.buffer.length > 0) {
                state.chunks.push(state.buffer.trim());
                state.buffer = "";
            }
            return state.buffer = text;
        }

        if (level === 'sentence') {
            const words = text.split(' ');

            if (state.buffer.length > 0 && words.length > 0) {
                if (words[0].length <= state.limit) {
                    state.chunks.push(state.buffer.trim());
                    state.buffer = "";
                }
            }

            for (let i = 0; i < words.length; i++) {
                const suffix = (i === words.length - 1) ? '' : ' ';
                this.processUnit(words[i] + suffix, 'word', state);
            }
        }
        else if (level === 'word') {
            let i = 0;
            while (i < len) {
                const spaceLeft = state.limit - state.buffer.length;

                const sliceSize = (spaceLeft > 0) ? spaceLeft : state.limit;
                const slice = text.slice(i, i + sliceSize);

                if (state.buffer.length + slice.length <= state.limit) {
                    state.buffer += slice;
                } else {
                    if (state.buffer.length > 0) { state.chunks.push(state.buffer.trim()); }
                    state.buffer = slice;
                }

                if (state.buffer.length >= state.limit) {
                     state.chunks.push(state.buffer.trim());
                     state.buffer = "";
                }

                i += sliceSize;
            }
        }
    }
}