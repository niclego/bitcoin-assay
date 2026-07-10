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

// --- BGeometrics (bitcoin-data.com), 155-day LTH definition ---
// Endpoint confirmed by the discovery run: /v1/long-term-hodler-supply-btc.
// The value field's exact name is unknown, so take the first numeric field
// that isn't a date/timestamp; the 40–90% sanity gate rejects wrong picks.
const TIME_KEYS = /^(d|date|day|theDay|unixTs|unix_ts|timestamp|time)$/;
function rowValue(o) {
  for (const k of Object.keys(o)) {
    if (TIME_KEYS.test(k)) continue;
    const n = num(o[k]);
    if (n != null) return n;
  }
  return null;
}
function bgeoSeries(body, circ) {
  const arr = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : null;
  if (!arr || arr.length < 2) return null;
  const out = [];
  for (const o of arr) {
    if (!o || typeof o !== "object") continue;
    const v = rowValue(o);
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

async function main() {
  const circ = await circulating();
  console.log(`[info] circulating supply used for conversion: ${circ}`);

  // Diagnostic-only probes: the page's metals chain. Logged so the workflow
  // log reports real liveness + CORS for every browser-side source.
  await probe("gold-api.com XAU", "https://api.gold-api.com/price/XAU");
  await probe("gold-api.com XAG", "https://api.gold-api.com/price/XAG");
  await probe("goldprice.org dbXRates", "https://data-asg.goldprice.org/dbXRates/USD");
  await probe("coingecko PAXG/KAG proxy", "https://api.coingecko.com/api/v3/simple/price?ids=pax-gold,kinesis-silver&vs_currencies=usd");

  // LTH candidates. api. host first — the discovery run showed it answers
  // with Access-Control-Allow-Origin: * while the bare host sends none.
  // (CoinMetrics was dropped: its community tier has no active-supply metrics.)
  const candidates = [
    { name: "api.bitcoin-data.com long-term-hodler-supply", url: "https://api.bitcoin-data.com/v1/long-term-hodler-supply-btc",
      parse: (b) => bgeoSeries(b, circ),
      source: "bitcoin-data.com", definition: "155-day LTH definition (BGeometrics)." },
    { name: "bitcoin-data.com long-term-hodler-supply", url: "https://bitcoin-data.com/v1/long-term-hodler-supply-btc",
      parse: (b) => bgeoSeries(b, circ),
      source: "bitcoin-data.com", definition: "155-day LTH definition (BGeometrics)." },
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
  await discover();
  process.exit(1);
}

// When every candidate fails, hunt for the correct endpoints and print them
// in the log so the next iteration can be wired against reality.
async function discover() {
  console.log("[discover] looking for the real bitcoin-data.com path…");
  for (const u of [
    "https://bitcoin-data.com/v3/api-docs",
    "https://api.bitcoin-data.com/v3/api-docs",
    "https://bitcoin-data.com/openapi.json",
    "https://bitcoin-data.com/api-docs",
    "https://bitcoin-data.com/v2/api-docs",
  ]) {
    const r = await probe("openapi " + u, u);
    if (r.ok && r.body?.paths) {
      const all = Object.keys(r.body.paths);
      const hits = all.filter((p) => /lth|supply|hodl|sth/i.test(p));
      console.log(`[discover] ${all.length} paths total; lth/supply/hodl matches:`);
      for (const h of hits) console.log(`           ${h}`);
      break;
    }
  }
  console.log("[discover] CoinMetrics community supply metrics with 1d frequency…");
  const cat = await probe(
    "coinmetrics catalog",
    "https://community-api.coinmetrics.io/v4/catalog-v2/asset-metrics?assets=btc&page_size=10000"
  );
  const metrics = cat.body?.data?.[0]?.metrics;
  if (Array.isArray(metrics)) {
    const hits = metrics
      .filter((m) => /sply/i.test(m.metric))
      .map((m) => `${m.metric}[${(m.frequencies || []).map((f) => f.frequency).join(",")}]`);
    console.log(`[discover] ${hits.join(" ")}`);
  }
}

main();
