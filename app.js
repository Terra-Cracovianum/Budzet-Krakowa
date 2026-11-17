const YEARS = [];
for (let y = 2016; y <= 2026; y++) YEARS.push(y);

const PALETTE = ["#8d2f1b", "#1e4d6b", "#1d5c40", "#8a5a12", "#5b3a6e", "#9a4a3c", "#2f5d50", "#6e4b2e", "#3d4f73", "#7a3e55", "#4d6740", "#6b5344"];

const state = {
  year: 2026,
  view: "przeglad",
  mapMode: "ogolem",
  dzial: null,
  side: "wydatki",
  series: { wydatki: true, dochody: true, deficyt: true },
  dzialTrend: new Set(),
};

const cache = { budget: {}, wykonanie: {}, trends: null };

const $ = (sel) => document.querySelector(sel);
const app = $("#app");

function mln(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  const fmt = (v, d) => v.toLocaleString("pl-PL", { minimumFractionDigits: d, maximumFractionDigits: d });
  if (a >= 1e9) return `${sign}${fmt(a / 1e9, a >= 10e9 ? 2 : 2)} mld zł`;
  if (a >= 1e6) return `${sign}${fmt(a / 1e6, 0)} mln zł`;
  return `${sign}${Math.round(a).toLocaleString("pl-PL")} zł`;
}
function full(n) {
  if (n == null) return "brak kwoty w dokumencie";
  return `${Math.round(n).toLocaleString("pl-PL")} zł`;
}
function pct(part, whole) {
  if (!whole) return "—";
  return `${((100 * part) / whole).toLocaleString("pl-PL", { maximumFractionDigits: 1 })}%`;
}
function el(tag, attrs = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const kid of kids) node.append(kid);
  return node;
}
function card(...kids) {
  return el("section", { class: "card" }, kids);
}

async function loadBudget(year) {
  if (!cache.budget[year]) {
    const res = await fetch(`data/budget-${year}.json`);
    if (!res.ok) throw new Error(`Brak planu ${year}`);
    cache.budget[year] = await res.json();
  }
  return cache.budget[year];
}
async function loadWykonanie(year) {
  if (year > 2025) return null;
  if (!(year in cache.wykonanie)) {
    const res = await fetch(`data/wykonanie-${year}.json`);
    cache.wykonanie[year] = res.ok ? await res.json() : null;
  }
  return cache.wykonanie[year];
}
async function loadTrends() {
  if (!cache.trends) {
    const res = await fetch("data/trends.json");
    cache.trends = await res.json();
  }
  return cache.trends;
}

function setStatus(text, bad = false) {
  const s = $("#status");
  s.textContent = text;
  s.classList.toggle("error", bad);
}

function sum(rows, key = "plan") {
  return rows.reduce((a, r) => a + (r[key] || 0), 0);
}

function assertYear(doc) {
  const m = doc.meta;
  const dw = sum(doc.wydatki_dzialy);
  const dd = sum(doc.dochody_dzialy);
  const dg = sum(doc.dochody_grupy);
  const fin = sum(m.finansowanie || []);
  const problems = [];
  if (dw !== m.wydatki) problems.push(`działy wydatków ${dw} ≠ §1 ${m.wydatki}`);
  if (dd !== m.dochody) problems.push(`działy dochodów ${dd} ≠ §1 ${m.dochody}`);
  if (dg !== m.dochody) problems.push(`grupy dochodów ${dg} ≠ §1 ${m.dochody}`);
  if (fin !== m.deficyt) problems.push(`finansowanie ${fin} ≠ deficyt ${m.deficyt}`);
  return problems;
}

function bars(rows, total, onPick) {
  const box = el("div");
  const max = Math.max(...rows.map((r) => r.plan), 1);
  for (const r of rows) {
    const label = el("button", { type: "button", text: r.name });
    if (onPick) label.addEventListener("click", () => onPick(r));
    const row = el("div", { class: "bar-row" }, [
      el("div", {}, [
        label,
        el("div", { class: "track" }, [el("i", { style: `width:${(100 * r.plan) / max}%` })]),
      ]),
      el("span", { class: "amt", text: mln(r.plan), title: full(r.plan) }),
    ]);
    box.append(row);
  }
  return box;
}

