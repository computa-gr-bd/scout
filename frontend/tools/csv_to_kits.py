"""
Gera src/data/teamKits.ts a partir de tools/team_kits.csv.

Uso (a partir da pasta frontend/):
    python tools/csv_to_kits.py

O CSV usa ';' como separador e as colunas:
    time;camisa1;calcao1;meia1;camisa2;calcao2;meia2
Cores em hexadecimal (#RRGGBB). Para mudar um uniforme, edite o CSV e rode o script de novo.
"""
import csv
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "team_kits.csv"
OUT = HERE.parent / "src" / "data" / "teamKits.ts"
COLS = ["camisa1", "calcao1", "meia1", "camisa2", "calcao2", "meia2"]
HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


def main() -> int:
    with SRC.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f, delimiter=";"))

    errors, seen, lines = [], set(), []
    for n, r in enumerate(rows, start=2):
        name = (r.get("time") or "").strip()
        if not name:
            errors.append(f"linha {n}: nome do time vazio")
            continue
        if name.lower() in seen:
            errors.append(f"linha {n}: time repetido '{name}'")
        seen.add(name.lower())
        vals = []
        for c in COLS:
            v = (r.get(c) or "").strip()
            if not HEX.match(v):
                errors.append(f"linha {n} ({name}): cor inválida em {c}: '{v}'")
            vals.append(v.lower())
        if len(vals) == 6:
            lines.append(
                '  { name: %s, k1: { shirt: "%s", shorts: "%s", socks: "%s" }, k2: { shirt: "%s", shorts: "%s", socks: "%s" } },'
                % (('"%s"' % name.replace('"', '\\"')), *vals)
            )

    if errors:
        print("Erros no CSV:\n  " + "\n  ".join(errors))
        return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "// GERADO por tools/csv_to_kits.py a partir de tools/team_kits.csv — não edite à mão.\n"
        "export type KitColors = { shirt: string; shorts: string; socks: string };\n"
        "export type TeamKit = { name: string; k1: KitColors; k2: KitColors };\n\n"
        "export const TEAM_KITS: TeamKit[] = [\n" + "\n".join(lines) + "\n];\n",
        encoding="utf-8",
    )
    print(f"OK: {len(lines)} times -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
