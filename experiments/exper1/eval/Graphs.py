import os
import json
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns


def corr_description(r):
    if r == 1.0: return "Pilnīga pozitīva korelācija"
    elif 0.7 <= r < 1.0: return "Spēcīga pozitīva korelācija"
    elif 0.4 <= r < 0.7: return "Vidēji spēcīga pozitīva korelācija"
    elif 0.1 <= r < 0.4: return "Vāja pozitīva korelācija"
    elif -0.1 < r < 0.1: return "Nav korelācijas"
    elif -0.4 < r <= -0.1: return "Vāja negatīva korelācija"
    elif -0.7 < r <= -0.4: return "Vidēji spēcīga negatīva korelācija"
    elif -1.0 < r <= -0.7: return "Spēcīga negatīva korelācija"
    elif r == -1.0: return "Pilnīga negatīva korelācija"

def format_ratio(eng_avg, lat_avg):
    if eng_avg == 0: return "N/A"
    ratio = lat_avg / eng_avg
    if ratio >= 1: return f"{ratio:.2f}x vairāk"
    else: return f"{1/ratio:.2f}x mazāk"

if __name__ == "__main__":
    eng_df = pd.read_json("ENG_metrics.json").sort_values("params")
    lat_df = pd.read_json("LAT_metrics.json").sort_values("params")
    fig, axes = plt.subplots(3, 1, figsize=(10,10))
    diff_func = lambda eng_avg, lat_avg: (lat_avg - eng_avg) / eng_avg * 100
    x_pos = 50

    combined_df = pd.concat([eng_df, lat_df])
    context_avg = combined_df["contextLength"].mean()
    temp_avg = combined_df["temperature"].mean()

    ax = axes[0]
    sns.scatterplot(data=eng_df, x="params", y="error", color="red", label="ENG", s=40, ax=ax)
    sns.scatterplot(data=lat_df, x="params", y="error", color="blue", label="LAT", s=20, ax=ax)

    eng_avg = eng_df["error"].mean()
    lat_avg = lat_df["error"].mean()
    diff_pct = diff_func(eng_avg, lat_avg)

    ax.axhline(eng_avg, color="red", linestyle="--", linewidth=1.5, label=f"ENG vid: {eng_avg:.1f}")
    ax.axhline(lat_avg, color="blue", linestyle="--", linewidth=1.5, label=f"LAT vid: {lat_avg:.1f}")

    low, high = min(eng_avg, lat_avg), max(eng_avg, lat_avg)
    ax.plot([x_pos, x_pos], [low+0.5, high], color="black", linewidth=2)
    ax.text(x_pos + 1, (eng_avg + lat_avg)/2, f"Δ {diff_pct:.1f}% (LAT: {format_ratio(eng_avg, lat_avg)})", va="center", fontsize=10)

    corr_error_eng = eng_df["params"].corr(eng_df["error"])
    corr_error_lat = lat_df["params"].corr(lat_df["error"])

    ax.text(
        x=axes[0].get_xlim()[1]/2,
        y=axes[0].get_ylim()[1] - 10.5,
        s=f"ENG: {corr_error_eng:.2f} ({corr_description(corr_error_eng)})\nLAT: {corr_error_lat:.2f} ({corr_description(corr_error_lat)})",
        ha="center", va="center", fontsize=10, fontweight="bold",
        bbox=dict(facecolor='white', alpha=0.5, edgecolor='gray')
    )

    ax.set_xlabel("Parametru skaits (Miljardos)")
    ax.set_ylabel("Kļūda (%)")
    ax.set_title(f"Kļūda pret modeļa parametru skaitu (C: {int(context_avg)}, T: {temp_avg:.2f})")
    ax.set_xlim(-2, 72)
    ax.set_ylim(-4, 104)
    ax.set_xticks(range(0, 71, 2))
    ax.set_yticks(range(0, 101, 5))
    ax.legend()

    ax = axes[1]
    sns.scatterplot(data=eng_df, x="params", y="f1", color="red", label="ENG", s=40, ax=ax)
    sns.scatterplot(data=lat_df, x="params", y="f1", color="blue", label="LAT", s=20, ax=ax)

    eng_avg = eng_df["f1"].mean()
    lat_avg = lat_df["f1"].mean()
    diff_pct = diff_func(eng_avg, lat_avg)

    ax.axhline(eng_avg, color="red", linestyle="--", linewidth=1.5, label=f"ENG vid: {eng_avg:.1f}")
    ax.axhline(lat_avg, color="blue", linestyle="--", linewidth=1.5, label=f"LAT vid: {lat_avg:.1f}")

    low, high = min(eng_avg, lat_avg), max(eng_avg, lat_avg)
    ax.plot([x_pos, x_pos], [low+0.5, high], color="black", linewidth=2)
    ax.text(x_pos + 1, (eng_avg + lat_avg)/2, f"Δ {diff_pct:.1f}% (LAT: {format_ratio(eng_avg, lat_avg)})", va="center", fontsize=10)

    corr_f1_eng = eng_df["params"].corr(eng_df["f1"])
    corr_f1_lat = lat_df["params"].corr(lat_df["f1"])

    ax.text(
        x=axes[0].get_xlim()[1]/2,
        y=axes[0].get_ylim()[1] - 12.5,
        s=f"ENG: {corr_f1_eng:.2f} ({corr_description(corr_f1_eng)})\nLAT: {corr_f1_lat:.2f} ({corr_description(corr_f1_lat)})",
        ha="center", va="center", fontsize=10, fontweight="bold",
        bbox=dict(facecolor='white', alpha=0.5, edgecolor='gray')
    )

    ax.set_xlabel("Parametru skaits (Miljardos)")
    ax.set_ylabel("F1 (%)")
    ax.set_title(f"F1 pret modeļa parametru skaitu (C: {int(context_avg)}, T: {temp_avg:.2f})")
    ax.set_xlim(-2, 72)
    ax.set_ylim(-4, 104)
    ax.set_xticks(range(0, 71, 2))
    ax.set_yticks(range(0, 101, 5))
    ax.legend()

    ax = axes[2]
    sns.scatterplot(data=eng_df, x="params", y="time_min", color="red", label="ENG", s=40, ax=ax)
    sns.scatterplot(data=lat_df, x="params", y="time_min", color="blue", label="LAT", s=20, ax=ax)

    eng_avg = eng_df["time_min"].mean()
    lat_avg = lat_df["time_min"].mean()
    diff_pct = diff_func(eng_avg, lat_avg)

    ax.axhline(eng_avg, color="red", linestyle="--", linewidth=1.5, label=f"ENG vid: {eng_avg:.1f}")
    ax.axhline(lat_avg, color="blue", linestyle="--", linewidth=1.5, label=f"LAT vid: {lat_avg:.1f}")

    low, high = min(eng_avg, lat_avg), max(eng_avg, lat_avg)
    ax.plot([x_pos, x_pos], [low+0.5, high], color="black", linewidth=2)
    ax.text(x_pos + 1, (eng_avg + lat_avg)/2, f"Δ {diff_pct:.1f}% (LAT: {format_ratio(eng_avg, lat_avg)})", va="center", fontsize=10)

    corr_f1_eng = eng_df["params"].corr(eng_df["time_min"])
    corr_f1_lat = lat_df["params"].corr(lat_df["time_min"])

    ax.text(
        x=axes[0].get_xlim()[1]/2,
        y=axes[0].get_ylim()[1] + 1750,
        s=f"ENG: {corr_f1_eng:.2f} ({corr_description(corr_f1_eng)})\nLAT: {corr_f1_lat:.2f} ({corr_description(corr_f1_lat)})",
        ha="center", va="center", fontsize=10, fontweight="bold",
        bbox=dict(facecolor='white', alpha=0.5, edgecolor='gray')
    )

    ax.set_xlabel("Parametru skaits (Miljardos)")
    ax.set_ylabel("Laiks (Minūtēs)")
    ax.set_title(f"Laiks pret modeļa parametru skaitu (C: {int(context_avg)}, T: {temp_avg:.2f})")
    ax.set_xlim(-2, 72)
    ax.set_ylim(-99, 2099)
    ax.set_xticks(range(0, 71, 2))
    ax.set_yticks(range(0, 2099, 100))
    ax.legend()

    plt.tight_layout()
    plt.savefig("LAT_ENG_metrics.png", dpi=300)
    plt.show()


    def plot_group(ax, df, feature, title, true_color, false_color, metric="f1"):
        df_true = df[df[feature] == True]
        df_false = df[df[feature] == False]

        sns.scatterplot(data=df_true, x="params", y=metric, color=true_color, label=f"{feature}=True", s=40, ax=ax)
        sns.scatterplot(data=df_false, x="params", y=metric, color=false_color, label=f"{feature}=False", s=40, ax=ax)

        if not df_true.empty:
            avg_true = df_true[metric].mean()
            ax.axhline(avg_true, color=true_color, linestyle="--", linewidth=1.5, label=f"True avg: {avg_true:.1f}")

        if not df_false.empty:
            avg_false = df_false[metric].mean()
            ax.axhline(avg_false, color=false_color, linestyle="--", linewidth=1.5, label=f"False avg: {avg_false:.1f}")

        ax.set_title(title)
        ax.set_xlabel("Parametru skaits (Miljardos)")

        if (metric == "f1"):
            ax.set_ylabel("F1 (%)")
            ax.set_ylim(-4, 104)
            ax.set_yticks(range(0, 101, 5))
        else:
            ax.set_ylabel("Kļūda (%)")
            ax.set_ylim(-4, 104)
            ax.set_yticks(range(0, 101, 5))

        ax.set_xlim(-2, 72)
        ax.set_xticks(range(0, 71, 5))
        ax.legend()

    fig, axes = plt.subplots(4, 4, figsize=(22, 14))

    plot_group(axes[0, 0], eng_df, "mvision", "Vision funkcionalitātes esamības ietekme uz F1 (ENG)", true_color="gold", false_color="#444444" )
    plot_group(axes[0, 1], lat_df, "mvision", "Vision funkcionalitātes esamības ietekme uz F1 (LAT)", true_color="gold", false_color="#444444")
    plot_group(axes[1, 0], eng_df, "mtools", "Tools funkcionalitātes esamības ietekme uz F1 (ENG)", true_color="blue", false_color="#444444")
    plot_group(axes[1, 1], lat_df, "mtools", "Tools funkcionalitātes esamības ietekme uz F1 (LAT)", true_color="blue", false_color="#444444")

    plot_group(axes[0, 2], eng_df, "mvision", "Vision funkcionalitātes esamības ietekme uz kļūdu (ENG)", true_color="gold", false_color="#444444", metric="error")
    plot_group(axes[0, 3], lat_df, "mvision", "Vision funkcionalitātes esamības ietekme uz kļūdu (LAT)", true_color="gold", false_color="#444444", metric="error")
    plot_group(axes[1, 2], eng_df, "mtools", "Tools funkcionalitātes esamības ietekme uz kļūdu (ENG)", true_color="blue", false_color="#444444", metric="error")
    plot_group(axes[1, 3], lat_df, "mtools", "Tools funkcionalitātes esamības ietekme uz kļūdu (LAT)", true_color="blue", false_color="#444444", metric="error")

    plot_group(axes[2, 0], eng_df, "mreasoning", "Reasoning funkcionalitātes esamības ietekme uz F1 (ENG)", "green", "#444444")
    plot_group(axes[2, 1], lat_df, "mreasoning", "Reasoning funkcionalitātes esamības ietekme uz F1 (LAT)", "green", "#444444")
    plot_group(axes[2, 2], eng_df, "mreasoning", "Reasoning funkcionalitātes esamības ietekme uz kļūdu (ENG)", "green", "#444444", metric="error")
    plot_group(axes[2, 3], lat_df, "mreasoning", "Reasoning funkcionalitātes esamības ietekme uz kļūdu (LAT)", "green", "#444444", metric="error")

    plot_group(axes[3, 0], eng_df, "has_any_capability", "Jebkuras funkcionalitātes esamības ietekme uz F1 (ENG)", "magenta", "#444444")
    plot_group(axes[3, 1], lat_df, "has_any_capability", "Jebkuras funkcionalitātes esamības ietekme uz F1 (LAT)", "magenta", "#444444")
    plot_group(axes[3, 2], eng_df, "has_any_capability", "Jebkuras funkcionalitātes esamības ietekme uz kļūdu (ENG)", "magenta", "#444444", metric="error")
    plot_group(axes[3, 3], lat_df, "has_any_capability", "Jebkuras funkcionalitātes esamības ietekme uz kļūdu (LAT)", "magenta", "#444444", metric="error")

    plt.tight_layout()
    plt.savefig("LAT_ENG_metrics_capabilities.png", dpi=300)
    plt.show()