function heroChart(trends, year) {
  const w = 520, h = 220, pad = 28;
  const rows = trends.lata;
  const max = Math.max(...rows.map((r) => r.wydatki));
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("class", "chart");
  const x = (i) => pad + (i * (w - pad * 2)) / (rows.length - 1);
  const y = (v) => h - pad - (v / max) * (h - pad * 2);
  const path = (key) => rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`).join(" ");
  for (const [key, cls] of [["dochody", "line-d"], ["wydatki", "line-w"], ["deficyt", "line-f"]]) {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", path(key));
    p.setAttribute("class", cls);
    svg.append(p);
  }
  rows.forEach((r, i) => {
    if (i % 2 && r.rok !== year) return;
    const t = document.createElementNS(ns, "text");
    t.setAttribute("x", x(i));
    t.setAttribute("y", h - 8);
    t.setAttribute("text-anchor", "middle");
    t.textContent = r.rok;
    svg.append(t);
    if (r.rok === year) {
      const c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", x(i));
      c.setAttribute("cy", y(r.wydatki));
      c.setAttribute("r", 4);
      c.setAttribute("fill", "currentColor");
      svg.append(c);
    }
  });
  return svg;
}

function renderPrzeglad(doc, trends) {
  const m = doc.meta;
  const problems = assertYear(doc);
  const left = card(
    el("p", { class: "kicker", text: `Plan z uchwały ${m.uchwala}` }),
    el("p", { class: "figure", text: mln(m.wydatki) }),
    el("p", { text: "wydatków w pierwotnej uchwale budżetowej" }),
    el("p", { class: "caption", text: full(m.wydatki) }),
    el("p", {}, [
      document.createTextNode(`Uchwalona ${m.data_uchwaly}. `),
      el("a", { href: m.url_karta, text: "Karta w BIP" }),
      document.createTextNode(" · "),
      el("a", { href: m.url, text: "PDF uchwały" }),
    ]),
  );
  const right = card(
    el("p", { class: "kicker", text: "Plan pierwotny, 2016–2026" }),
    heroChart(trends, state.year),
    el("p", { class: "caption", text: "Cegła: wydatki. Zieleń: dochody. Czerwień: deficyt. Ceny bieżące, bez inflacji." }),
  );
  const tiles = el("div", { class: "tiles" });
  const items = [
    ["Dochody", m.dochody],
    ["Deficyt", m.deficyt],
    ["Wydatki bieżące", m.wydatki_biezace],
    ["Wydatki majątkowe", m.wydatki_majatkowe],
    ["Środki dzielnic", m.dzielnice],
    ["Przychody", m.przychody],
  ];
  for (const [name, value] of items) {
    tiles.append(el("div", { class: "card tile" }, [
      el("span", { text: name }),
      el("strong", { text: mln(value), title: full(value) }),
    ]));
  }
  const top = [...doc.wydatki_dzialy].sort((a, b) => b.plan - a.plan).slice(0, 8);
  const spend = card(
    el("h2", { text: "Największe działy" }),
    bars(top, m.wydatki, (r) => { state.dzial = r.code; show("mapa"); }),
  );
  const income = card(
    el("h2", { text: "Skąd dochody" }),
    bars(doc.dochody_grupy, m.dochody),
    el("p", { class: "caption", text: "Grupy z załącznika dochodów. Suma równa się dochodom z paragrafu 1." }),
  );
  const fin = card(
    el("h2", { text: "Skąd deficyt" }),
    el("p", { class: "kicker", text: "Paragraf 2 uchwały" }),
    bars(m.finansowanie, m.deficyt),
  );
  const wrap = el("div");
  wrap.append(el("div", { class: "hero" }, [left, right]), tiles, el("div", { class: "split", style: "margin-top:12px" }, [spend, income]), fin);
  if (problems.length) wrap.prepend(el("p", { class: "status error", text: problems.join("; ") }));
  return wrap;
}

function valueOf(d) {
  if (state.mapMode === "biezace") return d.biezace || 0;
  if (state.mapMode === "majatkowe") return d.majatkowe || 0;
  return d.plan || 0;
}

function squarify(data, width, height) {
  const items = data.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const out = [];
  let x = 0, y = 0, w = width, h = height;
  let rest = items.slice();
  let rem = items.reduce((s, d) => s + d.value, 0);
  while (rest.length && rem > 0 && w > 1 && h > 1) {
    const horizontal = w >= h;
    const length = horizontal ? w : h;
    const score = (row, rv) => {
      const thick = (rv / rem) * (horizontal ? h : w);
      let worst = 0;
      for (const d of row) {
        const extent = (d.value / rv) * length;
        worst = Math.max(worst, thick / extent, extent / thick);
      }
      return worst;
    };
    const row = [];
    let rv = 0;
    while (rest.length) {
      const next = rest[0];
      if (row.length && score(row.concat(next), rv + next.value) > score(row, rv)) break;
      row.push(rest.shift());
      rv += next.value;
    }
    const thick = (rv / rem) * (horizontal ? h : w);
    let offset = 0;
    for (const d of row) {
      const extent = (d.value / rv) * length;
      out.push(horizontal
        ? { ...d, x: x + offset, y, w: extent, h: thick }
        : { ...d, x, y: y + offset, w: thick, h: extent });
      offset += extent;
    }
    if (horizontal) { y += thick; h -= thick; }
    else { x += thick; w -= thick; }
    rem -= rv;
  }
  return out;
}

function renderMap(doc) {
  const rows = doc.wydatki_dzialy.map((d, i) => ({ ...d, value: valueOf(d), color: PALETTE[i % PALETTE.length] }));
  const known = rows.filter((d) => state.mapMode === "ogolem" || d.value > 0);
  const missing = state.mapMode !== "ogolem" && rows.some((d) => !d[state.mapMode === "biezace" ? "biezace" : "majatkowe"] && d.plan);
  if (!state.dzial || !doc.wydatki_dzialy.some((d) => d.code === state.dzial)) {
    state.dzial = [...doc.wydatki_dzialy].sort((a, b) => b.plan - a.plan)[0].code;
  }
  const selected = doc.wydatki_dzialy.find((d) => d.code === state.dzial);

  const seg = el("div", { class: "seg" });
  for (const [id, label] of [["ogolem", "Ogółem"], ["biezace", "Bieżące"], ["majatkowe", "Majątkowe"]]) {
    seg.append(el("button", { type: "button", class: state.mapMode === id ? "on" : "", text: label, onclick: () => { state.mapMode = id; draw(); } }));
  }
  const map = el("div", { class: "treemap" });
  const panel = card(el("p", { text: "Wybierz dział." }));

  function paint() {
    map.replaceChildren();
    const rect = map.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    const boxes = squarify(known, rect.width, rect.height);
    for (const b of boxes) {
      const btn = el("button", { type: "button", class: `tile-box${b.code === state.dzial ? " on" : ""}` });
      btn.style.left = `${b.x}px`;
      btn.style.top = `${b.y}px`;
      btn.style.width = `${Math.max(b.w, 0)}px`;
      btn.style.height = `${Math.max(b.h, 0)}px`;
      const n = parseInt(b.color.slice(1), 16);
      const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
      btn.style.background = b.color;
      btn.style.color = lum > 0.62 ? "#1a181b" : "#fffdf8";
      if (b.w > 64 && b.h > 36) {
        btn.append(el("b", { text: b.name }), el("small", { text: b.h > 52 ? mln(b.value) : "" }));
      }
      btn.addEventListener("click", () => { state.dzial = b.code; paint(); fill(); });
      map.append(btn);
    }
  }
  function fill() {
    const d = doc.wydatki_dzialy.find((x) => x.code === state.dzial);
    panel.replaceChildren(
      el("p", { class: "kicker", text: `Dział ${d.code}` }),
      el("h2", { text: d.name }),
      el("p", { class: "figure", style: "font-size:40px", text: mln(d.plan) }),
      el("p", { class: "caption", text: `${full(d.plan)} · bieżące ${d.biezace == null ? "nie zsumowane z rozdziałów" : full(d.biezace)} · majątkowe ${d.majatkowe == null ? "nie zsumowane z rozdziałów" : full(d.majatkowe)}` }),
    );
    if (!d.rozdzialy.length) {
      panel.append(el("p", { text: "Rozdziały tego działu nie dodały się do sumy z uchwały, więc rozbicie jest ukryte. Zostaje kwota działu." }));
      return;
    }
    panel.append(el("h3", { text: "Rozdziały" }));
    const max = d.rozdzialy[0].plan || 1;
    for (const r of d.rozdzialy.slice(0, 12)) {
      panel.append(el("div", { class: "chapter" }, [
        el("div", { class: "name" }, [el("span", { text: `${r.code} ${r.name}` }), el("span", { class: "amt", text: mln(r.plan), title: full(r.plan) })]),
        el("div", { class: "track" }, [el("i", { style: `width:${(100 * r.plan) / max}%` })]),
      ]));
    }
  }
  const note = missing
    ? el("p", { class: "caption", text: "Część działów nie ma podziału bieżące/majątkowe, bo rozdziały nie zsumowały się do działu. Paragraf 1 uchwały i tak podaje sumę miasta." })
    : el("p", { class: "caption", text: "Każdy kafelek to dział klasyfikacji budżetowej. Suma kafelków w widoku ogółem równa się wydatkom z paragrafu 1." });
  const layout = el("div", { class: "map-layout" }, [el("div", {}, [seg, map, note]), panel]);
  requestAnimationFrame(() => { paint(); fill(); });
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => { if (map.isConnected) paint(); });
    observer.observe(map);
  }
  return layout;
}

function renderFlow(doc) {
  const m = doc.meta;
  const income = doc.dochody_grupy.filter((g) => g.plan > 0);
  const spend = [...doc.wydatki_dzialy].sort((a, b) => b.plan - a.plan);
  const head = spend.slice(0, 7);
  const rest = spend.slice(7).reduce((s, d) => s + d.plan, 0);
  if (rest) head.push({ name: "Pozostałe działy", plan: rest });
  const left = card(el("h2", { text: "Dochody" }), ...income.map((g) => el("div", { class: "stream" }, [
    el("span", { text: g.name }), el("span", { class: "amt", text: mln(g.plan), title: full(g.plan) }),
  ])));
  const right = card(el("h2", { text: "Wydatki" }), ...head.map((g) => el("div", { class: "stream" }, [
    el("span", { text: g.name }), el("span", { class: "amt", text: mln(g.plan), title: full(g.plan) }),
  ])));
  const gap = card(
    el("h2", { text: "Deficyt" }),
    el("p", { class: "figure", style: "font-size:42px;color:var(--deficit)", text: mln(m.deficyt) }),
    el("p", { class: "caption", text: full(m.deficyt) }),
    el("div", { class: "deficit-note" }, m.finansowanie.map((f) => el("div", { class: "stream" }, [
      el("span", { text: f.name }), el("span", { class: "amt", text: mln(f.plan), title: full(f.plan) }),
    ]))),
    el("p", { class: "caption", text: "Źródła z paragrafu 2. Ich suma równa się deficytowi z paragrafu 1. Przychody z paragrafu 3 bywają większe, bo część spłaca stary dług, a nie tylko tegoroczny deficyt." }),
  );
  return el("div", { class: "flow" }, [el("div", { class: "split" }, [left, right]), gap]);
}

function renderInvest(doc) {
  const m = doc.meta;
  const bie = m.wydatki_biezace || 0;
  const maj = m.wydatki_majatkowe || 0;
  const stack = el("div", { class: "stack" }, [
    el("span", { style: `width:${(100 * bie) / m.wydatki}%;background:#1e4d6b`, title: full(bie) }),
    el("span", { style: `width:${(100 * maj) / m.wydatki}%;background:#8a5a12`, title: full(maj) }),
  ]);
  const byMaj = doc.wydatki_dzialy
    .filter((d) => d.majatkowe)
    .sort((a, b) => b.majatkowe - a.majatkowe);
  const list = card(el("h2", { text: "Działy z wydatkami majątkowymi" }));
  if (!byMaj.length) {
    list.append(el("p", { text: "W tym roku rozdziały nie dały wiarygodnego podziału wewnątrz działów. Zostaje podział miasta z paragrafu 1 i link do uchwały." }));
  } else {
    const covered = byMaj.reduce((s, d) => s + d.majatkowe, 0);
    list.append(bars(byMaj.slice(0, 10).map((d) => ({ name: d.name, plan: d.majatkowe })), covered));
    if (covered !== maj) {
      list.append(el("p", { class: "caption", text: `Z działów, które udało się rozbić, schodzi ${full(covered)} wydatków majątkowych. Paragraf 1 mówi o ${full(maj)}. Różnica zostaje w działach bez kompletnego rozbicia.` }));
    }
  }
  return el("div", {}, [
    card(
      el("h2", { text: "Bieżące i majątkowe" }),
      el("p", { class: "kicker", text: "Podział z paragrafu 1, nie z późniejszych zmian" }),
      stack,
      el("div", { class: "legend" }, [
        el("span", {}, [el("i", { class: "swatch", style: "background:#1e4d6b" }), document.createTextNode(`Bieżące ${mln(bie)}`)]),
        el("span", {}, [el("i", { class: "swatch", style: "background:#8a5a12" }), document.createTextNode(`Majątkowe ${mln(maj)}`)]),
      ]),
      el("p", { class: "caption", text: `${full(bie)} bieżących i ${full(maj)} majątkowych.` }),
      el("p", { text: "Lista pojedynczych zadań inwestycyjnych zostaje w załączniku uchwały. Trafiłaby na stronę tylko wtedy, gdy dałoby się ją dodać do wydatków majątkowych." }),
      el("p", {}, [el("a", { href: m.url, text: "Załączniki w PDF uchwały" })]),
    ),
    list,
  ]);
}

