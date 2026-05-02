import json
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

def translator(category_name):
    mapping = {
        "temperature": "Temperatūra",
        "repeat_penalty": "Atkārt. Sods",
        "context_window": "Konteksta Logs",
        "safe_margin": "Drošības Rezerve",
        "quantization": "Kvantizācija",
        "error": "Kļūda",
    }
    return mapping.get(category_name, category_name.replace("_", " ").title())

process_all_models = True
json_file = "LAT_metrics_groups.json"
target_model = "google_gemma-2-9b"

try:
    with open(json_file, "r", encoding="utf-8") as f: aggregated = json.load(f)
except FileNotFoundError:
    print(f"Error: {json_file} not found.")
    exit()

if process_all_models: target_models = list(aggregated.keys())
else: target_models = [target_model]

for target_model in target_models:
    rows = []
    display_model_name = target_model

    if target_model in aggregated:
        model_data = aggregated[target_model]
        for category, values in model_data.items():
            for val_str, data in values.items():
                display_model_name = data.get("display", display_model_name)
                rows.append(data)

    df = pd.DataFrame(rows)
    custom_df = df[df['category'] == 'custom']
    df = df[df['category'] != 'custom']
    categories = df['category'].unique()
    fig, axes = plt.subplots(1, 2, figsize=(18, 6))

    metrics = ['f1', 'error']
    titles = [f'F1 (%) - {display_model_name}', f'Kļūda (%) - {display_model_name}']

    for i, metric in enumerate(metrics):
        ax = axes[i]
        total_group_width = 0.8

        for x_pos, cat in enumerate(categories):
            cat_df = df[df['category'] == cat].sort_values(metric, ascending=True)

            n_segments = len(cat_df)
            bar_width = total_group_width / n_segments
            colors = plt.cm.viridis(np.linspace(0.2, 0.8, n_segments))

            start_x = x_pos - (total_group_width / 2) + (bar_width / 2)
            max_y_in_cat = cat_df[metric].max()

            for idx, (_, row) in enumerate(cat_df.iterrows()):
                current_x = start_x + (idx * bar_width)
                actual_val = row[metric]
                display_val = max(actual_val, 0.5)

                ax.bar(current_x, display_val, width=bar_width, color=colors[idx], alpha=1, edgecolor='black', linewidth=0.5, zorder=3)

                label_y = max_y_in_cat + 6 + (idx * 6)

                ax.vlines(current_x, actual_val, label_y, color='black', linestyle='-', alpha=0.3, lw=0.7)
                row_value = row['quantization'] if (cat == 'quantization') else row['value']
                display_text = f"{row_value}\n{actual_val}%"

                ax.text(current_x, label_y, f"{row_value}: {actual_val}%",
                        ha='center', va='bottom', fontsize=9, fontweight='bold',
                        bbox=dict(facecolor='white', alpha=0.9, edgecolor='gray', boxstyle='round,pad=0.2'))

        ax.set_xticks(range(len(categories)))
        ax.set_xticklabels([translator(c) for c in categories], fontsize=12, fontweight='bold')

        ax.set_ylim(0, 150)
        ax.set_yticks(np.arange(0, 101, 5))

        ax.axhline(100, color='red', linestyle='-', linewidth=2, alpha=0.7)

        ax.set_ylabel("Procenti (%)", fontsize=12, fontweight='bold')
        ax.grid(axis='y', linestyle='--', alpha=0.2, zorder=0)
        ax.set_title(titles[i], fontsize=16, pad=10)

        if not custom_df.empty:
            best = custom_df.sort_values(by=["error", "f1"], ascending=[True, False]).iloc[0]
            custom_label = f"Pielāgots: {translator(metric)}: {best[metric]:.1f}% R: {best['recall']:.1f}% T: {round(best['time_min'])} min | CTX: {best['contextLength']}, Q: {best['quantization']}, RP: {best['repeat_penalty']:.2f}, SF: {best['safe_margin']:.3f}, T: {best['temperature']:.2f}"
            ax.text(0.01, 0.98, custom_label, transform=ax.transAxes, ha='left', va='top', fontsize=10,
            bbox=dict(facecolor='white', alpha=0.9, edgecolor='gray', boxstyle='round,pad=0.3'))

    plt.tight_layout()
    plt.savefig(f"LAT_eval_groups_{target_model}.png", dpi=300)
    plt.show()