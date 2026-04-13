import path from "path";
import config from "../config.js";
import { GlossaryFactory } from "../glossary/factory.js";
import { Tokenizer } from "../glossary/tokenizer.js";
import { getProcessor } from "../supported.js";

(async () => {
    console.log(Tokenizer.chunkText("This is a test!!! Is it working???  a...   .  Yes, it is working... Let's see how it handles multiple punctuation!!! Right???", 100));
    console.log(Tokenizer.chunkIntoSentences("This is a test!!! Is it working???  a....  .   Yes, it is working... Let's see how it handles multiple punctuation!!! Right???", 1000));

    let test = "Mākslīgais superintelekts ir intelekts, kas pārspēj cilvēka spējas (Russell and Norvig, 2020) un līdz ar to ir gudrāks par jebkuru cilvēka prātu jebkurā jomā, ieskaitot zinātnisko radošumu, vispārīgu gudrību un sociālās prasmes (Bostrom, 2015). o	Plānošana – darbību secības izstrāde, kas sasniegs mērķu kopumu, ņemot vērā noteiktus sākuma nosacījumus un izpildes laika ierobežojumus."
    test = test.repeat(100);

    let filename = "LAT_konspekts.docx";
    const inputf = path.join(config.EXPERIMENTS_DIRECTORY, "exper1", "input", filename);
    const text = await getProcessor(inputf)?.extractText();
    console.log(Tokenizer.splitSentences(text as string));
})();