function lineChart(series) {
  const w = 760, h = 320, padL = 48, padR = 12, padT = 16, padB = 28;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("class", "chart");
  const years = series[0].rows.map((r) => r.rok);
  const max = Math.max(1, ...series.flatMap((s) => s.rows.map((r) => r.value)));
  const x = (i) => padL + (i * (w - padL - padR)) / (years.length - 1);
  const y = (v) => h - padB - (v / max) * (h - padT - padB);
  for (let g = 0; g <= 4; g++) {
    const val = (max * g) / 4;
    const yy = y(val);
    const ln = document.createElementNS(ns, "line");
    ln.setAttribute("x1", padL); ln.setAttribute("x2", w - padR);
    ln.setAttribute("y1", yy); ln.setAttribute("y2", yy);
    ln.setAttribute("stroke", "var(--line)");
    svg.append(ln);
    const t = document.createElementNS(ns, "text");
    t.setAttribute("x", 4); t.setAttribute("y", yy + 4);
    t.textContent = mln(val).replace(" zł", "");
    svg.append(t);
  }
  for (const s of series) {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", s.color);
    p.setAttribute("stroke-width", "2.4");
    p.setAttribute("d", s.rows.map((r, i) => `${i ? "L" : "M"}${x(i)},${y(r.value)}`).join(" "));
    svg.append(p);
  }
  years.forEach((rok, i) => {
    const t = document.createElementNS(ns, "text");
    t.setAttribute("x", x(i)); t.setAttribute("y", h - 8); t.setAttribute("text-anchor", "middle");
    t.textContent = rok;
    svg.append(t);
  });
  return svg;
}

