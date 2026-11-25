# PS4 Flip Calculator

A phone-friendly page for working out whether a faulty PS4 is worth buying, repairing and reselling.
Prices refresh daily from eBay UK (median **asking** prices, not sold prices).

## Files

| File | What it is |
|---|---|
| `index.html`, `style.css`, `app.js` | The page itself |
| `prices.json` | All prices + the "last updated" date. The daily job rewrites this. |
| `scripts/update_prices.py` | The daily eBay price fetcher |
| `.github/workflows/update-prices.yml` | Tells GitHub to run the fetcher every day at 05:17 UTC |

## Change a default price

Edit `prices.json` on GitHub (open the file → pencil icon → change the number → **Commit changes**).
Note: the daily job will overwrite any price it can find on eBay. To permanently fix a price, either:
- just edit it on the page (your edit is saved on that device and beats the live price), or
- remove that item from the `ITEMS` list in `scripts/update_prices.py` so the job stops updating it.

eBay postage (`ebay_postage`) and the CeX percentage (`cex_rate_percent`) are under `settings` in `prices.json` and are never touched by the daily job.

## Add a new fault type

1. In `prices.json`, add a part under `"parts"`, e.g.
   `"usb_board": { "label": "USB board", "price": 8, "listings": null, "updated": null },`
2. In `app.js`, add a line to the `FAULTS` list at the top, e.g.
   `{ id: 'usb', label: 'USB ports dead', part: () => 'usb_board' },`
   - For a part that differs by model, name the parts `xxx_orig`, `xxx_slim`, `xxx_pro` and use `part: m => 'xxx_' + m.family`.
   - For a fault you can't fix without soldering, use `{ id: 'xyz', label: '...', solder: true }` (no part).
3. Optional: to have the daily job price it, add a matching entry to `ITEMS` in `scripts/update_prices.py` (copy a similar one).

## If the daily update stops working

The page keeps showing the last good prices, so nothing breaks — they just go stale. Check the "last updated" date at the top of the page.

1. Open `update_log.txt` in the repo: it holds the full output of the last run, including example listings behind each price (handy for spotting junk that got through the filters). Or go to the **Actions** tab → **Update prices**: a red ✗ means a failed run; click it to read the error.
2. Common causes:
   - **"401" / "invalid_client"**: eBay keys are wrong or expired. Get them again from developer.ebay.com → *Application Keys* (Production), then update them in repo **Settings → Secrets and variables → Actions**.
   - **"KEEP xxx: only 3 usable listings"**: not an error — too few clean listings that day, so that one price stayed put.
   - **Workflow disabled**: GitHub pauses scheduled jobs in repos with no activity for 60 days. On the Actions tab, click **Enable workflow**.
3. To re-run by hand: Actions → **Update prices** → **Run workflow**.

## Your data

Edited prices and the deal log are stored only in the browser you used (localStorage). Clearing browser data deletes them, so use **Export CSV** now and then as a backup.
