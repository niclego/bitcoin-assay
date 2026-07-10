# The Assay

**Live: [niclego.github.io/bitcoin-assay](https://niclego.github.io/bitcoin-assay/)**

A single-file, mobile-first instrument tracking one long-horizon thesis: **is Bitcoin
gradually maturing into "digital gold"?** Open it weekly or monthly; it pulls fresh
numbers on load and tells you plainly when it couldn't.

## Running / hosting

It's one static file — no build step, no framework, no keys, no backend.

- **GitHub Pages:** enable Pages on this repo (Settings → Pages → deploy from `main`,
  root). `index.html` is served as-is.
- **Locally:** just open `index.html` in a browser. Everything works from `file://`
  too, including the localStorage cache.

There are **no API keys anywhere** — every source in the chain is keyless, so there is
nothing to configure and nothing to leak.

## Architecture

Static single file **plus one scheduled GitHub Action** (brief §4, option 2 — for the
LTH leg only). Price legs fetch keyless sources on load; the slow-moving LTH leg is
snapshotted weekly by `.github/workflows/data.yml` (Monday 06:17 UTC, also runs on
pushes touching the job) into `data/lth.json`, which the page reads **same-origin** —
CORS can't break it. Live fetches of the same upstream remain as backup. No proxy, no
keys, no secrets anywhere. Refresh cadence matches the weekly/monthly thesis cadence.

## Data sources and fallbacks

| Leg | Chain (first sane result wins) | Last resorts |
|---|---|---|
| BTC price + market cap | [CoinGecko](https://www.coingecko.com/api) `/coins/markets` (keyless) | localStorage last-good → seed → manual |
| Gold spot (USD/oz) | [gold-api.com](https://gold-api.com) `XAU` → [goldprice.org](https://goldprice.org) `dbXRates/USD` → CoinGecko **PAXG** tokenized-gold proxy | localStorage last-good → seed → manual |
| Silver spot (USD/oz) | gold-api.com `XAG` → goldprice.org → CoinGecko **KAG** (Kinesis Silver) proxy | localStorage last-good → seed → manual |
| Long-term-holder supply % (155-day) | `data/lth.json` — weekly same-origin snapshot written by the GitHub Action from [bitcoin-data.com](https://bitcoin-data.com) (BGeometrics) `/v1/long-term-hodler-supply-btc` → live fetch of the same endpoint (`api.` host first: it sends CORS headers, the bare host doesn't) → `/last` variants | localStorage last-good → manual entry |
| History sparkline | True ratio: BTC market-cap history ÷ (PAXG price history × fixed stock), both from CoinGecko (≤365 days keyless) | current-cap approximation, with its disclaimer restored |

Gold/silver market caps = spot × fixed above-ground stock (6.952 B oz gold,
56.29 B oz silver). LTH% converts bitcoin-data.com's BTC-denominated supply using
CoinGecko's live circulating supply (fallback 19.9 M if that leg is down).

### Robustness behavior

- **Retry with backoff** on HTTP 429 and network/timeout errors (2 retries: 1.5 s, 4 s).
  Every fetch carries an AbortController timeout.
- **Last-good cache:** each leg's most recent good value is saved in `localStorage`
  and used — clearly labelled "Cached — last good at …" in Source health — when the
  live chain fails, instead of dropping to seed.
- **Staleness:** LTH data older than 30 days trips an amber "Stale data" warning even
  when the fetch itself succeeds.
- **Self-diagnosis:** every degraded leg renders a Source-health card explaining what
  failed and a "Copy fix message" button with a paste-ready repair instruction.
- Seeds paint immediately on load; the page is never blank, even fully offline.

## What was actually verified (honesty note)

The data job doubles as a **liveness/CORS probe**: every run logs each source's HTTP
status and `Access-Control-Allow-Origin` header. Verified by real runs on GitHub's
runners (see the Actions log for "Update LTH data"):

- **Alive and CORS-open (`ACAO: *`):** CoinGecko (markets + PAXG/KAG proxy),
  `gold-api.com` (XAU and XAG), and `api.bitcoin-data.com` — note the bare
  `bitcoin-data.com` host serves data but sends **no** CORS header, which is why the
  `api.` host goes first in the browser chain.
- **Dead ends found and removed:** `/v1/lth-supply` doesn't exist (the real path is
  `/v1/long-term-hodler-supply-btc`, found via BGeometrics' OpenAPI spec);
  CoinMetrics' community tier exposes no active-supply metrics, so it was dropped.
- **Unreliable:** `data-asg.goldprice.org` returns 403 to non-browser clients; it's
  kept as a middle chain link only (it may still work from a real browser).
- **Tested end-to-end in headless Chromium (mocked network):** happy path, full
  offline (all legs degrade to visible "Source down" cards, manual entry recovers),
  metals chain walking, LTH snapshot reading, stale-data warning. Zero JS errors.
- **Load-bearing by design:** CoinGecko (BTC leg, metals tail via PAXG/KAG tokenized
  proxies tracking spot within ~1%, history) and the weekly Action snapshot for LTH.

If a leg shows red on a real load, the page itself tells you exactly what to ask
for — that's the point of it. If the LTH feed dies upstream, the Action run goes red
and the page's snapshot trips the amber stale warning after 30 days.

## Caveats encoded in the page

- LTH% reproduces the UTXO-age **trend**, not Glassnode's proprietary entity-adjusted
  level — read its direction, not its exact value (noted in the footer).
- Keyless CoinGecko history is limited to the past 365 days, so the sparkline shows
  ~1 year (previously ~2 years, which the keyless API no longer serves).
- Not investment advice — an instrument for one thesis its owner already holds.
