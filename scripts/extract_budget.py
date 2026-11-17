#!/usr/bin/env python3
"""Wyciąga plan budżetu Krakowa z pierwotnej uchwały Rady (PDF, pdftotext -layout).

Kontrola: suma działów dochodów i wydatków musi równać się kwotom z § 1.
"""
import json, re, subprocess, sys
from pathlib import Path

DZIALY = {
    "010": "Rolnictwo i łowiectwo",
    "020": "Leśnictwo",
    "050": "Rybołówstwo i rybactwo",
    "100": "Górnictwo i kopalnictwo",
    "150": "Przetwórstwo przemysłowe",
    "400": "Wytwarzanie i zaopatrywanie w energię elektryczną, gaz i wodę",
    "500": "Handel",
    "550": "Hotele i restauracje",
    "600": "Transport i łączność",
    "630": "Turystyka",
    "700": "Gospodarka mieszkaniowa",
    "710": "Działalność usługowa",
    "720": "Informatyka",
    "730": "Nauka",
    "750": "Administracja publiczna",
    "751": "Urzędy naczelnych organów władzy państwowej, kontroli i ochrony prawa oraz sądownictwa",
    "752": "Obrona narodowa",
    "754": "Bezpieczeństwo publiczne i ochrona przeciwpożarowa",
    "755": "Wymiar sprawiedliwości",
    "756": "Dochody od osób prawnych, od osób fizycznych i od innych jednostek oraz wydatki związane z ich poborem",
    "757": "Obsługa długu publicznego",
    "758": "Różne rozliczenia",
    "801": "Oświata i wychowanie",
    "803": "Szkolnictwo wyższe",
    "851": "Ochrona zdrowia",
    "852": "Pomoc społeczna",
    "853": "Pozostałe zadania w zakresie polityki społecznej",
    "854": "Edukacyjna opieka wychowawcza",
    "855": "Rodzina",
    "900": "Gospodarka komunalna i ochrona środowiska",
    "921": "Kultura i ochrona dziedzictwa narodowego",
    "925": "Ogrody botaniczne i zoologiczne oraz naturalne obszary i obiekty chronionej przyrody",
    "926": "Kultura fizyczna",
}

AMT_RE = re.compile(r"\s{2,}(\d{1,3}(?: \d{3})+|\d{2,})(?!\d)")


def pl_dots(s):
    return int(s.replace(".", "").replace(" ", "").replace("\xa0", ""))


def amounts(line):
    found = list(AMT_RE.finditer(line))
    if not found:
        return line.strip(), []
    name = line[: found[0].start()].strip()
    vals = [int(m.group(1).replace(" ", "")) for m in found]
    return name, vals


def split_code(line):
    """Zwraca (kod albo '', reszta nazwy, [kwoty]). Pierwsza kwota to ogółem."""
    s = line.strip()
    code, rest = "", s
    m = re.match(r"^(§\d{4}|\d{5}|\d{3})(?:\s+|$)(.*)$", s)
    if m:
        token, rest = m.group(1), m.group(2)
        if token.startswith("§") or token in DZIALY or len(token) == 5:
            code = token
    found = list(re.finditer(r"(?:^|\s{2,})(\d{1,3}(?: \d{3})+|\d{2,})(?!\d)", rest))
    if not found:
        return code, rest.strip(), []
    name = rest[: found[0].start()].strip()
    vals = [int(x.group(1).replace(" ", "")) for x in found]
    return code, name, vals


def collapse(s):
    return re.sub(r"\s+", " ", s).strip()


def slice_between(text, start_pat, end_pat):
    m = re.search(start_pat, text)
    if not m:
        return ""
    rest = text[m.end():]
    n = re.search(end_pat, rest)
    return rest[: n.start()] if n else rest


def annex_pos(text, number, marker):
    for m in re.finditer(rf"Załącznik Nr {number}\b", text):
        window = text[m.end():m.end() + 900]
        if marker in window:
            return m.end()
    return None


