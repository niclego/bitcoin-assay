// Weekly data job for The Assay (run by .github/workflows/data.yml).
// Fetches long-term-holder supply server-side — no CORS constraints here —
// normalizes it to a percent series, and writes data/lth.json for the page
// to read same-origin. Also probes every browser-side source and logs its
// HTTP status and Access-Control-Allow-Origin header, so the workflow log
// doubles as a liveness/CORS report for the fallback chains in index.html.

import { writeFile, mkdir } from "node:fs/promises";

const DAY = 86400000;
const KEEP_DAYS = 150;

function num(v) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return typeof n === "number" && isFinite(n) ? n : null;
}
const sanePct = (p) => p != null && p >= 40 && p <= 90;

async function probe(name, url) {
  try {
    const r = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "the-assay-data-job" },
    });
    const acao = r.headers.get("access-control-allow-origin");
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch {}
    console.log(`[probe] ${name}: HTTP ${r.status}, ACAO=${acao ?? "NONE"}, bytes=${text.length}`);
    if (!r.ok || body == null) console.log(`        body: ${text.slice(0, 300)}`);
    return { ok: r.ok && body != null, status: r.status, acao, body };
  } catch (e) {
    console.log(`[probe] ${name}: FETCH FAIL ${e.message}`);
    return { ok: false };
  }
}

// --- circulating supply (to convert BTC-denominated LTH supply to %) ---
async function circulating() {
  const r = await probe(
    "coingecko markets (also the page's BTC leg)",
    "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin"
  );
  const c = num(r.body?.[0]?.circulating_supply);
  return c != null && c > 18e6 && c < 21e6 ? c : 19.9e6;
}

// --- source 1: BGeometrics (bitcoin-data.com), 155-day LTH definition ---
function bgeoSeries(body, circ) {
  const arr = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : null;
  if (!arr || arr.length < 2) return null;
  const out = [];
  for (const o of arr) {
    const v = num(o.lthSupply ?? o.lth_supply ?? o.value ?? o.supply);
    if (v == null) continue;
    const pct = v > 100 ? (v / circ) * 100 : v;
    let t = null;
    const d = o.d ?? o.date ?? o.day ?? o.theDay;
    if (d) { const p = Date.parse(d); if (isFinite(p)) t = p; }
    if (t == null) { const u = num(o.unixTs ?? o.timestamp); if (u != null) t = u > 1e12 ? u : u * 1000; }
    if (sanePct(pct) && t != null) out.push({ t, pct: +pct.toFixed(2) });
  }
  return out.length > 2 ? out : null;
}

// --- source 2: CoinMetrics community, 180-day active-supply complement ---
function cmSeries(body) {
  const rows = body?.data;
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const out = [];
  for (const o of rows) {
    const act = num(o.SplyAct180d), cur = num(o.SplyCur);
    if (act == null || cur == null || cur <= 0) continue;
    const pct = (1 - act / cur) * 100;
    const t = Date.parse(o.time);
    if (sanePct(pct) && isFinite(t)) out.push({ t, pct: +pct.toFixed(2) });
  }
  return out.length > 2 ? out : null;
}

async function main() {
  const circ = await circulating();
  console.log(`[info] circulating supply used for conversion: ${circ}`);

  // Diagnostic-only probes: the page's metals chain. Logged so the workflow
  // log reports real liveness + CORS for every browser-side source.
  await probe("gold-api.com XAU", "https://api.gold-api.com/price/XAU");
  await probe("gold-api.com XAG", "https://api.gold-api.com/price/XAG");
  await probe("goldprice.org dbXRates", "https://data-asg.goldprice.org/dbXRates/USD");
  await probe("coingecko PAXG/KAG proxy", "https://api.coingecko.com/api/v3/simple/price?ids=pax-gold,kinesis-silver&vs_currencies=usd");

  // LTH candidates, in the page's order of preference.
  const cmStart = new Date(Date.now() - (KEEP_DAYS + 10) * DAY).toISOString().slice(0, 10);
  const candidates = [
    { name: "bitcoin-data.com series", url: "https://bitcoin-data.com/v1/lth-supply",
      parse: (b) => bgeoSeries(b, circ),
      source: "bitcoin-data.com", definition: "155-day LTH definition (BGeometrics)." },
    { name: "api.bitcoin-data.com series", url: "https://api.bitcoin-data.com/v1/lth-supply",
      parse: (b) => bgeoSeries(b, circ),
      source: "bitcoin-data.com", definition: "155-day LTH definition (BGeometrics)." },
    { name: "coinmetrics SplyAct180d", url: `https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=SplyAct180d,SplyCur&frequency=1d&page_size=400&start_time=${cmStart}`,
      parse: cmSeries,
      source: "CoinMetrics community", definition: "180-day active-supply complement — a close cousin of the 155-day LTH; read the trend, not the exact level." },
  ];

  for (const c of candidates) {
    const r = await probe(c.name, c.url);
    if (!r.ok) continue;
    const series = c.parse(r.body);
    if (!series) { console.log(`        parsed but no usable series — shape changed?`); continue; }
    const cutoff = Date.now() - KEEP_DAYS * DAY;
    const trimmed = series.filter((e) => e.t >= cutoff);
    const out = {
      updatedAt: new Date().toISOString(),
      source: c.source,
      definition: c.definition,
      series: trimmed.length > 2 ? trimmed : series.slice(-KEEP_DAYS),
    };
    await mkdir("data", { recursive: true });
    await writeFile("data/lth.json", JSON.stringify(out) + "\n");
    const last = out.series[out.series.length - 1];
    console.log(`[ok] wrote data/lth.json from ${c.name}: ${out.series.length} points, latest ${last.pct}% @ ${new Date(last.t).toISOString().slice(0, 10)}`);
    return;
  }
  console.error("[fail] every LTH candidate failed — data/lth.json NOT updated");
  process.exit(1);
}

main();
