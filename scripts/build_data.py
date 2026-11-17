#!/usr/bin/env python3
"""Składa data/budget-YYYY.json, data/wykonanie-YYYY.json i data/trends.json."""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from extract_budget import extract
from extract_wykonanie import parse as parse_abs

PDF = "https://www.bip.krakow.pl/_inc/rada/uchwaly/show_pdf.php?id={}"

PLANS = {
    2016: {"nr": "XXXIV/549/15", "data": "2015-12-16", "pdf": 80453, "dok": 21194},
    2017: {"nr": "LXI/1319/16", "data": "2016-12-21", "pdf": 87715, "dok": 22004},
    2018: {"nr": "XCI/2374/17", "data": "2017-12-20", "pdf": 96013, "dok": 23079},
    2019: {"nr": "V/87/19", "data": "2019-01-10", "pdf": 103800, "dok": 23900},
    2020: {"nr": "XXXII/803/19", "data": "2019-12-18", "pdf": 110969, "dok": 24687},
    2021: {"nr": "L/1375/20", "data": "2020-12-16", "pdf": 116708, "dok": 25336},
    2022: {"nr": "LXXV/2083/21", "data": "2021-12-15", "pdf": 122773, "dok": 26120},
    2023: {"nr": "CII/2768/22", "data": "2022-12-21", "pdf": 129072, "dok": 26878},
    2024: {"nr": "CXXV/3406/23", "data": "2023-12-20", "pdf": 134352, "dok": 27592},
    2025: {"nr": "XVII/391/24", "data": "2024-12-18", "pdf": 138939, "dok": 28276},
    2026: {"nr": "XLIV/890/25", "data": "2025-12-17", "pdf": 143102, "dok": 28815},
}

ABS = {
    2016: {"nr": "LXXVIII/1892/17", "data": "2017-06-28", "pdf": 92190, "dok": 22592,
           "zatwierdzenie": {"nr": "LXXVIII/1891/17", "data": "2017-06-28", "pdf": 92189, "dok": 22591}},
    2017: {"nr": "CVI/2698/18", "data": "2018-06-27", "pdf": 100083, "dok": 23420,
           "zatwierdzenie": {"nr": "CVI/2697/18", "data": "2018-06-27", "pdf": 100082, "dok": 23419}},
    2018: {"nr": "XX/380/19", "data": "2019-06-26", "pdf": 107307, "dok": 24209,
           "zatwierdzenie": {"nr": "XX/379/19", "data": "2019-06-26", "pdf": 107306, "dok": 24208}},
    2019: {"nr": "XLIII/1109/20", "data": "2020-07-08", "pdf": 114163, "dok": 25072,
           "zatwierdzenie": {"nr": "XLIII/1108/20", "data": "2020-07-08", "pdf": 114162, "dok": 25069}},
    2020: {"nr": "LXI/1760/21", "data": "2021-06-30", "pdf": 119957, "dok": 25760,
           "zatwierdzenie": {"nr": "LXI/1759/21", "data": "2021-06-30", "pdf": 119956, "dok": 25759}},
    2021: {"nr": "XCI/2448/22", "data": "2022-06-29", "pdf": 126265, "dok": 26527,
           "zatwierdzenie": {"nr": "XCI/2447/22", "data": "2022-06-29", "pdf": 126264, "dok": 26526}},
    2022: {"nr": "CXIV/3047/23", "data": "2023-06-28", "pdf": 131695, "dok": 27163,
           "zatwierdzenie": {"nr": "CXIV/3046/23", "data": "2023-06-28", "pdf": 131694, "dok": 27162}},
    2023: {"nr": "VI/77/24", "data": "2024-06-19", "pdf": 136783, "dok": 27949,
           "zatwierdzenie": {"nr": "VI/76/24", "data": "2024-06-19", "pdf": 136782, "dok": 27948}},
    2024: {"nr": "XXXII/618/25", "data": "2025-06-11", "pdf": 141067, "dok": 28519,
           "zatwierdzenie": {"nr": "XXXII/617/25", "data": "2025-06-11", "pdf": 141066, "dok": 28518}},
    2025: {"nr": "LV/1162/26", "data": "2026-06-24", "pdf": 145415, "dok": 29109,
           "zatwierdzenie": {"nr": "LV/1160/26", "data": "2026-06-24", "pdf": 145413, "dok": 29107}},
}

def link(pdf, dok):
    return {
        "pdf": PDF.format(pdf),
        "karta": f"https://www.bip.krakow.pl/?dok_id=167&sub=uchwala&sub_dok_id=167&query=id%3D{dok}%26typ%3Du",
    }