def parse_preamble(text):
    start = text.find("uchwala się")
    head = text[start if start >= 0 else 0:]
    cut = annex_pos(head, 1, "DOCHODY BUDŻETU")
    if cut:
        head = head[:cut]
    flat = collapse(head)
    def grab(pat):
        m = re.search(pat, flat)
        if not m:
            raise ValueError("brak: " + pat)
        return pl_dots(m.group(1))

    meta = {
        "dochody": grab(r"dochody budżetu Miasta Krakowa w łącznej kwocie ([\d.]+)"),
        "wydatki": grab(r"wydatki budżetu Miasta Krakowa w łącznej kwocie ([\d.]+)"),
        "deficyt": grab(r"[Dd]eficyt budżetu Miasta Krakowa ustala się (?:w kwocie|na kwotę) ([\d.]+)"),
    }
    # bieżące / majątkowe występują po kolei: dochody, potem wydatki
    pairs = re.findall(
        r"(dochody|wydatki) (bieżące|majątkowe) (?:w kwocie|na kwotę) ([\d.]+)", flat)
    for kind, nature, num in pairs:
        meta[f"{kind}_{'biezace' if nature=='bieżące' else 'majatkowe'}"] = pl_dots(num)

    m = re.search(r"przychody budżetu Miasta Krakowa w łącznej kwocie ([\d.]+)", flat)
    if m:
        meta["przychody"] = pl_dots(m.group(1))
    m = re.search(r"rozchody budżetu Miasta Krakowa w łącznej kwocie ([\d.]+)", flat)
    if m:
        meta["rozchody"] = pl_dots(m.group(1))
    m = re.search(r"dzielnic Miasta Krakowa na łączną kwotę ([\d.]+)", flat)
    if m:
        meta["dzielnice"] = pl_dots(m.group(1))
    m = re.search(r"rezerwę ogólną w kwocie ([\d.]+)", flat)
    if m:
        meta["rezerwa_ogolna"] = pl_dots(m.group(1))
    m = re.search(r"rezerwy celowe w kwocie ([\d.]+)", flat)
    if m:
        meta["rezerwa_celowa"] = pl_dots(m.group(1))

    s2 = re.search(r"zostanie sfinansowany(.+?)§\s*3", flat)
    finansowanie = []
    if s2:
        chunk = s2.group(1)
        for name, num in re.findall(r"(.{8,240}?) w kwocie ([\d.]+) zł", chunk):
            label = collapse(name)
            label = re.sub(r"^.*?(przychodami pochodzącymi z |oraz z |oraz )", "", label)
            label = label.strip(" ,.;")
            finansowanie.append({"name": label[:180], "plan": pl_dots(num)})
    meta["finansowanie"] = tidy_financing(finansowanie)
    return meta


def parse_income(text):
    a = annex_pos(text, 1, "DOCHODY BUDŻETU")
    b = annex_pos(text, 2, "WYDATKI BUDŻETU")
    block = text[a:b] if a is not None and b is not None else ""
    dzialy = []
    current = None
    nature = None
    pending_code = None

    def flush_para(code, name, plan):
        if current is None or plan is None:
            return
        current["paragrafy"].append({
            "code": code, "name": collapse(name)[:220] or code, "plan": plan,
            "rodzaj": nature or "biezace",
        })

    for raw in block.splitlines():
        line = raw.replace("\xa0", " ").rstrip()
        if not line.strip():
            continue
        if "Id:" in line or line.strip().startswith("Strona") or set(line.strip()) <= set("-– "):
            continue
        if "DOCHODY BUDŻETU" in line or line.strip() in {"w zł", "1", "2", "3"}:
            continue
        if re.search(r"Dział\s*/", line) or line.strip().startswith("Nazwa"):
            continue

        code, name, vals = split_code(line)

        if code in DZIALY and vals:
            if current:
                dzialy.append(current)
            current = {"code": code, "name": DZIALY[code], "plan": vals[0],
                       "biezace": None, "majatkowe": None, "paragrafy": []}
            nature = None
            pending_code = None
            continue

        low = (name or line.strip()).lower()
        if low.startswith("bieżące") or low.startswith("majątkowe"):
            nature = "biezace" if low.startswith("bieżące") else "majatkowe"
            if current and vals:
                current[nature] = vals[0]
            pending_code = None
            continue

        if code.startswith("§"):
            if vals:
                flush_para(code[1:], name, vals[0])
                pending_code = None
            else:
                pending_code = code[1:]
            continue

        if pending_code and vals and current:
            flush_para(pending_code, name, vals[0])
            pending_code = None
            continue

    if current:
        dzialy.append(current)
    # scal działy o tym samym kodzie (złamanie strony potrafi powtórzyć nagłówek bez kwoty)
    merged = []
    for d in dzialy:
        if merged and merged[-1]["code"] == d["code"] and d["plan"] == merged[-1]["plan"]:
            merged[-1]["paragrafy"].extend(d["paragrafy"])
            continue
        merged.append(d)
    return merged


