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

Pure static single file, fetch-on-load (brief §4, option 1). Chosen because every leg
now has a keyless browser source with a fallback chain whose tail is CoinGecko — the
same origin that already serves the BTC leg — so no proxy, no scheduled Action, and no
secrets are needed. Refresh cadence is "whenever you open it," which matches the
weekly/monthly thesis cadence.

## Data sources and fallbacks

| Leg | Chain (first sane result wins) | Last resorts |
|---|---|---|
| BTC price + market cap | [CoinGecko](https://www.coingecko.com/api) `/coins/markets` (keyless) | localStorage last-good → seed → manual |
| Gold spot (USD/oz) | [gold-api.com](https://gold-api.com) `XAU` → [goldprice.org](https://goldprice.org) `dbXRates/USD` → CoinGecko **PAXG** tokenized-gold proxy | localStorage last-good → seed → manual |
| Silver spot (USD/oz) | gold-api.com `XAG` → goldprice.org → CoinGecko **KAG** (Kinesis Silver) proxy | localStorage last-good → seed → manual |
| Long-term-holder supply % (155-day) | [bitcoin-data.com](https://bitcoin-data.com) (BGeometrics) full series (level + ~90-day direction), tried on both `bitcoin-data.com` and `api.bitcoin-data.com` hosts → `/lth-supply/last` (level only) → [CoinMetrics community](https://docs.coinmetrics.io/api/v4/) `SplyAct180d`/`SplyCur` (180-day active-supply complement — close cousin of 155-day LTH, labelled in the health card when in use) | localStorage last-good → manual entry |
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

This build was developed in a sandbox whose network policy **blocked all external data
APIs**, so the CORS/liveness of the sources could **not** be probed directly. What was
verified, with a real headless Chromium against the real file:

- **Tested end-to-end (mocked network):** happy path (all legs fresh, LTH auto-level
  and auto-direction, true-ratio sparkline, cache written), full-offline path (all
  four legs degrade to visible "Source down" cards, manual entry recovers), metals
  chain walking (primary down + secondary shape-broken → token proxy wins), and the
  stale-LTH warning. Zero JS errors in all runs.
- **Not tested live (assumed, self-reporting if wrong):** real CORS headers of
  `gold-api.com`, `data-asg.goldprice.org`, `bitcoin-data.com` /
  `api.bitcoin-data.com`, and `community-api.coinmetrics.io`, and
  bitcoin-data.com's exact field names (the parser accepts `lthSupply` /
  `lth_supply` / `value` / `supply`, string or number, BTC or percent, and
  tries both hosts because BGeometrics' docs reference `api.bitcoin-data.com`).
- **Load-bearing by design:** CoinGecko. It anchors the BTC leg, the metals-chain
  tail (PAXG/KAG proxies, which track spot within ~1%), and history. If a first-choice
  source turns out to be CORS-blocked in your browser, the chain falls through to the
  CoinGecko proxy silently and the health card names which source actually won.

If a leg shows red on your first real load, the page itself tells you exactly what to
ask for — that's the point of it.

## Caveats encoded in the page

- LTH% reproduces the UTXO-age **trend**, not Glassnode's proprietary entity-adjusted
  level — read its direction, not its exact value (noted in the footer).
- Keyless CoinGecko history is limited to the past 365 days, so the sparkline shows
  ~1 year (previously ~2 years, which the keyless API no longer serves).
- Not investment advice — an instrument for one thesis its owner already holds.
