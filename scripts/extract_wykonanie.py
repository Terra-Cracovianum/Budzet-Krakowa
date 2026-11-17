#!/usr/bin/env python3
"""Kwoty wykonania z załącznika do uchwały o absolutorium (opinia Komisji Rewizyjnej)."""
import re, subprocess
from pathlib import Path

def money(token):
    token = token.replace("\xa0", " ").replace(" ", "")
    if "," in token:
        whole, frac = token.split(",", 1)
        grosz = int((frac + "00")[:2])
        return int(whole) + (1 if grosz >= 50 else 0)
    return int(token)

NUM = r"(\d{1,3}(?: \d{3})+(?:,\d{1,2})?)"

def section(flat, start, end):
    i = flat.lower().find(start.lower())
    if i < 0:
        return flat
    j = flat.lower().find(end.lower(), i + len(start))
    return flat[i:j if j > 0 else None]

def first(pat, text):
    m = re.search(pat, text, re.I)
    return money(m.group(1)) if m else None

def percent(pat, text):
    m = re.search(pat, text, re.I)
    if not m:
        return None
    return m.group(1).replace(".", ",")

def parse(pdf):
    text = subprocess.check_output(["pdftotext", "-layout", str(pdf), "-"], text=True, errors="replace")
    flat = re.sub(r"\s+", " ", text)
    doch = section(flat, "1. Dochody", "2. Wydatki")
    wyd = section(flat, "2. Wydatki", "3.")
    defi = section(flat, "Deficyt", "7.")
    out = {
        "dochody": first(r"wyniosły ostatecznie " + NUM, doch) or first(r"wykonan\w* .*?" + NUM, doch),
        "dochody_plan": first(r"łącznej kwocie " + NUM, doch) or first(r"kwot[aąę] " + NUM, doch),
        "wydatki": first(r"wydatki ogółem budżetu Miasta wynosiły " + NUM, wyd)
                   or first(r"zostały zrealizowane w wysokości " + NUM, wyd)
                   or first(r"zrealizowane w wysokości " + NUM, wyd),
        "wydatki_plan": first(r"po zmianach zamknął się ostatecznie kwotą " + NUM, wyd)
                        or first(r"Plan wydatków.*?kwotą " + NUM, wyd),
        "dochody_stopien": percent(r"(?:zrealizowane|wykonane) w ([\d]+(?:,\d+)?)%", doch),
        "wydatki_stopien": percent(r"stanowiło ([\d]+(?:,\d+)?)% planu", wyd),
    }
    # deficyt wykonania: „ostatecznie … deficyt … kwocie” bywa różnie; bierzemy ostatnią kwotę w akapicie, jeśli jest „wyniósł”
    m = re.search(r"wyniósł " + NUM, defi)
    if not m:
        m = re.search(r"zamknął się (?:deficytem|wynikiem deficytu)[^.]*?" + NUM, defi)
    if m:
        out["deficyt"] = money(m.group(1))
    udziela = bool(re.search(r"udziela się Prezydentowi Miasta Krakowa absolutorium", flat))
    nie = bool(re.search(r"nie udziela się Prezydentowi", flat, re.I))
    out["udziela"] = udziela and not nie
    return out

if __name__ == "__main__":
    import sys
    print(parse(Path(sys.argv[1])))