function renderTrends(trends) {
  const lata = trends.lata;
  const names = new Map();
  for (const y of lata) for (const d of y.dzialy) names.set(d.code, d.name);
  const topCodes = [...names.keys()]
    .map((code) => ({ code, plan: lata.reduce((s, y) => s + (y.dzialy.find((d) => d.code === code)?.plan || 0), 0) }))
    .sort((a, b) => b.plan - a.plan)
    .slice(0, 6);
  if (!state.dzialTrend.size) state.dzialTrend.add(topCodes[0].code);
  const checks = el("div", { class: "checks" });
  const series = [];
  const addCheck = (id, label, on, color, rows) => {
    const input = el("input", { type: "checkbox" });
    input.checked = on;
    input.addEventListener("change", () => {
      if (id === "wydatki" || id === "dochody" || id === "deficyt") state.series[id] = input.checked;
      else input.checked ? state.dzialTrend.add(id) : state.dzialTrend.delete(id);
      draw();
    });
    checks.append(el("label", {}, [input, el("i", { class: "swatch", style: `background:${color}` }), document.createTextNode(label)]));
    if (on) series.push({ color, rows });
  };
  addCheck("wydatki", "Wydatki", state.series.wydatki, "#8d2f1b", lata.map((r) => ({ rok: r.rok, value: r.wydatki })));
  addCheck("dochody", "Dochody", state.series.dochody, "#1d5c40", lata.map((r) => ({ rok: r.rok, value: r.dochody })));
  addCheck("deficyt", "Deficyt", state.series.deficyt, "#a32020", lata.map((r) => ({ rok: r.rok, value: r.deficyt })));
  topCodes.forEach((d, i) => addCheck(d.code, names.get(d.code), state.dzialTrend.has(d.code), PALETTE[(i + 3) % PALETTE.length],
    lata.map((r) => ({ rok: r.rok, value: r.dzialy.find((x) => x.code === d.code)?.plan || 0 }))));
  return card(
    el("h2", { text: "Jedenaście pierwotnych uchwał" }),
    el("p", { class: "kicker", text: "Złote z roku uchwały, bez przeliczania inflacją" }),
    checks,
    series.length ? lineChart(series) : el("p", { text: "Zaznacz choć jedną serię." }),
  );
}