def slim_income(dzialy):
    out = []
    for d in dzialy:
        paras = sorted(d["paragrafy"], key=lambda p: -p["plan"])
        # bez pozycji, które PDF rozbił na kwotę bez nazwy i które dublują sumę — zostawiamy te z nazwą albo kodem
        out.append({
            "code": d["code"], "name": d["name"], "plan": d["plan"],
            "biezace": d["biezace"], "majatkowe": d["majatkowe"],
            "paragrafy": [{"code": p["code"], "name": p["name"], "plan": p["plan"], "rodzaj": p["rodzaj"]}
                          for p in paras if p["plan"] > 0][:12],
        })
    return out

def slim_expense(dzialy):
    out = []
    for d in dzialy:
        out.append({
            "code": d["code"], "name": d["name"], "plan": d["plan"],
            "biezace": d["biezace"], "majatkowe": d["majatkowe"],
            "rozdzialy": [{"code": r["code"], "name": r["name"], "plan": r["plan"],
                           "biezace": r["biezace"], "majatkowe": r["majatkowe"]}
                          for r in sorted(d["rozdzialy"], key=lambda r: -r["plan"])],
        })
    return out

def main():
    data = ROOT / "data"
    data.mkdir(exist_ok=True)
    trends = []
    for year, src in PLANS.items():
        meta, income, expense, grupy, problems = extract(f"/tmp/krakow-pdf/{year}.pdf")
        hard = [p for p in problems if "pominięte" not in p]
        if hard:
            raise SystemExit(f"{year}: {hard}")
        meta.update({
            "rok": year, "typ": "plan", "jednostka": "zł",
            "uchwala": src["nr"], "data_uchwaly": src["data"],
            **{f"url_{k}": v for k, v in link(src["pdf"], src["dok"]).items()},
        })
        # link() keys pdf, karta — prefix above makes url_pdf, url_karta. Fix names.
        meta["url"] = link(src["pdf"], src["dok"])["pdf"]
        meta["url_karta"] = link(src["pdf"], src["dok"])["karta"]
        meta.pop("url_pdf", None)
        doc = {
            "meta": meta,
            "dochody_grupy": grupy,
            "dochody_dzialy": slim_income(income),
            "wydatki_dzialy": slim_expense(expense),
        }
        (data / f"budget-{year}.json").write_text(
            json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        trends.append({
            "rok": year,
            "wydatki": meta["wydatki"],
            "dochody": meta["dochody"],
            "deficyt": meta["deficyt"],
            "wydatki_biezace": meta.get("wydatki_biezace"),
            "wydatki_majatkowe": meta.get("wydatki_majatkowe"),
            "dzialy": [{"code": d["code"], "name": d["name"], "plan": d["plan"]} for d in expense],
        })
        print(year, "plan OK", "uwagi", [p for p in problems if "pominięte" in p])

    for year, src in ABS.items():
        got = parse_abs(f"/tmp/abs/{year}.pdf")
        if not got.get("udziela"):
            raise SystemExit(f"absolutorium {year} nie wygląda na udzielenie: {got}")
        if not got.get("dochody") or not got.get("wydatki"):
            raise SystemExit(f"brak kwot wykonania {year}: {got}")
        z = src["zatwierdzenie"]
        doc = {
            "rok": year,
            "jednostka": "zł",
            "zrodlo": "Załącznik do uchwały o absolutorium: opinia Komisji Rewizyjnej o wykonaniu budżetu. "
                      "Plan w tym pliku, jeśli jest, to plan po zmianach podany w tej opinii, nie plan pierwotny.",
            "wykonanie": {
                "dochody": got["dochody"],
                "wydatki": got["wydatki"],
                "deficyt": got.get("deficyt") or (got["wydatki"] - got["dochody"]),
                "deficyt_z_tekstu": "deficyt" in got,
                "dochody_stopien": got.get("dochody_stopien"),
                "wydatki_stopien": got.get("wydatki_stopien"),
            },
            "plan_po_zmianach": {
                "dochody": got.get("dochody_plan"),
                "wydatki": got.get("wydatki_plan"),
            },
            "zatwierdzenie": {"nr": z["nr"], "data": z["data"], **link(z["pdf"], z["dok"])},
            "absolutorium": {
                "udziela": True,
                "nr": src["nr"],
                "data": src["data"],
                **link(src["pdf"], src["dok"]),
            },
        }
        (data / f"wykonanie-{year}.json").write_text(
            json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(year, "wykonanie", doc["wykonanie"])

    (data / "trends.json").write_text(
        json.dumps({"lata": trends}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("zapisane")

if __name__ == "__main__":
    main()
