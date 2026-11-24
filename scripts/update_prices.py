"""Refresh prices.json from the eBay Browse API (UK marketplace).

Runs daily from GitHub Actions. Needs two environment variables, which come
from GitHub Secrets:  EBAY_CLIENT_ID  and  EBAY_CLIENT_SECRET.

Rules:
- Each item is searched separately. If a search fails or finds too few good
  listings, that item keeps its previous price.
- If nothing at all could be updated, the script exits with an error so the
  GitHub Actions run shows red, and prices.json is left untouched.
- Uses only Python's standard library, so there's nothing to install.
"""

import base64
import json
import os
import re
import statistics
import sys
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

PRICES_FILE = Path(__file__).resolve().parent.parent / "prices.json"
TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"
SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search"
MIN_LISTINGS = 5

# Words that mean a listing is broken, not the real thing, or not comparable.
JUNK = r"faulty|spares|repair|broken|not working|for parts|untested|read desc|no power|" \
       r"box only|empty box|job lot|joblot|wholesale|\bbundle\b|\bgames?\b|\bvr\b|cracked|damaged"

# Words that mean a "console" listing is actually just a part or accessory.
NOT_A_CONSOLE = r"shell|housing|case only|motherboard|\bfan\b|power supply|\bpsu\b|skin|sticker|" \
                r"stand|charger|controller only|pad only|hdmi port|disc drive|blu.?ray drive|\bdrive only|" \
                r"cooling|replacement|\bparts?\b"

USED_CONDITIONS = "conditionIds:{1500|2000|2010|2020|2030|2500|2750|3000|4000|5000|6000}"
ANY_WORKING = "conditionIds:{1000|1500|2000|2010|2020|2030|2500|2750|3000|4000|5000|6000}"

# family words
ORIG_ONLY = {"exclude": r"\bslim\b|\bpro\b"}
SLIM = {"require": r"\bslim\b", "exclude": r"\bpro\b"}
PRO = {"require": r"\bpro\b", "exclude": r"\bslim\b"}


def console(query, family, capacity, low, high):
    cap_req = r"500\s?gb" if capacity == "500" else r"1\s?tb|1000\s?gb"
    cap_bad = r"1\s?tb|1000\s?gb" if capacity == "500" else r"500\s?gb"
    return {
        "group": "consoles",
        "searches": [{
            "q": query,
            "category": "139971",  # Video Game Consoles
            "filter": USED_CONDITIONS,
            "require": [r"\bps4\b|playstation\s?4", cap_req] + ([family["require"]] if "require" in family else []),
            "exclude": [JUNK, NOT_A_CONSOLE, cap_bad, family["exclude"]],
            "range": (low, high),
            "add_shipping": False,  # this is what YOU would sell for, so ignore postage
        }],
    }


def part(query, low, high, require=(), exclude=(), condition=ANY_WORKING):
    return {
        "q": query,
        "filter": condition,
        "require": list(require),
        "exclude": [JUNK] + list(exclude),
        "range": (low, high),
        "add_shipping": True,  # you'd pay postage when buying a part
    }


ACCESSORY_JUNK = r"stand|dock|external|skin|sticker|cover only|screw|ribbon|cable only|\blot\b|x\s?[2-9]\b|\bpack\b"
HDD_JUNK = r"ssd|caddy|enclosure|external|usb|portable|\blot\b|x\s?[2-9]\b|\bpack\b|3\.5|desktop|ide\b"