function renderThousand(doc) {
  const m = doc.meta;
  const base = state.side === "wydatki" ? m.wydatki : m.dochody;
  const rows = state.side === "wydatki"
    ? [...doc.wydatki_dzialy].sort((a, b) => b.plan - a.plan)
    : doc.dochody_grupy;
  const seg = el("div", { class: "seg" });
  for (const [id, label] of [["wydatki", "Z wydatków"], ["dochody", "Z dochodów"]]) {
    seg.append(el("button", { type: "button", class: state.side === id ? "on" : "", text: label, onclick: () => { state.side = id; draw(); } }));
  }
  const raw = rows.map((r) => ({ ...r, raw: (1000 * r.plan) / base }));
  const parts = raw.map((r) => ({ ...r, share: Math.floor(r.raw), frac: r.raw - Math.floor(r.raw) }));
  let left = 1000 - parts.reduce((s, r) => s + r.share, 0);
  for (const r of [...parts].sort((a, b) => b.frac - a.frac)) {
    if (left <= 0) break;
    if (r.raw <= 0) continue;
    r.share += 1;
    left -= 1;
  }
  const list = el("div", { class: "thousand" });
  for (const r of parts.filter((r) => r.share > 0).sort((a, b) => b.share - a.share)) {
    const share = r.share;
    list.append(el("div", { class: "thou-row" }, [
      el("b", { text: `${share} zł` }),
      el("div", {}, [
        el("div", { text: r.name }),
        el("div", { class: "track" }, [el("i", { style: `width:${share / 10}%` })]),
      ]),
    ]));
  }
  return card(
    el("h2", { text: "Z każdych 1000 zł" }),
    el("p", { text: "Udział liczy się tylko z uchwały. Nie ma tu kwoty na mieszkańca: nie dokładam liczby ludności, której nie ma w uchwale." }),
    seg,
    list,
    el("p", { class: "caption", text: `1000 zł z ${full(base)}.` }),
  );
}