def parse_expense(text):
    a = annex_pos(text, 2, "WYDATKI BUDŻETU")
    b = annex_pos(text, 3, "PRZYCHODY")
    block = text[a:b] if a is not None and b is not None else ""
    dzialy = []
    current = None
    roz = None

    def close_roz():
        nonlocal roz
        if current is not None and roz is not None:
            current["rozdzialy"].append(roz)
        roz = None

    for raw in block.splitlines():
        line = raw.replace("\xa0", " ").rstrip()
        if not line.strip():
            continue
        if "Id:" in line or "WYDATKI BUDŻETU" in line or "UKŁADZIE KLASYFIKACJI" in line:
            continue
        if "Plan wydatków" in line or "Wyszczególnienie" in line or line.strip() == "w zł":
            continue
        code, name, vals = split_code(line)
        if not vals:
            continue
        if code in DZIALY:
            close_roz()
            if current:
                dzialy.append(current)
            current = {"code": code, "name": DZIALY[code], "plan": vals[0],
                       "biezace": 0, "majatkowe": 0, "rozdzialy": []}
            roz = None
            continue
        if len(code) == 5 and code.isdigit() and current:
            close_roz()
            roz = {"code": code, "name": collapse(name)[:180],
                   "plan": vals[0], "biezace": None, "majatkowe": None}
            continue
        low = name.lower()
        if roz and (low.startswith("wydatki bieżące") or low.startswith("wydatki maj")):
            key = "biezace" if "bież" in low else "majatkowe"
            if roz[key] is None:
                roz[key] = vals[0]
            continue
    close_roz()
    if current:
        dzialy.append(current)
    for d in dzialy:
        b = sum(r["biezace"] or 0 for r in d["rozdzialy"])
        m = sum(r["majatkowe"] or 0 for r in d["rozdzialy"])
        if b + m == d["plan"] and (b or m):
            d["biezace"], d["majatkowe"] = b, m
        else:
            d["biezace"] = d["majatkowe"] = None
    return dzialy


def tidy_financing(items):
    rules = [
        ("woln", "Wolne środki"),
        ("nadwyż", "Wolne środki"),
        ("wyżki środków", "Wolne środki"),
        ("niewykorzystanych środków", "Niewykorzystane środki"),
        ("obligac", "Emisja obligacji"),
        ("pożycz", "Pożyczki"),
        ("kredyt", "Kredyty"),
        ("europejsk", "Rozliczenie środków"),
        ("art. 5", "Rozliczenie środków"),
        ("przychodów z prywatyzacji", "Przychody z prywatyzacji"),
        ("nadwyżki budżetu", "Nadwyżka z lat ubiegłych"),
    ]
    out = []
    for it in items:
        low = it["name"].lower()
        label = it["name"]
        for key, name in rules:
            if key in low:
                label = name
                break
        # scal te same etykiety
        for prev in out:
            if prev["name"] == label:
                prev["plan"] += it["plan"]
                break
        else:
            out.append({"name": label, "plan": it["plan"]})
    return out