ITEMS = {
    # ---- Consoles (working, used) ----
    "orig_500": console("ps4 console 500gb", ORIG_ONLY, "500", 30, 200),
    "orig_1tb": console("ps4 console 1tb", ORIG_ONLY, "1tb", 30, 220),
    "slim_500": console("ps4 slim console 500gb", SLIM, "500", 40, 220),
    "slim_1tb": console("ps4 slim console 1tb", SLIM, "1tb", 40, 250),
    "pro_1tb": console("ps4 pro console 1tb", PRO, "1tb", 60, 350),

    # ---- Parts ----
    "hdd_500": {"group": "parts", "searches": [
        part("500gb 2.5 sata laptop hard drive", 4, 40, require=[r"500\s?gb", r"2\.5"], exclude=[HDD_JUNK])]},
    "hdd_1tb": {"group": "parts", "searches": [
        part("1tb 2.5 sata laptop hard drive", 8, 70, require=[r"1\s?tb", r"2\.5"], exclude=[HDD_JUNK])]},

    "psu_orig": {"group": "parts", "searches": [
        part("ps4 power supply unit", 8, 60, require=[r"\bps4\b|playstation", r"power supply|\bpsu\b|adp-"],
             exclude=[ORIG_ONLY["exclude"], r"cable|lead|plug|adapter|charger"])]},
    "psu_slim": {"group": "parts", "searches": [
        part("ps4 slim power supply unit", 8, 60, require=[SLIM["require"], r"power supply|\bpsu\b|adp-"],
             exclude=[SLIM["exclude"], r"cable|lead|plug|adapter|charger"])]},
    "psu_pro": {"group": "parts", "searches": [
        part("ps4 pro power supply unit", 10, 80, require=[PRO["require"], r"power supply|\bpsu\b|adp-"],
             exclude=[PRO["exclude"], r"cable|lead|plug|adapter|charger"])]},

    "fan_orig": {"group": "parts", "searches": [
        part("ps4 internal cooling fan replacement", 3, 30, require=[r"\bps4\b|playstation", r"\bfan\b"],
             exclude=[ORIG_ONLY["exclude"], ACCESSORY_JUNK])]},
    "fan_slim": {"group": "parts", "searches": [
        part("ps4 slim internal cooling fan replacement", 3, 30, require=[SLIM["require"], r"\bfan\b"],
             exclude=[SLIM["exclude"], ACCESSORY_JUNK])]},
    "fan_pro": {"group": "parts", "searches": [
        part("ps4 pro internal cooling fan replacement", 3, 35, require=[PRO["require"], r"\bfan\b"],
             exclude=[PRO["exclude"], ACCESSORY_JUNK])]},

    "thermal_paste": {"group": "parts", "searches": [
        part("arctic mx-4 thermal paste 4g", 2, 20, require=[r"thermal|paste|compound"],
             exclude=[r"\bpad\b|pads|\blot\b|x\s?[2-9]\b"], condition="conditionIds:{1000}")]},

    "drive_orig": {"group": "parts", "searches": [
        part("ps4 blu ray disc drive mechanism kem-490", 5, 60, require=[r"\bps4\b|playstation|kem-?490"],
             exclude=[ORIG_ONLY["exclude"], r"kem-?496|faceplate|gear|motor only|ribbon|cable|screw|\bboard only\b"])]},
    "drive_slim": {"group": "parts", "searches": [
        part("ps4 slim blu ray disc drive mechanism kem-496", 5, 60, require=[SLIM["require"]],
             exclude=[SLIM["exclude"], r"faceplate|gear|motor only|ribbon|cable|screw|\bboard only\b"])]},
    "drive_pro": {"group": "parts", "searches": [
        part("ps4 pro blu ray disc drive mechanism kem-496", 5, 70, require=[PRO["require"]],
             exclude=[PRO["exclude"], r"faceplate|gear|motor only|ribbon|cable|screw|\bboard only\b"])]},

    "controller": {"group": "parts", "searches": [
        part("wireless controller for ps4", 6, 40, require=[r"controller|gamepad"],
             exclude=[r"sony|official|genuine|charging|charger|skin|grip|thumb|stand|case|\bparts?\b|shell"],
             condition="conditionIds:{1000}")]},

    # Two searches added together: a figure-8 power lead plus an HDMI cable.
    "cables": {"group": "parts", "searches": [
        part("figure 8 power cable ps4", 1, 15, require=[r"figure|fig|c7|2.?pin"],
             exclude=[r"hdmi|\blot\b|x\s?[2-9]\b"], condition="conditionIds:{1000}"),
        part("hdmi cable 1.5m", 1, 15, require=[r"hdmi"],
             exclude=[r"adapter|splitter|switch|\blot\b|x\s?[2-9]\b|\bpack\b|10m|15m|20m"], condition="conditionIds:{1000}"),
    ]},

    "shell_orig": {"group": "parts", "searches": [
        part("ps4 replacement housing shell case", 5, 50, require=[r"\bps4\b|playstation", r"shell|housing"],
             exclude=[ORIG_ONLY["exclude"], r"controller|skin|sticker|dust|bag|stand"])]},
    "shell_slim": {"group": "parts", "searches": [
        part("ps4 slim replacement housing shell case", 5, 50, require=[SLIM["require"], r"shell|housing"],
             exclude=[SLIM["exclude"], r"controller|skin|sticker|dust|bag|stand"])]},
    "shell_pro": {"group": "parts", "searches": [
        part("ps4 pro replacement housing shell case", 5, 60, require=[PRO["require"], r"shell|housing"],
             exclude=[PRO["exclude"], r"controller|skin|sticker|dust|bag|stand"])]},
}