function ring(part, whole, label, stated) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 120 120");
  const ratio = stated
    ? Number(stated.replace(",", ".")) / 100
    : whole ? part / whole : 0;
  const shown = Math.max(0, Math.min(ratio, 1));
  const c = 2 * Math.PI * 46;
  const bg = document.createElementNS(ns, "circle");
  bg.setAttribute("cx", 60); bg.setAttribute("cy", 60); bg.setAttribute("r", 46);
  bg.setAttribute("fill", "none"); bg.setAttribute("stroke", "var(--line)"); bg.setAttribute("stroke-width", 10);
  const fg = document.createElementNS(ns, "circle");
  fg.setAttribute("cx", 60); fg.setAttribute("cy", 60); fg.setAttribute("r", 46);
  fg.setAttribute("fill", "none"); fg.setAttribute("stroke", "var(--accent)"); fg.setAttribute("stroke-width", 10);
  fg.setAttribute("stroke-dasharray", `${c * shown} ${c}`);
  fg.setAttribute("stroke-linecap", "butt");
  fg.setAttribute("transform", "rotate(-90 60 60)");
  const t = document.createElementNS(ns, "text");
  t.setAttribute("x", 60); t.setAttribute("y", 64); t.setAttribute("text-anchor", "middle");
  t.setAttribute("fill", "currentColor"); t.setAttribute("font-size", "16");
  t.textContent = stated ? `${stated}%` : whole ? pct(part, whole) : "—";
  svg.append(bg, fg, t);
  return el("div", { class: "ring" }, [svg, el("div", { text: label }), el("div", { class: "caption", text: full(part) })]);
}

