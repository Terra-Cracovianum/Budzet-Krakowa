const YEARS = [];
for (let y = 2016; y <= 2026; y++) YEARS.push(y);

const PALETTE = ["#8d2f1b", "#1e4d6b", "#1d5c40", "#8a5a12", "#5b3a6e", "#9a4a3c", "#2f5d50", "#6e4b2e", "#3d4f73", "#7a3e55", "#4d6740", "#6b5344", "#355c7d", "#7b4b3a"];
const NS = "http://www.w3.org/2000/svg";
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  year: 2026,
  view: "przeglad",
  mapMode: "ogolem",
  side: "wydatki",
  series: { wydatki: true, dochody: true, deficyt: true },
  dzialTrend: new Set(),
  amount: null,
};

const cache = { budget: {}, wykonanie: {}, trends: null };
const $ = (sel) => document.querySelector(sel);

function colorOf(code) {
  let h = 0;
  for (const ch of String(code)) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function inkFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? "#1b1a18" : "#fffdf8";
}
function mln(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  const fmt = (v, d) => v.toLocaleString("pl-PL", { minimumFractionDigits: d, maximumFractionDigits: d });
  if (a >= 1e9) return `${sign}${fmt(a / 1e9, 2)} mld zł`;
  if (a >= 1e6) return `${sign}${fmt(a / 1e6, 0)} mln zł`;
  return `${sign}${Math.round(a).toLocaleString("pl-PL")} zł`;
}
function full(n) {
  if (n == null) return "brak kwoty w dokumencie";
  return `${Math.round(n).toLocaleString("pl-PL")} zł`;
}
function sum(rows, key = "plan") {
  return rows.reduce((s, r) => s + (r[key] || 0), 0);
}
function el(tag, attrs = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) if (kid != null) node.append(kid);
  return node;
}
function svg(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}
function clear(node) { node.replaceChildren(); }
function tween(from, to, ms, on) {
  if (reduce || from == null || from === to) { on(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    const e = 1 - (1 - p) ** 3;
    on(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function amountNode(value, name) {
  const node = el("span", { class: "amt", text: mln(value), "data-full": `${name ? name + ": " : ""}${full(value)}` });
  return node;
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
  if (!cache.trends) cache.trends = await (await fetch("data/trends.json")).json();
  return cache.trends;
}
function doc() { return cache.budget[state.year]; }
function assertYear(d) {
  const m = d.meta;
  const problems = [];
  if (sum(d.wydatki_dzialy) !== m.wydatki) problems.push("działy wydatków nie schodzą się z §1");
  if (sum(d.dochody_dzialy) !== m.dochody) problems.push("działy dochodów nie schodzą się z §1");
  if (sum(d.dochody_grupy) !== m.dochody) problems.push("grupy dochodów nie schodzą się z §1");
  if (sum(m.finansowanie || []) !== m.deficyt) problems.push("finansowanie nie schodzi się z deficytem");
  return problems;
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

function wrapName(name, maxChars, maxLines) {
  const words = name.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars) {
      line = next;
      continue;
    }
  if (line) lines.push(line);
    if (lines.length === maxLines) {
      const last = lines[maxLines - 1];
      if (!last.endsWith("…")) lines[maxLines - 1] = `${last.slice(0, Math.max(1, maxChars - 1))}…`;
      return lines;
    }
    line = word.length > maxChars ? `${word.slice(0, Math.max(1, maxChars - 1))}…` : word;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function valueOf(d) {
  if (state.mapMode === "biezace") return d.biezace || 0;
  if (state.mapMode === "majatkowe") return d.majatkowe || 0;
  return d.plan || 0;
}

function paintTreemap(svgEl, rows, onPick) {
  const width = svgEl.clientWidth || 640;
  const height = svgEl.clientHeight || 240;
  svgEl.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const boxes = squarify(rows.map((d) => ({ ...d, value: d.value })), width, height);
  const prev = new Map([...svgEl.querySelectorAll("g")].map((g) => [g.dataset.code, g]));
  const keep = new Set();
  for (const b of boxes) {
    keep.add(b.code);
    let g = prev.get(b.code);
    if (!g) {
      g = svg("g", { "data-code": b.code });
      const rect = svg("rect", { rx: 8 });
      const label = svg("text");
      const sub = svg("text");
      g.append(rect, label, sub);
      g.addEventListener("click", () => onPick(b));
      svgEl.append(g);
    }
    const [rect, label, sub] = g.children;
    const fill = colorOf(b.code);
    const clipId = `clip-${svgEl.id}-${b.code}`;
    let clip = svgEl.querySelector(`#${CSS.escape(clipId)}`);
    if (!clip) {
      clip = svg("clipPath", { id: clipId });
      clip.append(svg("rect"));
      let defs = svgEl.querySelector("defs");
      if (!defs) { defs = svg("defs"); svgEl.prepend(defs); }
      defs.append(clip);
    }
    const clipRect = clip.firstChild;
    clipRect.setAttribute("x", b.x + 8);
    clipRect.setAttribute("y", b.y + 6);
    clipRect.setAttribute("width", Math.max(0, b.w - 16));
    clipRect.setAttribute("height", Math.max(0, b.h - 10));
    label.setAttribute("clip-path", `url(#${clipId})`);
    sub.setAttribute("clip-path", `url(#${clipId})`);
    rect.setAttribute("x", b.x + 1.5);
    rect.setAttribute("y", b.y + 1.5);
    rect.setAttribute("width", Math.max(0, b.w - 3));
    rect.setAttribute("height", Math.max(0, b.h - 3));
    rect.setAttribute("fill", fill);
    const perLine = Math.max(4, Math.floor((b.w - 18) / 6.4));
    const lines = b.h > 72 ? wrapName(b.name, perLine, 2) : b.h > 32 ? wrapName(b.name, perLine, 1) : [];
    label.replaceChildren();
    lines.forEach((line, i) => {
      const span = svg("tspan", { x: b.x + 10, dy: i === 0 ? 0 : 15 });
      span.textContent = line;
      label.append(span);
    });
    label.setAttribute("x", b.x + 10);
    label.setAttribute("y", b.y + 20);
    sub.textContent = lines.length && b.h > lines.length * 16 + 28 ? mln(b.value) : "";
    sub.setAttribute("x", b.x + 10);
    sub.setAttribute("y", b.y + 22 + lines.length * 15);
    const ink = inkFor(fill);
    label.setAttribute("fill", ink);
    sub.setAttribute("fill", ink);
    sub.setAttribute("font-size", "11");
    g.dataset.full = `${b.name}: ${full(b.value)}`;
  }
  for (const [code, g] of prev) if (!keep.has(code)) g.remove();
}

function bars(mount, rows, key = "plan") {
  clear(mount);
  const max = Math.max(...rows.map((r) => r[key] || 0), 1);
  for (const r of rows) {
    const value = r[key] || 0;
    const i = el("i");
    i.style.width = `${(100 * value) / max}%`;
    i.style.setProperty("--w", i.style.width);
    mount.append(el("div", { class: "bar-row" }, [
      el("div", {}, [el("div", { text: r.name }), el("div", { class: "track" }, [i])]),
      amountNode(value, r.name),
    ]));
  }
}

function openSheet(d) {
  const body = $("#sheet-body");
  clear(body);
  body.append(
    el("p", { class: "mono", text: `Dział ${d.code}` }),
    el("h2", { id: "sheet-title", text: d.name }),
    el("p", { class: "hero-n", style: "font-size:48px", text: mln(valueOf(d) || d.plan) }),
    el("p", { class: "caption", text: `${full(d.plan)} ogółem` }),
  );
  const split = d.biezace == null
    ? "Podział bieżące i majątkowe nie zsumował się z rozdziałów. Zostaje kwota działu."
    : `Bieżące ${full(d.biezace)}. Majątkowe ${full(d.majatkowe)}.`;
  body.append(el("p", { text: split }));
  if (!d.rozdzialy?.length) {
    body.append(el("p", { text: "Rozdziały tego działu nie dodały się do sumy z uchwały, więc rozbicie jest ukryte." }));
  } else {
    body.append(el("h3", { text: "Rozdziały" }));
    const max = d.rozdzialy[0].plan || 1;
    for (const r of d.rozdzialy.slice(0, 14)) {
      const i = el("i");
      i.style.width = `${(100 * r.plan) / max}%`;
      i.style.setProperty("--w", i.style.width);
      body.append(el("div", { class: "chapter" }, [
        el("div", { class: "name" }, [
          el("span", { text: `${r.code} ${r.name}` }),
          amountNode(r.plan, r.name),
        ]),
        el("div", { class: "track" }, [i]),
      ]));
    }
  }
  $("#sheet-backdrop").hidden = false;
  const sheet = $("#sheet");
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add("on"));
  $("#sheet-close").focus();
}
function closeSheet() {
  $("#sheet").classList.remove("on");
  $("#sheet-backdrop").hidden = true;
  setTimeout(() => { $("#sheet").hidden = true; }, reduce ? 0 : 280);
}

function yearReadout(row) {
  const box = $("#year-detail");
  clear(box);
  const top = [...row.dzialy].sort((a, b) => b.plan - a.plan).slice(0, 6);
  box.append(el("div", { class: "yd-h" }, [
    el("strong", { text: String(row.rok) }),
    el("span", { class: "mono", text: "plan pierwotny" }),
  ]));
  box.append(el("div", { class: "yd-sums" }, [
    el("span", { text: `Wydatki ${mln(row.wydatki)}` }),
    el("span", { text: `Dochody ${mln(row.dochody)}` }),
    el("span", { text: `Deficyt ${mln(row.deficyt)}` }),
  ]));
  for (const d of top) {
    box.append(el("div", { class: "line" }, [
      el("span", { text: d.name }),
      el("span", { class: "amt", text: mln(d.plan), "data-full": `${row.rok}, ${d.name}: ${full(d.plan)}` }),
    ]));
  }
}

function paintYearChart(trends) {
  const svgEl = $("#year-chart");
  const w = 560, h = 210, pad = 26;
  svgEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
  clear(svgEl);
  const rows = trends.lata;
  const max = Math.max(...rows.map((r) => r.wydatki));
  const x = (i) => pad + (i * (w - pad * 2)) / (rows.length - 1);
  const y = (v) => h - pad - (v / max) * (h - pad * 1.7);
  const slot = (w - pad * 2) / (rows.length - 1);
  const path = (key) => rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`).join(" ");
  const guide = svg("line", { y1: 8, y2: h - pad, stroke: "var(--ink)", "stroke-opacity": "0.18", "stroke-width": 1 });
  svgEl.append(guide);
  for (const [key, stroke] of [["dochody", "var(--good)"], ["wydatki", "var(--accent)"], ["deficyt", "var(--deficit)"]]) {
    svgEl.append(svg("path", { d: path(key), fill: "none", stroke, "stroke-width": 2.4 }));
  }
  const cols = [];
  rows.forEach((r, i) => {
    const col = svg("rect", { class: "yc-col", x: x(i) - slot / 2, y: 4, width: slot, height: h - 8, fill: "transparent" });
    col.addEventListener("click", () => setYear(r.rok));
    svgEl.append(col);
    cols.push(col);
    const t = svg("text", { x: x(i), y: h - 8, "text-anchor": "middle", fill: "var(--ink-2)", "font-size": 11 });
    t.textContent = r.rok;
    svgEl.append(t);
    svgEl.append(svg("circle", {
      cx: x(i), cy: y(r.wydatki), r: r.rok === state.year ? 5 : 3.2,
      fill: r.rok === state.year ? "var(--ink)" : "var(--accent)",
    }));
    svgEl.append(svg("circle", { cx: x(i), cy: y(r.dochody), r: 2.4, fill: "var(--good)" }));
  });
  const focus = (index) => {
    const row = rows[index];
    guide.setAttribute("x1", x(index));
    guide.setAttribute("x2", x(index));
    cols.forEach((col, i) => { col.style.fill = i === index ? "color-mix(in srgb, var(--ink) 8%, transparent)" : "transparent"; });
    svgEl.append(guide);
    yearReadout(row);
  };
  const indexAt = (event) => {
    const rect = svgEl.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * w;
    let best = 0;
    let dist = Infinity;
    rows.forEach((r, i) => {
      const d = Math.abs(x(i) - px);
      if (d < dist) { dist = d; best = i; }
    });
    return best;
  };
  svgEl.onpointermove = (event) => focus(indexAt(event));
  svgEl.onpointerdown = (event) => focus(indexAt(event));
  svgEl.onpointerleave = () => focus(Math.max(0, rows.findIndex((r) => r.rok === state.year)));
  focus(Math.max(0, rows.findIndex((r) => r.rok === state.year)));
}

function paintOverview(trends, exe) {
  const d = doc();
  const m = d.meta;
  $("#hero-eye").textContent = `Uchwała ${m.uchwala} · plan pierwotny`;
  const from = state.amount ?? m.wydatki;
  tween(from, m.wydatki, 720, (v) => {
    $("#hero-amt").textContent = (v / 1e9).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  });
  state.amount = m.wydatki;
  $("#hero-unit").textContent = "mld zł";
  $("#hero-lead").textContent = "Tyle miasto planuje wydać w pierwotnej uchwale budżetowej.";
  $("#hero-full").textContent = full(m.wydatki);
  const links = $("#hero-links");
  clear(links);
  links.append(
    document.createTextNode(`Uchwalona ${m.data_uchwaly}. `),
    el("a", { href: m.url_karta, text: "Karta w BIP" }),
    document.createTextNode(" · "),
    el("a", { href: m.url, text: "PDF uchwały" }),
  );
  $("#hdr-amt").textContent = `${state.year} · ${mln(m.wydatki)}`;
  $("#hdr-amt").dataset.full = full(m.wydatki);

  const ticker = $("#ticker");
  clear(ticker);
  for (const [name, value] of [
    ["Dochody", m.dochody], ["Deficyt", m.deficyt], ["Bieżące", m.wydatki_biezace],
    ["Majątkowe", m.wydatki_majatkowe], ["Dzielnice", m.dzielnice], ["Przychody", m.przychody],
  ]) {
    ticker.append(el("div", { class: "tick", "data-full": full(value) }, [
      el("span", { text: name }),
      el("strong", { text: mln(value) }),
      el("em", { text: full(value) }),
    ]));
  }

  const ranked = [...d.wydatki_dzialy].sort((a, b) => b.plan - a.plan);
  $("#ov-map-h").textContent = ranked[0] ? ranked[0].name : "";
  const mapRows = [];
  let restPlan = 0;
  for (const row of ranked) {
    if (mapRows.length >= 8 && row.plan / m.wydatki < 0.035) restPlan += row.plan;
    else mapRows.push({ ...row, value: row.plan });
  }
  if (restPlan) mapRows.push({ code: "reszta", name: "Pozostałe działy", plan: restPlan, value: restPlan, rozdzialy: [] });
  requestAnimationFrame(() => paintTreemap($("#ov-treemap"), mapRows, (b) => {
    if (b.code === "reszta") { show("mapa"); return; }
    const found = d.wydatki_dzialy.find((x) => x.code === b.code);
    show("mapa");
    openSheet(found);
  }));
  bars($("#ov-src"), d.dochody_grupy);
  bars($("#ov-fin"), m.finansowanie);
  $("#ov-def-h").textContent = mln(m.deficyt);

  const exec = $("#ov-exec");
  clear(exec);
  if (!exe) {
    exec.append(el("p", { class: "abs-wait", text: "Rok w toku" }), el("p", { text: `Sprawozdanie i absolutorium przypadają do 30 czerwca ${m.rok + 1}.` }));
  } else {
    exec.append(
      el("p", { class: "h", text: exe.wykonanie.wydatki_stopien ? `${exe.wykonanie.wydatki_stopien}%` : mln(exe.wykonanie.wydatki) }),
      el("p", { text: "wydatków wobec planu po zmianach, według opinii Komisji Rewizyjnej." }),
      el("p", { class: exe.absolutorium.udziela ? "abs-yes" : "abs-wait", style: "font-size:28px", text: exe.absolutorium.udziela ? "Absolutorium udzielone" : "Bez absolutorium" }),
      el("p", { class: "caption", text: `${exe.absolutorium.nr} · ${exe.absolutorium.data}` }),
    );
  }
}

function paintMap() {
  const d = doc();
  const rows = d.wydatki_dzialy.map((row) => ({ ...row, value: valueOf(row) }));
  const known = rows.filter((row) => row.value > 0);
  requestAnimationFrame(() => paintTreemap($("#map-svg"), known, (b) => {
    openSheet(d.wydatki_dzialy.find((x) => x.code === b.code));
  }));
  const missing = state.mapMode !== "ogolem" && d.wydatki_dzialy.some((row) => !row[state.mapMode] && row.plan);
  $("#map-note").textContent = missing
    ? "Część działów nie ma podziału, bo rozdziały nie zsumowały się do działu. Paragraf 1 i tak podaje sumę miasta."
    : "Suma pól w widoku ogółem równa się wydatkom z paragrafu 1.";
  for (const b of $("#map-seg").querySelectorAll("button")) {
    const on = b.dataset.mode === state.mapMode;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  }
}

function paintFlow() {
  const d = doc();
  const m = d.meta;
  const svgEl = $("#sankey");
  const width = Math.max(320, svgEl.clientWidth || 900);
  const height = width < 640 ? 640 : 480;
  svgEl.setAttribute("viewBox", `0 0 ${width} ${height}`);
  clear(svgEl);
  const spend = [...d.wydatki_dzialy].sort((a, b) => b.plan - a.plan);
  const head = spend.slice(0, 6).map((row) => ({ id: `w-${row.code}`, name: row.name, plan: row.plan }));
  const rest = spend.slice(6).reduce((s, row) => s + row.plan, 0);
  if (rest) head.push({ id: "w-rest", name: "Pozostałe działy", plan: rest });
  const left = [
    ...d.dochody_grupy.filter((g) => g.plan > 0).map((g, i) => ({ id: `d-${i}`, name: g.name, plan: g.plan })),
    { id: "def", name: "Deficyt", plan: m.deficyt, deficit: true },
  ];
  const nodes = [...left, { id: "budzet", name: "Budżet" }, ...head];
  const links = [
    ...left.map((L) => ({ source: L.id, target: "budzet", value: L.plan, deficit: !!L.deficit })),
    ...head.map((R) => ({ source: "budzet", target: R.id, value: R.plan })),
  ];
  if (!window.d3 || !d3.sankey) {
    $("#flow-note").textContent = "Diagram przepływu nie wczytał się. Kwoty są w przeglądzie.";
    return;
  }
  const graph = d3.sankey().nodeId((n) => n.id).nodeWidth(14).nodePadding(16).extent([[128, 10], [width - 168, height - 10]])({
    nodes: nodes.map((n) => ({ ...n })),
    links: links.map((l) => ({ ...l })),
  });
  for (const link of graph.links) {
    const path = svg("path", {
      class: "sankey-link",
      d: d3.sankeyLinkHorizontal()(link),
      stroke: link.deficit ? "var(--deficit)" : "var(--accent)",
      "stroke-opacity": link.deficit ? 0.45 : 0.28,
      "stroke-width": Math.max(1, link.width),
      "data-full": `${link.source.name} → ${link.target.name}: ${full(link.value)}`,
    });
    svgEl.append(path);
  }
  for (const node of graph.nodes) {
    svgEl.append(svg("rect", {
      x: node.x0, y: node.y0, width: node.x1 - node.x0, height: Math.max(1, node.y1 - node.y0),
      fill: node.deficit ? "var(--deficit)" : (String(node.id).startsWith("w-") ? colorOf(node.id) : "var(--good)"), rx: 3,
    }));
    if (node.y1 - node.y0 < 18 || node.id === "budzet") continue;
    const right = String(node.id).startsWith("w-");
    const label = svg("text", {
      class: "sankey-label",
      x: node.id === "budzet" ? (node.x0 + node.x1) / 2 : right ? node.x0 - 8 : node.x1 + 8,
      y: (node.y0 + node.y1) / 2,
      "text-anchor": node.id === "budzet" ? "middle" : right ? "end" : "start",
      "dominant-baseline": "middle",
    });
    label.textContent = node.name;
    svgEl.append(label);
  }
  $("#flow-note").textContent = `Deficyt ${full(m.deficyt)} pokrywają: ${m.finansowanie.map((f) => `${f.name} ${full(f.plan)}`).join(", ")}.`;
}

function paintInvest() {
  const m = doc().meta;
  const stack = $("#inv-stack");
  clear(stack);
  const bie = el("span");
  const maj = el("span");
  bie.style.width = `${(100 * m.wydatki_biezace) / m.wydatki}%`;
  maj.style.width = `${(100 * m.wydatki_majatkowe) / m.wydatki}%`;
  bie.style.background = "#1e4d6b";
  maj.style.background = "#8a5a12";
  bie.style.setProperty("--w", bie.style.width);
  maj.style.setProperty("--w", maj.style.width);
  stack.append(bie, maj);
  const legend = $("#inv-legend");
  clear(legend);
  legend.append(
    el("span", {}, [el("i", { class: "swatch", style: "background:#1e4d6b" }), document.createTextNode(`Bieżące ${mln(m.wydatki_biezace)}`)]),
    el("span", {}, [el("i", { class: "swatch", style: "background:#8a5a12" }), document.createTextNode(`Majątkowe ${mln(m.wydatki_majatkowe)}`)]),
  );
  $("#inv-full").textContent = `${full(m.wydatki_biezace)} bieżących i ${full(m.wydatki_majatkowe)} majątkowych.`;
  const link = $("#inv-link");
  clear(link);
  link.append(el("a", { href: m.url, text: "Załączniki w PDF uchwały" }));
  const list = $("#inv-list");
  clear(list);
  const byMaj = doc().wydatki_dzialy.filter((row) => row.majatkowe).sort((a, b) => b.majatkowe - a.majatkowe);
  list.append(el("h2", { class: "h", text: "Działy z wydatkami majątkowymi" }));
  if (!byMaj.length) {
    list.append(el("p", { text: "W tym roku rozdziały nie dały wiarygodnego podziału. Zostaje podział miasta z paragrafu 1." }));
  } else {
    const mount = el("div");
    list.append(mount);
    bars(mount, byMaj.slice(0, 8).map((row) => ({ name: row.name, plan: row.majatkowe })));
    const covered = byMaj.reduce((s, row) => s + row.majatkowe, 0);
    if (covered !== m.wydatki_majatkowe) {
      list.append(el("p", { class: "caption", text: `Z działów, które udało się rozbić, schodzi ${full(covered)}. Paragraf 1 mówi o ${full(m.wydatki_majatkowe)}.` }));
    }
  }
}

function paintTrends(trends) {
  const lata = trends.lata;
  const names = new Map();
  for (const y of lata) for (const d of y.dzialy) names.set(d.code, d.name);
  const top = [...names.keys()]
    .map((code) => ({ code, plan: lata.reduce((s, y) => s + (y.dzialy.find((d) => d.code === code)?.plan || 0), 0) }))
    .sort((a, b) => b.plan - a.plan)
    .slice(0, 5);
  if (!state.trendSeeded) {
    state.dzialTrend.add(top[0].code);
    state.trendSeeded = true;
  }
  const checks = $("#trend-checks");
  clear(checks);
  const series = [];
  const add = (id, label, on, color, rows) => {
    const input = el("input", { type: "checkbox" });
    input.checked = on;
    input.addEventListener("change", () => {
      if (id in state.series) state.series[id] = input.checked;
      else input.checked ? state.dzialTrend.add(id) : state.dzialTrend.delete(id);
      paintTrends(trends);
    });
    checks.append(el("label", {}, [input, el("i", { class: "swatch", style: `background:${color}` }), document.createTextNode(label)]));
    if (on) series.push({ color, rows, label });
  };
  add("wydatki", "Wydatki", state.series.wydatki, "#8d2f1b", lata.map((r) => r.wydatki));
  add("dochody", "Dochody", state.series.dochody, "#1d5c40", lata.map((r) => r.dochody));
  add("deficyt", "Deficyt", state.series.deficyt, "#a32020", lata.map((r) => r.deficyt));
  top.forEach((d, i) => add(d.code, names.get(d.code), state.dzialTrend.has(d.code), PALETTE[(i + 3) % PALETTE.length],
    lata.map((r) => r.dzialy.find((x) => x.code === d.code)?.plan || 0)));

  const svgEl = $("#trend-svg");
  const w = 760, h = 320, padL = 52, padR = 12, padT = 16, padB = 28;
  svgEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
  clear(svgEl);
  if (!series.length) return;
  const max = Math.max(1, ...series.flatMap((s) => s.rows));
  const x = (i) => padL + (i * (w - padL - padR)) / (lata.length - 1);
  const y = (v) => h - padB - (v / max) * (h - padT - padB);
  for (let g = 0; g <= 4; g++) {
    const val = (max * g) / 4;
    const yy = y(val);
    svgEl.append(svg("line", { x1: padL, x2: w - padR, y1: yy, y2: yy, stroke: "var(--line)" }));
    const t = svg("text", { x: 0, y: yy + 4, fill: "var(--ink-2)", "font-size": 11 });
    t.textContent = mln(val).replace(" zł", "");
    svgEl.append(t);
  }
  for (const s of series) {
    svgEl.append(svg("path", {
      d: s.rows.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" "),
      fill: "none", stroke: s.color, "stroke-width": 2.4,
    }));
  }
  lata.forEach((r, i) => {
    const t = svg("text", { x: x(i), y: h - 8, "text-anchor": "middle", fill: r.rok === state.year ? "var(--ink)" : "var(--ink-2)", "font-size": 11 });
    t.textContent = r.rok;
    svgEl.append(t);
  });
  const detail = $("#trend-detail");
  const showTrend = (index) => {
    clear(detail);
    const row = lata[index];
    detail.append(el("div", { class: "yd-h" }, [el("strong", { text: String(row.rok) })]));
    for (const s of series) {
      detail.append(el("div", { class: "line" }, [
        el("span", { text: s.label }),
        el("span", { class: "amt", text: mln(s.rows[index]), "data-full": `${row.rok}, ${s.label}: ${full(s.rows[index])}` }),
      ]));
    }
  };
  const indexAt = (event) => {
    const rect = svgEl.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * w;
    const slot = (w - padL - padR) / (lata.length - 1);
    return Math.max(0, Math.min(lata.length - 1, Math.round((px - padL) / slot)));
  };
  svgEl.onpointermove = (event) => showTrend(indexAt(event));
  svgEl.onpointerdown = (event) => showTrend(indexAt(event));
  showTrend(Math.max(0, lata.findIndex((r) => r.rok === state.year)));
}

function shares(rows, base) {
  const parts = rows.map((r) => {
    const raw = (100 * r.plan) / base;
    return { ...r, raw, cells: Math.floor(raw), frac: raw - Math.floor(raw) };
  });
  let left = 100 - parts.reduce((s, r) => s + r.cells, 0);
  for (const r of [...parts].sort((a, b) => b.frac - a.frac)) {
    if (left <= 0) break;
    if (r.raw <= 0) continue;
    r.cells += 1;
    left -= 1;
  }
  return parts.filter((r) => r.cells > 0).sort((a, b) => b.cells - a.cells);
}

function paintThousand() {
  const m = doc().meta;
  const base = state.side === "wydatki" ? m.wydatki : m.dochody;
  const rows = state.side === "wydatki"
    ? [...doc().wydatki_dzialy].sort((a, b) => b.plan - a.plan)
    : doc().dochody_grupy;
  for (const b of $("#thou-seg").querySelectorAll("button")) {
    const on = b.dataset.side === state.side;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  }
  const parts = shares(rows, base);
  const waffle = $("#waffle");
  clear(waffle);
  let delay = 0;
  for (const part of parts) {
    for (let i = 0; i < part.cells; i += 1) {
      const cell = el("i", { "data-full": `${part.name}: ${part.cells * 10} zł z 1000` });
      cell.style.background = colorOf(part.code || part.name);
      cell.style.animationDelay = `${Math.min(delay, 40) * 12}ms`;
      waffle.append(cell);
      delay += 1;
    }
  }
  const list = $("#thou-list");
  clear(list);
  for (const part of parts) {
    list.append(el("div", { class: "src-row" }, [
      el("span", { text: part.name }),
      el("span", { class: "amt", text: `${part.cells * 10} zł` }),
    ]));
  }
  $("#thou-note").textContent = `100 kwadratów, ${full(base)} w uchwale.`;
}

function ring(partLabel, stated, caption) {
  const ratio = stated ? Math.max(0, Math.min(Number(String(stated).replace(",", ".")) / 100, 1)) : 0;
  const c = 2 * Math.PI * 46;
  const fg = svg("circle", {
    cx: 60, cy: 60, r: 46, fill: "none", stroke: "var(--accent)", "stroke-width": 10,
    "stroke-dasharray": `${c * ratio} ${c}`, transform: "rotate(-90 60 60)",
  });
  const bg = svg("circle", { cx: 60, cy: 60, r: 46, fill: "none", stroke: "var(--line)", "stroke-width": 10 });
  const t = svg("text", { x: 60, y: 64, "text-anchor": "middle" });
  t.textContent = stated ? `${stated}%` : "—";
  const picture = svg("svg", { viewBox: "0 0 120 120" });
  picture.append(bg, fg);
  picture.append(t);
  return el("div", { class: "ring" }, [picture, el("div", { text: partLabel }), el("div", { class: "caption", text: caption })]);
}

function paintExec(exe) {
  const m = doc().meta;
  const mount = $("#exec-mount");
  clear(mount);
  if (!exe) {
    mount.append(el("div", { class: "card" }, [
      el("p", { class: "abs-wait", text: "Rok w toku" }),
      el("p", { text: `Budżet ${m.rok} ma uchwałę ${m.uchwala}. Sprawozdanie składa prezydent do 31 marca ${m.rok + 1}, a Rada zatwierdza je i głosuje absolutorium do 30 czerwca ${m.rok + 1}. Nie ma tu procentu wykonania ani karty absolutorium.` }),
    ]));
    return;
  }
  const w = exe.wykonanie;
  const plan = exe.plan_po_zmianach || {};
  const rings = el("div", { class: "ring-row" });
  if (w.dochody_stopien) rings.append(ring("Dochody wobec planu po zmianach", w.dochody_stopien, full(w.dochody)));
  if (w.wydatki_stopien) rings.append(ring("Wydatki wobec planu po zmianach", w.wydatki_stopien, full(w.wydatki)));
  const table = el("table");
  const head = el("tr");
  ["", "Plan z pierwotnej uchwały", "Plan po zmianach", "Wykonanie"].forEach((name, i) => head.append(el("th", { class: i ? "num" : "", text: name })));
  table.append(head);
  const row = (name, a, b, c) => el("tr", {}, [
    el("td", { text: name }),
    el("td", { class: "num", text: full(a) }),
    el("td", { class: "num", text: b == null ? "—" : full(b) }),
    el("td", { class: "num", text: full(c) }),
  ]);
  table.append(row("Dochody", m.dochody, plan.dochody, w.dochody), row("Wydatki", m.wydatki, plan.wydatki, w.wydatki), row("Deficyt", m.deficyt, null, w.deficyt));
  const note = w.deficyt_z_tekstu
    ? "Deficyt wykonania jest kwotą z opinii."
    : "Deficyt w tabeli to różnica dochodów i wydatków z opinii, bo ten rocznik nie zapisuje osobnej kwoty wyniku.";
  const maxBar = Math.max(m.wydatki, plan.wydatki || 0, w.wydatki, m.dochody, plan.dochody || 0, w.dochody);
  const trio = (title, values) => {
    const box = el("div", {}, [el("div", { class: "name", text: title })]);
    const lines = el("div", { class: "trio" });
    for (const [label, value, color] of values) {
      if (value == null) continue;
      const i = el("i");
      i.style.width = `${(100 * value) / maxBar}%`;
      i.style.background = color;
      i.style.setProperty("--w", i.style.width);
      lines.append(el("div", {}, [el("b", { text: `${label} ${mln(value)}` }), el("div", { class: "track" }, [i])]));
    }
    box.append(lines);
    return box;
  };
  mount.append(el("div", { class: "card" }, [
    rings,
    el("div", { class: "planbars" }, [
      trio("Dochody", [["Uchwała", m.dochody, "var(--good)"], ["Po zmianach", plan.dochody, "#8a5a12"], ["Wykonanie", w.dochody, "var(--accent)"]]),
      trio("Wydatki", [["Uchwała", m.wydatki, "var(--good)"], ["Po zmianach", plan.wydatki, "#8a5a12"], ["Wykonanie", w.wydatki, "var(--accent)"]]),
    ]),
    el("div", { class: "table-scroll" }, [table]),
    el("p", { class: "caption", text: note }),
  ]));
  const abs = exe.absolutorium;
  const z = exe.zatwierdzenie;
  mount.append(el("div", { class: "card" }, [
    el("p", { class: abs.udziela ? "abs-yes" : "abs-wait", text: abs.udziela ? "Rada udzieliła absolutorium" : "Rada nie udzieliła absolutorium" }),
    el("p", { text: `Uchwała ${abs.nr} z ${abs.data}. To osobne głosowanie od zatwierdzenia sprawozdania i od wotum zaufania.` }),
    el("p", {}, [el("a", { href: abs.karta, text: "Karta absolutorium" }), document.createTextNode(" · "), el("a", { href: abs.pdf, text: "PDF" })]),
    el("p", { class: "caption", text: "Liczby głosów nie ma w tekście uchwały. Są w protokole sesji na BIP." }),
    el("h3", { text: "Zatwierdzenie sprawozdania" }),
    el("p", { text: `${z.nr} z ${z.data}` }),
    el("p", {}, [el("a", { href: z.karta, text: "Karta zatwierdzenia" }), document.createTextNode(" · "), el("a", { href: z.pdf, text: "PDF" })]),
  ]));
}

function paintActive() {
  const trends = cache.trends;
  const exe = cache.wykonanie[state.year] ?? null;
  if (state.view === "przeglad") { paintOverview(trends, exe); paintYearChart(trends); }
  if (state.view === "mapa") paintMap();
  if (state.view === "przeplyw") paintFlow();
  if (state.view === "inwestycje") paintInvest();
  if (state.view === "trendy") paintTrends(trends);
  if (state.view === "tysiac") paintThousand();
  if (state.view === "wykonanie") paintExec(exe);
  const problems = assertYear(doc());
  const status = $("#status");
  status.textContent = problems.length ? problems.join(" · ") : `Uchwała ${doc().meta.uchwala}, kwoty zgodne z paragrafem 1.`;
  status.classList.toggle("error", problems.length > 0);
}

function show(view) {
  state.view = view;
  for (const button of document.querySelectorAll(".nav-i")) {
    const on = button.dataset.view === view;
    button.classList.toggle("on", on);
    button.setAttribute("aria-selected", String(on));
  }
  for (const panel of document.querySelectorAll(".view")) {
    const on = panel.id === `panel-${view}`;
    panel.classList.toggle("is-active", on);
    panel.hidden = !on;
  }
  history.replaceState(null, "", `#${view}`);
  paintActive();
}

function setYear(year) {
  const next = Math.max(2016, Math.min(2026, year));
  if (next === state.year && doc()) return;
  state.year = next;
  $("#year").value = String(next);
  closeSheet();
  paintActive();
}

function bindTooltip() {
  const tip = $("#tooltip");
  const place = (event) => {
    tip.style.left = `${Math.min(event.clientX + 12, innerWidth - 220)}px`;
    tip.style.top = `${event.clientY + 16}px`;
  };
  document.addEventListener("pointerover", (event) => {
    const host = event.target.closest("[data-full]");
    if (!host) { tip.classList.remove("on"); return; }
    tip.textContent = host.dataset.full;
    tip.classList.add("on");
    place(event);
  });
  document.addEventListener("pointermove", (event) => { if (tip.classList.contains("on")) place(event); });
  document.addEventListener("pointerout", (event) => {
    if (!event.target.closest("[data-full]")) tip.classList.remove("on");
  });
}

async function boot() {
  const select = $("#year");
  for (const year of YEARS) select.append(el("option", { value: year, text: String(year) }));
  const saved = localStorage.getItem("krakow-theme");
  const dark = saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $("#theme").setAttribute("aria-pressed", String(dark));
  $("#theme").textContent = dark ? "Jasny" : "Ciemny";
  const hash = location.hash.replace("#", "");
  if (document.querySelector(`.nav-i[data-view="${hash}"]`)) state.view = hash;
  select.value = String(state.year);
  try {
    await Promise.all([...YEARS.map(loadBudget), ...YEARS.filter((y) => y <= 2025).map(loadWykonanie), loadTrends()]);
  } catch (error) {
    $("#status").textContent = error.message || String(error);
    $("#status").classList.add("error");
    return;
  }
  for (const button of document.querySelectorAll(".nav-i")) button.addEventListener("click", () => show(button.dataset.view));
  document.addEventListener("click", (event) => {
    const go = event.target.closest("[data-go]");
    if (go) show(go.dataset.go);
  });
  select.addEventListener("change", () => setYear(Number(select.value)));
  $("#prev-year").addEventListener("click", () => setYear(state.year - 1));
  $("#next-year").addEventListener("click", () => setYear(state.year + 1));
  $("#year-chart").addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") setYear(state.year + 1);
    if (event.key === "ArrowLeft") setYear(state.year - 1);
  });
  $("#map-seg").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    state.mapMode = button.dataset.mode;
    paintMap();
  });
  $("#thou-seg").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    state.side = button.dataset.side;
    paintThousand();
  });
  $("#theme").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("krakow-theme", next);
    $("#theme").setAttribute("aria-pressed", String(next === "dark"));
    $("#theme").textContent = next === "dark" ? "Jasny" : "Ciemny";
  });
  $("#sheet-close").addEventListener("click", closeSheet);
  $("#sheet-backdrop").addEventListener("click", closeSheet);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeSheet(); });
  addEventListener("scroll", () => $("#hdr").classList.toggle("is-compact", scrollY > 28), { passive: true });
  let resizeTick = 0;
  addEventListener("resize", () => {
    cancelAnimationFrame(resizeTick);
    resizeTick = requestAnimationFrame(() => { if (state.view === "mapa" || state.view === "przeglad" || state.view === "przeplyw") paintActive(); });
  });
  bindTooltip();
  document.body.classList.add("is-loaded");
  show(state.view);
}

boot();