def get_token(client_id, client_secret):
    creds = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    body = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "scope": "https://api.ebay.com/oauth/api_scope",
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=body, headers={
        "Authorization": f"Basic {creds}",
        "Content-Type": "application/x-www-form-urlencoded",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


def search(token, s):
    low, high = s["range"]
    filters = [
        "buyingOptions:{FIXED_PRICE}",  # Buy It Now only: auction bids aren't a real price yet
        "itemLocationCountry:GB",
        "deliveryCountry:GB",
        f"price:[{low}..{high}]",
        "priceCurrency:GBP",
        s["filter"],
    ]
    params = {"q": s["q"], "filter": ",".join(filters), "limit": "200"}
    if s.get("category"):
        params["category_ids"] = s["category"]
    req = urllib.request.Request(f"{SEARCH_URL}?{urllib.parse.urlencode(params)}", headers={
        "Authorization": f"Bearer {token}",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_GB",
        "Accept-Language": "en-GB",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r).get("itemSummaries", [])


def good_prices(items, s):
    prices = []
    for it in items:
        title = it.get("title", "").lower()
        if any(re.search(p, title) for p in s["exclude"] if p):
            continue
        if not all(re.search(p, title) for p in s["require"]):
            continue
        try:
            price = float(it["price"]["value"])
            if s["add_shipping"]:
                ship = (it.get("shippingOptions") or [{}])[0].get("shippingCost", {}).get("value")
                price += float(ship or 0)
        except (KeyError, ValueError, TypeError):
            continue
        prices.append(price)
    return remove_outliers(prices)


def remove_outliers(prices):
    """Drop anything far outside the middle half of prices (the 1.5 x IQR rule)."""
    if len(prices) < 4:
        return prices
    q1, _, q3 = statistics.quantiles(prices, n=4)
    spread = q3 - q1
    return [p for p in prices if q1 - 1.5 * spread <= p <= q3 + 1.5 * spread]


def main():
    client_id = os.environ.get("EBAY_CLIENT_ID")
    client_secret = os.environ.get("EBAY_CLIENT_SECRET")
    if not client_id or not client_secret:
        sys.exit("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not set. Add them as GitHub Secrets.")

    data = json.loads(PRICES_FILE.read_text(encoding="utf-8"))
    token = get_token(client_id, client_secret)
    today = date.today().isoformat()
    updated = 0

    for key, item in ITEMS.items():
        entry = data[item["group"]].get(key)
        if entry is None:
            print(f"SKIP {key}: not in prices.json")
            continue
        try:
            total, counts = 0.0, []
            for s in item["searches"]:
                prices = good_prices(search(token, s), s)
                if len(prices) < MIN_LISTINGS:
                    raise ValueError(f"only {len(prices)} usable listings for '{s['q']}'")
                total += statistics.median(prices)
                counts.append(len(prices))
        except Exception as e:  # keep the old price for this item
            print(f"KEEP {key}: {e} (staying at £{entry['price']})")
            continue
        entry["price"] = round(total)
        entry["listings"] = min(counts)
        entry["updated"] = today
        updated += 1
        print(f"OK   {key}: £{entry['price']} from {entry['listings']} listings")

    if updated == 0:
        sys.exit("Nothing could be updated, so prices.json was left as it was.")

    data["last_updated"] = today
    data["source"] = "eBay UK Browse API (median asking prices)"
    tmp = PRICES_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    json.loads(tmp.read_text(encoding="utf-8"))  # make sure what we wrote is valid
    tmp.replace(PRICES_FILE)
    print(f"Updated {updated} of {len(ITEMS)} prices.")


if __name__ == "__main__":
    main()