function renderWykonanie(doc, exe) {
  const m = doc.meta;
  if (!exe) {
    return card(
      el("p", { class: "abs-wait", text: "Rok w toku" }),
      el("p", { text: `Budżet ${m.rok} ma uchwałę planową ${m.uchwala}. Sprawozdanie z wykonania składa prezydent do 31 marca ${m.rok + 1}, a Rada zatwierdza je i głosuje absolutorium do 30 czerwca ${m.rok + 1}. Nie ma tu procentu wykonania ani karty absolutorium.` }),
    );
  }
  const w = exe.wykonanie;
  const planZm = exe.plan_po_zmianach || {};
  const rings = el("div", { class: "ring-row" });
  if (w.dochody_stopien || planZm.dochody) {
    rings.append(ring(w.dochody, planZm.dochody, "Dochody wobec planu po zmianach", w.dochody_stopien));
  }
  if (w.wydatki_stopien || planZm.wydatki) {
    rings.append(ring(w.wydatki, planZm.wydatki, "Wydatki wobec planu po zmianach", w.wydatki_stopien));
  }
  const table = el("table");
  const tableWrap = el("div", { class: "table-scroll" }, [table]);
  const head = el("tr", {}, ["", "Plan z pierwotnej uchwały", "Plan po zmianach", "Wykonanie"].map((t, i) => el("th", { class: i ? "num" : "", text: t })));
  table.append(head);
  const row = (name, a, b, c) => el("tr", {}, [
    el("td", { text: name }),
    el("td", { class: "num", text: full(a) }),
    el("td", { class: "num", text: b == null ? "—" : full(b) }),
    el("td", { class: "num", text: full(c) }),
  ]);
  table.append(
    row("Dochody", m.dochody, planZm.dochody, w.dochody),
    row("Wydatki", m.wydatki, planZm.wydatki, w.wydatki),
    row("Deficyt", m.deficyt, null, w.deficyt),
  );
  const abs = exe.absolutorium;
  const z = exe.zatwierdzenie;
  const absCard = card(
    el("p", { class: "abs-yes", text: abs.udziela ? "Rada udzieliła absolutorium" : "Rada nie udzieliła absolutorium" }),
    el("p", { text: `Uchwała ${abs.nr} z ${abs.data}. To osobne głosowanie od zatwierdzenia sprawozdania i od wotum zaufania.` }),
    el("p", {}, [
      el("a", { href: abs.karta, text: "Karta absolutorium" }),
      document.createTextNode(" · "),
      el("a", { href: abs.pdf, text: "PDF" }),
    ]),
    el("p", { class: "caption", text: "Liczby głosów nie ma w tekście uchwały. Są w protokole sesji na BIP, przy tej karcie." }),
    el("h3", { text: "Zatwierdzenie sprawozdania" }),
    el("p", { text: `${z.nr} z ${z.data}` }),
    el("p", {}, [el("a", { href: z.karta, text: "Karta zatwierdzenia" }), document.createTextNode(" · "), el("a", { href: z.pdf, text: "PDF" })]),
  );
  const note = w.deficyt_z_tekstu
    ? "Deficyt wykonania jest kwotą z opinii Komisji Rewizyjnej."
    : "Opinia podaje dochody i wydatki wykonania. Deficyt w tabeli to ich różnica, bo w tym roczniku opinia nie zapisała osobnej kwoty wyniku.";
  return el("div", {}, [
    card(
      el("h2", { text: "Plan i wykonanie" }),
      el("p", { text: "Pierścień liczy się wobec planu po zmianach, i tylko wtedy, gdy opinia tę kwotę zapisuje. Nie przeliczam wykonania na procent planu pierwotnego." }),
      rings,
      tableWrap,
      el("p", { class: "caption", text: note }),
      el("p", { class: "caption", text: "Grosze z opinii są zaokrąglone do pełnych złotych." }),
    ),
    absCard,
  ]);
}

