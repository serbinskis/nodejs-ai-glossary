import json
import os
import glob
import re
import lmstudio as lms
import pandas as pd
import stanza
from functools import lru_cache


stanza.download('lv')
nlp = stanza.Pipeline('lv', processors='tokenize,lemma')

def remove_english_brackets(text):
    if not text: return ""
    return re.sub(r'\(([A-Za-z\s]+)\)', '', text)

@lru_cache(maxsize=10000)
def normalize_term(term):
    if not term: return ""
    term = str(term).lower().strip()
    term = re.sub(r'[^a-z0-9āčēģīķļņšūž\s]', '', term)
    if not term: return ""
    doc = nlp(term.lower())
    return " ".join([word.lemma for sent in doc.sentences for word in sent.words])

def run_evaluation():
    goldset_file = os.path.join('..', 'goldset', 'Vardnica.json')
    output_folder = os.path.join('..', 'output')
    export_file = 'LAT_metrics.json'

    if not os.path.exists(goldset_file):
        print(f"Error: Goldset not found at {goldset_file}")
        return

    with open(goldset_file, 'r', encoding='utf-8') as f:
        gold_data = json.load(f)
        gold_terms_raw = [entry['term'] for entry in gold_data.get('entries', [])]
        gold_set = {normalize_term(t) for t in gold_terms_raw if t}

    results = []
    llm_only = lms.list_downloaded_models("llm")

    search_path = os.path.join(output_folder, "LAT_*.json")
    for file_path in glob.glob(search_path):
        with open(file_path, 'r', encoding='utf-8') as f:
            try: data = json.load(f)
            except json.JSONDecodeError: continue

            output_entries = data.get('glossary', [])
            output_terms_raw = [e.get('term', '') for e in output_entries]
            output_set = {normalize_term(t) for t in output_terms_raw if t}

            tp_set = output_set.intersection(gold_set)
            fp_set = output_set - gold_set
            fn_set = gold_set - output_set

            tp = len(tp_set)
            fp = len(fp_set)
            fn = len(fn_set)

            precision = (tp / (tp + fp)) if (tp + fp) > 0 else 0
            recall = (tp / (tp + fn)) if (tp + fn) > 0 else 0
            f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0

            impl = data.get('implementation', '')
            model_name = "Unknown"
            quant = "Unknown"

            if '/' in impl:
                model_part = impl.split('/')[-1]
                if '@' in model_part: model_name, quant = model_part.split('@')
                else: model_name = model_part

            debug = data.get('debug_info', {})
            errorc = data.get('error_count', 0)
            chunks = debug.get('chunkCount', 0)
            full_name = impl.split('-', 1)[-1].split('@')[0]
            model_info = next((m.info for m in llm_only if full_name == m.info.model_key), full_name)
            match = re.search(r"(\d+\.?\d*)", model_info.params_string)
            if match: params = float(match.group(1))

            row = {
                "filename": os.path.basename(file_path),
                "model": model_name,
                "display": model_info.display_name,
                "params": params,
                "quantization": quant,
                "error": round(errorc / chunks * 100, 1) if chunks > 0 else 0,
                "errors": errorc,
                "chunks": debug.get('chunkCount', 0),
                "precision": round(precision * 100, 1),
                "recall": round(recall * 100, 1),
                "f1": round(f1 * 100, 1),
                "tp": tp,
                "fp": fp,
                "fn": fn,
                "extract_total": len(output_set),
                "gold_total": len(gold_set),
                "time_min": round(debug.get('elapsedTime', 0) / 60, 1),
                "chunk_size": round(debug.get('chunkSize', 0), 1),
                "safe_margin": round(debug.get('safeMargin', 0), 1),
                "contextLength": debug.get('contextLength', 0),
                "temperature": debug.get('temperature', 0),
                "mvision": model_info.vision or False,
                "mtools": model_info.trained_for_tool_use or False
            }
            results.append(row)

    if not results: return print("No LAT_ files found or processed.")

    df = pd.DataFrame(results)
    df = df.sort_values(by=["error", "f1"], ascending=[True, False])
    cols = ['filename', 'model', 'display', 'params', 'quantization', 'error', 'errors', 'chunks', 'precision', 'recall', 'f1', 'tp', 'fp', 'fn', 'extract_total', 'gold_total', 'time_min', 'chunk_size']
    print(df[cols].to_string(index=False))

    with open(export_file, 'w', encoding='utf-8') as out_f:
        json.dump(results, out_f, indent=2)
        print(f"\nSaved {len(results)} records to {export_file}")

    with open(os.path.splitext(export_file)[0] + '.txt', 'w', encoding='utf-8') as f:
        f.write(df.to_string(index=False))
        print(f"Saved {len(results)} records to {os.path.basename(f.name)}")

if __name__ == "__main__":
    run_evaluation()