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

def quant_code_to_bits(code: str):
    if not code: return None
    match = re.match(r"^(?:Q|INT|F|FP|BF|MXFP|MXINT)(\d+)", code.upper())
    if match: return int(match.group(1))
    return None

def parse_filename(filename):
    base = filename.replace(".json", "")
    if "#" in base: model_part, exp_part = base.split("#", 1)
    else: model_part, exp_part = base, None
    model_full = model_part.split("LAT_konspekts.docx-")[-1]

    if "@" in model_full: model_name, quant = model_full.split("@")
    else: model_name, quant = model_full, "unknown"

    category = "unknown"
    value = 0

    if exp_part:
        if exp_part.startswith("temp_"):
            category = "temperature"
            value = exp_part.replace("temp_", "")
        elif exp_part.startswith("rp_"):
            category = "repeat_penalty"
            value = exp_part.replace("rp_", "")
        elif exp_part.startswith("ctx_window_"):
            category = "context_window"
            value = exp_part.replace("ctx_window_", "")
        elif exp_part.startswith("sf_margin_"):
            category = "safe_margin"
            value = exp_part.replace("sf_margin_", "")
        elif exp_part.startswith("quant_"):
            category = "quantization"
            value = exp_part.replace("quant_", "")
            value = quant_code_to_bits(value)

    return model_name, quant, category, value

def run_evaluation():
    goldset_file = os.path.join('..', '..', 'exper1', 'goldset', 'Vardnica.json')
    output_folder = os.path.join('..', 'output')
    export_file = 'LAT_metrics_groups.json'

    if not os.path.exists(goldset_file):
        print(f"Error: Goldset not found at {goldset_file}")
        return

    with open(goldset_file, 'r', encoding='utf-8') as f:
        gold_data = json.load(f)
        gold_terms_raw = [entry['term'] for entry in gold_data.get('entries', [])]
        gold_set = {normalize_term(t) for t in gold_terms_raw if t}

    llm_only = lms.list_downloaded_models("llm")
    results = []
    aggregated = {}

    files = glob.glob(os.path.join(output_folder, "**", "LAT_*.json"), recursive=True)
    if not files: print("No LAT_*.json files found.")
    if not files: return

    for file_path in files:
        with open(file_path, 'r', encoding='utf-8') as f:
            try: data = json.load(f)
            except: continue

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
        debug = data.get('debug_info', {})
        errorc = data.get('error_count', 0)
        chunks = debug.get('chunkCount', 0)

        filename = os.path.basename(file_path)
        model_name, quant, category, value = parse_filename(filename)

        full_name = impl.split('-', 1)[-1].split('@')[0]
        model_info = next((m.info for m in llm_only if full_name in m.info.model_key), None)

        display = model_info.display_name
        match = re.search(r"(\d+\.?\d*)", model_info.params_string)
        if match: params = float(match.group(1))

        row = {
            "filename": filename,
            "model": model_name,
            "display": model_info.display_name,
            "params": params,
            "quantization": quant,
            "category": category,
            "value": value,
            "error": round(errorc / chunks * 100, 1) if chunks > 0 else 0,
            "errors": errorc,
            "chunks": chunks,
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
            "repeat_penalty": debug.get('repeatPenalty', 0)
        }

        results.append(row)
        aggregated.setdefault(model_name, {}).setdefault(category, {})[value] = row

    df = pd.DataFrame(results)
    df = df.sort_values(by=["model", "category", "value"])
    print(df.to_string(index=False))

    with open(export_file, 'w', encoding='utf-8') as out_f:
        json.dump(aggregated, out_f, indent=2)
        print(f"\nSaved {len(results)} records to {export_file}")

    with open(os.path.splitext(export_file)[0] + '.txt', 'w', encoding='utf-8') as f:
        f.write(df.to_string(index=False))
        print(f"\nSaved {len(results)} records to {os.path.basename(f.name)}")

if __name__ == "__main__":
    run_evaluation()