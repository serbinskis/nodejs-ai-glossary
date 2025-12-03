interface ChunkState {
    buffer: string;
    chunks: string[];
    limit: number;
}

export class Tokenizer {
    public static MIN_CHUNK_SIZE = 512; // Prevent chunks from becoming impossibly small (e.g., if prompt is huge)

    /**
     * Cleans text by normalizing Unicode, removing control characters,
     * replacing tabs/newlines with spaces, and merging into a single paragraph.
     *
     * @param text - The raw input string
     * @returns A single, cleaned line of text
     */
    public static cleanText(text: string): string {
        return text
            // Normalize Unicode (NFKC form)
            // This fixes compatibility characters (e.g., converts "ℍ𝕖𝕝𝕝𝕠" to "Hello" 
            // or combines separate accent markers).
            .normalize('NFKC')

            // Remove non-printable control characters
            // This regex matches ASCII control codes (0-31) and Delete (127),
            // but EXCLUDES common whitespace (newlines \n, carriage returns \r, tabs \t)
            // because we want to handle those specifically in next step
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')

            // Remove URLs (http, https, or www start, followed by non-whitespace)
            .replace(/(?:https?:\/\/|www\.)[^\s]+/g, '')

            // Replace ALL whitespace sequences with a single space.
            // \s+ matches: spaces, tabs (\t), newlines (\n), and carriage returns (\r).
            // This flattens the paragraph and converts tabs to spaces.
            .replace(/\s+/g, ' ').trim();
    }

    /**
     * Calculates a safe character limit based on the model's token limit.
     * 
     * @param contextSize - The model's context window (e.g., 4096).
     * @param text - The content text (used to calculate density).
     * @param prompt - The instruction prompt (used to calculate overhead cost).
     * @param tokenizer - Optional token counter function.
     * @param safetyMargin - Safety margin for approximate calculations (default 0.1 = 10%).
     */ 
    public static calculateSafeChunkSize(contextSize: number, text?: string, prompt?: string, tokenizer?: (input: string) => number, safetyMargin: number = 0.1): number {
        //Text Tokens = Total Limit − Prompt Tokens
        //Text Chars = Text Tokens * Text Density
        //Text Chars = (Total Limit − Prompt Tokens) * Text Density
        //Text Chars = (Total Limit * Text Density) − (Prompt Tokens * Text Density)

        const textDensity = Tokenizer.getCharsPerToken(text, tokenizer);
        const promptDensity = Tokenizer.getCharsPerToken(prompt, tokenizer);
        const promptTokens = (prompt?.length || 0) / promptDensity;
        const textTokens = Math.max(0, contextSize - promptTokens);
        const textChars = textTokens * textDensity
        const safeLimit = textChars * (1 - safetyMargin);
        return Math.floor(safeLimit);
    }

    /**
     * Prepares fully formatted prompts for the LLM by cleaning the text,
     * calculating the available space (context - prompt cost), and splitting
     * the text into chunks that fit within that space.
     * 
     * @param text - The raw input text to be processed.
     * @param prompt - The system instruction to prepend to every chunk.
     * @param contextSize - The maximum token limit of the model (e.g., 4096).
     * @param tokenizer - Optional function to count tokens accurately.
     */
    public static preparePrompts(text: string, prompt: string, contextSize: number, tokenizer?: (input: string) => number): { chunkSize: number, prompts: string[] } {
        const clean = Tokenizer.cleanText(text);
        const totalSafeChars = Tokenizer.calculateSafeChunkSize(contextSize, clean, prompt, tokenizer);
        const chunkSize = Math.max(Tokenizer.MIN_CHUNK_SIZE, totalSafeChars); //Cannot allow too small chunk sizes
        return { chunkSize, prompts: Tokenizer.chunkText(clean, chunkSize, false).map(chunk => `${prompt}\n\n${chunk}`) }
    }

