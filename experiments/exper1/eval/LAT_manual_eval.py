import re
import json
import pandas as pd
import matplotlib.pyplot as plt

file_path = "LAT_manual_eval.txt"
with open(file_path, "r", encoding="utf-8") as f: lines = f.readlines()

filename_1 = filename_2 = None
for line in lines:
    if line.startswith("[1]:") and not filename_1:
        filename_1 = line.split(":", 1)[1].strip()
    elif line.startswith("[2]:") and not filename_2:
        filename_2 = line.split(":", 1)[1].strip()
    if filename_1 and filename_2: break

stats = {
    filename_1: { "CORRECT": 0, "MISSING": 0, "WRONG": 0, "WRONG_LANG": 0, "WIN": 0, "TOTAL": 0 },
    filename_2: { "CORRECT": 0, "MISSING": 0, "WRONG": 0, "WRONG_LANG": 0, "WIN": 0, "TOTAL": 0 }
}

pattern = re.compile(r"\s*(\[.\])\s*(\[.\])\s*(\[.\])\s*(.+)")

for line in lines:
    m = pattern.match(line)
    if not m: continue

    col1, col2, win_col, _ = m.groups()
    stats[filename_1]["TOTAL"] += 1
    stats[filename_2]["TOTAL"] += 1

    for col, fname in [(col1, filename_1), (col2, filename_2)]:
        if col == "[+]": stats[fname]["CORRECT"] += 1
        elif col == "[-]": stats[fname]["MISSING"] += 1
        elif col == "[*]": stats[fname]["WRONG"] += 1
        elif col == "[#]": stats[fname]["WRONG_LANG"] += 1
        else: raise ValueError(f"Unexpected label: {col}")

    if win_col == "[0]":
        stats[filename_1]["WIN"] += 0.5
        stats[filename_2]["WIN"] += 0.5
    elif win_col == "[1]":
        stats[filename_1]["WIN"] += 1
    elif win_col == "[2]":
        stats[filename_2]["WIN"] += 1
    else: raise ValueError(f"Unexpected winner: {win_col}")

for fname in [filename_1, filename_2]:
    total = stats[fname]["TOTAL"]
    for key in ["CORRECT", "MISSING", "WRONG", "WRONG_LANG", "WIN"]:
        stats[fname][f"{key}_P"] = round(stats[fname][key] / total * 100, 1)

df = pd.DataFrame(stats).T
df = df[["TOTAL", "CORRECT", "MISSING", "WRONG", "WRONG_LANG", "WIN", "CORRECT_P", "MISSING_P", "WRONG_P", "WRONG_LANG_P", "WIN_P"]]

print(df.to_string(formatters={
    "TOTAL": "{:.0f}".format,
    "CORRECT": "{:.0f}".format,
    "CORRECT_P": "{:.1f}".format,
    "MISSING": "{:.0f}".format,
    "MISSING_P": "{:.1f}".format,
    "WRONG": "{:.0f}".format,
    "WRONG_P": "{:.1f}".format,
    "WRONG_LANG": "{:.0f}".format,
    "WRONG_LANG_P": "{:.1f}".format,
    "WIN": "{:.1f}".format,
    "WIN_P": "{:.1f}".format,
}))

with open("LAT_manual_eval.json", "w", encoding="utf-8") as f:
    json.dump(stats, f, indent=2)

fig, ax = plt.subplots(figsize=(12, 3))
ax.axis('off')
table = ax.table(cellText=df.values, colLabels=df.columns, rowLabels=df.index, cellLoc='center', loc='center')
table.auto_set_font_size(False)
table.set_fontsize(10)
table.scale(1.2, 1.5)
table.auto_set_column_width(col=list(range(len(df.columns))))
plt.savefig("LAT_manual_eval.png", dpi=300, bbox_inches='tight')
plt.show()