"""Export the original workbook to app/data/source_seed.json (lossless, typed, with SHA-256).
Exact duplicate rows are KEPT here (raw fidelity); the app importer dedupes by stable ID and logs it.
Run: python analysis/export_seed.py
"""
import json, hashlib
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "source_documents" / "Sponsor_Dataset.xlsx"


def conv(v):
    if v is None:
        return None
    if isinstance(v, pd.Timestamp):
        return v.strftime("%Y-%m-%dT%H:%M:%S+05:30")  # workbook timestamps are IST wall-clock
    if isinstance(v, bool):
        return v
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if hasattr(v, "item"):
        return conv(v.item())
    return v


out = {"file_name": SRC.name, "sha256": hashlib.sha256(SRC.read_bytes()).hexdigest(), "sheets": {}}
for name, df in pd.read_excel(SRC, sheet_name=None).items():
    df = df.astype(object).where(pd.notna(df), None)
    out["sheets"][name] = [{k: conv(v) for k, v in r.items()} for r in df.to_dict("records")]
p = ROOT / "app" / "data" / "source_seed.json"
p.parent.mkdir(parents=True, exist_ok=True)
p.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
print(p, {k: len(v) for k, v in out["sheets"].items()})