    /**
     * Determines the density of text.
     * Hierarchy: Real Tokenizer -> Text Analysis -> Hardcoded Safe Fallback
     */
    public static getCharsPerToken(text?: string, tokenizer?: (input: string) => number): number {
        // --- PRIORITY 1: Exact Calculation (Tokenizer provided) ---
        if (text && tokenizer) {
            try {
                // We take a large sample (5000 chars) to be fast but accurate.
                // We don't need to tokenize 1MB just to get a ratio.
                const sample = text.slice(0, 5000);
                const tokenCount = tokenizer(sample);
                if (tokenCount > 0) { return sample.length / tokenCount; }
            } catch (e) {
                console.warn("Tokenizer failed, falling back to heuristics.", e);
            }
        }

        // --- PRIORITY 2: Heuristic Analysis (Text provided) ---
        if (text) {
            // Take a sample for analysis
            const sample = text.slice(0, 5000);

            // Check for Code (high density of symbols = low chars per token)
            // Symbols like { } ; ( ) [ ]
            const codeSymbols = (sample.match(/[\{\}\(\)\[\];=<>]/g) || []).length;
            const isCode = (codeSymbols / sample.length) > 0.5; // > 5% symbols

            // Check for Complex Language (Non-ASCII = low chars per token)
            // Cyrillic, Latvian accents, emojis, etc.
            const nonAscii = (sample.match(/[^\x00-\x7F]/g) || []).length;
            const isComplex = (nonAscii / sample.length) > 0.5; // > 5% non-English

            if (isCode) { return 3.1; }      // Code is dense
            if (isComplex) { return 2.8; }   // Latvian/Russian/Complex is dense
            return 3.8;                      // Standard English is airy (~4)
        }

        // --- PRIORITY 3: Safe Fallback (Nothing provided) ---
        return 2.5;
    }

    /**
     * Splits text into chunks based on contextSize.
     * Hierarchy: Sentence -> Word -> Char.
     * Logic:
     * 1. Try to fit sentence in current buffer.
     * 2. If it fits in a NEW buffer, flush old buffer and move sentence there.
     * 3. If too big for ANY buffer, split into words (flush first if words are small).
     * 4. If word is too big, slice characters.
     */
    public static chunkText(text: string, chunkSize: number, clean: boolean = true): string[] {
        if (clean) { text = this.cleanText(text); }

        // Initialize the state for this specific execution
        const state: ChunkState = { buffer: "", chunks: [], limit: chunkSize };

        // Split by Sentence (keep delimiters attached)
        // Matches: content followed by .!? OR content at end of string
        const sentences = text.match(/[^.!?]*[.!?]+(?:\s+|$)|[^.!?]+$/g) || [text];

        // Process recursive adding
        for (const sentence of sentences) {
            this.processUnit(sentence, 'sentence', state);
        }

        // Flush remaining buffer
        if (state.buffer.length > 0) {
            state.chunks.push(state.buffer.trim());
        }

        return state.chunks;
    }

    /**
     * Recursive helper to process text units.
     */
    private static processUnit(text: string, level: 'sentence' | 'word' | 'char', state: ChunkState) {
        const len = text.length;
        // 1. IF IT FITS IN BUFFER: Just add it.
        if (state.buffer.length + len <= state.limit) {
            return state.buffer += text;
        }

        // 2. IF IT FITS IN A FRESH CHUNK:
        // Since it didn't fit in step 1, we flush the old buffer and start fresh.
        // We do NOT split just to fill the gap.
        if (len <= state.limit) {
            if (state.buffer.length > 0) {
                state.chunks.push(state.buffer.trim());
                state.buffer = "";
            }
            return state.buffer = text;
        }

        // 3. IF IT IS MASSIVE (> LIMIT): We must split it down.
        if (level === 'sentence') {
            const words = text.split(' ');
            
            // LOOKAHEAD CHECK:
            // If the first word is a normal word (fits in limit), we FLUSH the buffer.
            // We don't want "normal" words filling the tiny gap of the previous sentence.
            // If the first word is GIANT (> limit), we keep the buffer to let 'char' slicing fill it.
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
            // It is a GIANT WORD (larger than limit). 
            // We fill the gap with characters.
            let i = 0;
            while (i < len) {
                const spaceLeft = state.limit - state.buffer.length;
                
                // If buffer is full (spaceLeft=0), we take a full chunk
                const sliceSize = (spaceLeft > 0) ? spaceLeft : state.limit;
                
                const slice = text.slice(i, i + sliceSize);

                // Direct append logic for chars to avoid infinite recursion
                if (state.buffer.length + slice.length <= state.limit) {
                    state.buffer += slice;
                } else {
                    // Should theoretically not happen due to slice math, but safety first
                    if (state.buffer.length > 0) state.chunks.push(state.buffer.trim());
                    state.buffer = slice;
                }

                // If buffer full, flush immediately
                if (state.buffer.length >= state.limit) {
                     state.chunks.push(state.buffer.trim());
                     state.buffer = "";
                }

                i += sliceSize;
            }
        }
    }
}