def income_groups(dzialy, total, majatkowe=None):
    buckets = {
        "Udziały w PIT": 0,
        "Udziały w CIT": 0,
        "Podatki lokalne": 0,
        "Subwencje": 0,
        "Dotacje": 0,
        "Dochody majątkowe": 0,
        "Pozostałe dochody własne": 0,
    }
    seen = 0
    local = {"0310", "0320", "0330", "0340", "0350", "0360", "0370"}
    for d in dzialy:
        for p in d["paragrafy"]:
            c, v = p["code"], p["plan"]
            seen += v
            if p["rodzaj"] == "majatkowe" or c.startswith("6"):
                buckets["Dochody majątkowe"] += v
            elif c == "0010":
                buckets["Udziały w PIT"] += v
            elif c == "0020":
                buckets["Udziały w CIT"] += v
            elif c in local:
                buckets["Podatki lokalne"] += v
            elif c.startswith("29"):
                buckets["Subwencje"] += v
            elif c.startswith("2"):
                buckets["Dotacje"] += v
            else:
                buckets["Pozostałe dochody własne"] += v
    # paragrafy, których PDF nie złożył w jednej linii, domykają sumę do § 1
    gap = total - seen
    if gap:
        buckets["Pozostałe dochody własne"] += gap
    if majatkowe is not None:
        delta = majatkowe - buckets["Dochody majątkowe"]
        if buckets["Pozostałe dochody własne"] - delta >= 0:
            buckets["Dochody majątkowe"] = majatkowe
            buckets["Pozostałe dochody własne"] -= delta
    order = ["Udziały w PIT", "Udziały w CIT", "Podatki lokalne", "Subwencje",
             "Dotacje", "Pozostałe dochody własne", "Dochody majątkowe"]
    return [{"name": n, "plan": buckets[n]} for n in order if buckets[n]]


def check(meta, income, expense):
    di = sum(d["plan"] for d in income)
    de = sum(d["plan"] for d in expense)
    problems = []
    if di != meta["dochody"]:
        problems.append(f"dochody działy {di} != §1 {meta['dochody']} (różnica {di-meta['dochody']})")
    if de != meta["wydatki"]:
        problems.append(f"wydatki działy {de} != §1 {meta['wydatki']} (różnica {de-meta['wydatki']})")
    for d in expense:
        s = sum(r["plan"] for r in d["rozdzialy"])
        if d["rozdzialy"] and s != d["plan"]:
            problems.append(f"rozdziały {d['code']} {s} != dział {d['plan']} — rozbicie pominięte")
            d["rozdzialy"] = []
            d["biezace"] = d["majatkowe"] = None
    fin = sum(x["plan"] for x in meta.get("finansowanie") or [])
    if meta.get("finansowanie") and fin != meta["deficyt"]:
        problems.append(f"finansowanie deficytu {fin} != deficyt {meta['deficyt']}")
    complete = all(d["biezace"] is not None for d in expense)
    if complete:
        b = sum(d["biezace"] for d in expense)
        m = sum(d["majatkowe"] for d in expense)
        if "wydatki_biezace" in meta and b != meta["wydatki_biezace"]:
            problems.append(f"wydatki bieżące z rozdziałów {b} != §1 {meta['wydatki_biezace']}")
        if "wydatki_majatkowe" in meta and m != meta["wydatki_majatkowe"]:
            problems.append(f"wydatki majątkowe z rozdziałów {m} != §1 {meta['wydatki_majatkowe']}")
    return problems


def extract(pdf_path):
    text = subprocess.check_output(["pdftotext", "-layout", str(pdf_path), "-"], text=True, errors="replace", stderr=subprocess.DEVNULL)
    meta = parse_preamble(text)
    income = parse_income(text)
    expense = parse_expense(text)
    problems = check(meta, income, expense)
    meta["dochody_grupy_uzupelnienie"] = None
    grupy = income_groups(income, meta["dochody"], meta.get("dochody_majatkowe"))
    return meta, income, expense, grupy, problems


if __name__ == "__main__":
    pdf = Path(sys.argv[1])
    meta, income, expense, grupy, problems = extract(pdf)
    print(pdf.name, "dochody", meta["dochody"], "wydatki", meta["wydatki"], "deficyt", meta["deficyt"])
    print("  działy dochodów", len(income), "wydatków", len(expense),
          "rozdziały", sum(len(d["rozdzialy"]) for d in expense))
    for p in problems:
        print("  !", p)
    if len(sys.argv) > 2:
        out = {
            "meta": meta,
            "dochody_dzialy": income,
            "wydatki_dzialy": expense,
            "dochody_grupy": grupy,
        }
        Path(sys.argv[2]).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