const views = {
  przeglad: renderPrzeglad,
  mapa: renderMap,
  przeplyw: renderFlow,
  inwestycje: renderInvest,
  trendy: renderTrends,
  tysiac: renderThousand,
  wykonanie: renderWykonanie,
};

async function draw() {
  setStatus("Wczytuję uchwałę…");
  try {
    const doc = await loadBudget(state.year);
    const trends = await loadTrends();
    const exe = state.view === "wykonanie" || state.view === "przeglad" ? await loadWykonanie(state.year) : null;
    const node = state.view === "trendy"
      ? views.trendy(trends)
      : state.view === "przeglad"
        ? views.przeglad(doc, trends)
        : state.view === "wykonanie"
          ? views.wykonanie(doc, exe)
          : views[state.view](doc);
    app.replaceChildren(node);
    const problems = assertYear(doc);
    setStatus(problems.length ? problems.join(" · ") : `Uchwała ${doc.meta.uchwala}, kwoty zgodne z paragrafem 1.`, problems.length > 0);
    history.replaceState(null, "", `#${state.view}`);
  } catch (err) {
    setStatus(err.message || String(err), true);
  }
}

function show(view) {
  state.view = view;
  for (const b of document.querySelectorAll(".views button")) b.classList.toggle("on", b.dataset.view === view);
  draw();
}

function init() {
  const select = $("#year");
  for (const y of YEARS) select.append(el("option", { value: y, text: String(y) }));
  const saved = localStorage.getItem("krakow-theme");
  const dark = saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $("#theme").setAttribute("aria-pressed", String(dark));
  $("#theme").textContent = dark ? "Jasny" : "Ciemny";
  const hash = location.hash.replace("#", "");
  if (views[hash]) state.view = hash;
  select.value = String(state.year);
  for (const b of document.querySelectorAll(".views button")) {
    b.classList.toggle("on", b.dataset.view === state.view);
    b.addEventListener("click", () => show(b.dataset.view));
  }
  select.addEventListener("change", () => { state.year = Number(select.value); state.dzial = null; draw(); });
  $("#prev-year").addEventListener("click", () => { state.year = Math.max(2016, state.year - 1); select.value = state.year; state.dzial = null; draw(); });
  $("#next-year").addEventListener("click", () => { state.year = Math.min(2026, state.year + 1); select.value = state.year; state.dzial = null; draw(); });
  window.addEventListener("hashchange", () => {
    const hash = location.hash.replace("#", "");
    if (views[hash] && hash !== state.view) show(hash);
  });
  $("#theme").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("krakow-theme", next);
    $("#theme").setAttribute("aria-pressed", String(next === "dark"));
    $("#theme").textContent = next === "dark" ? "Jasny" : "Ciemny";
  });
  draw();
}

init();
