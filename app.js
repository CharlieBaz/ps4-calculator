// PS4 Flip Calculator
// Prices come from prices.json. Anything you edit on the page is saved in this
// browser (localStorage) as an "override" and wins over the live price.

// ---- Fault list ----------------------------------------------------------
// part(m) returns the key in prices.json "parts" for the chosen model.
// m.family is "orig", "slim" or "pro"; m.cap is "500" or "1tb".
const FAULTS = [
  { id: 'hdd', label: 'Missing / dead hard drive', part: m => 'hdd_' + m.cap,
    note: 'Then reinstall firmware from USB.' },
  { id: 'firmware', label: 'Firmware reinstall via USB', part: () => 'firmware' },
  { id: 'psu', label: 'Dead power supply', part: m => 'psu_' + m.family },
  { id: 'fan', label: 'Noisy / dead fan', part: m => 'fan_' + m.family },
  { id: 'heat', label: 'Overheating (clean + thermal paste)', part: () => 'thermal_paste' },
  { id: 'disc', label: 'Disc drive not reading', part: m => 'drive_' + m.family,
    note: 'Swap the mechanism only. Keep the original drive board, it is paired to the motherboard.' },
  { id: 'controller', label: 'No controller (third-party)', part: () => 'controller' },
  { id: 'cables', label: 'Missing power / HDMI cable', part: () => 'cables' },
  { id: 'shell', label: 'Damaged shell', part: m => 'shell_' + m.family },
  { id: 'hdmi', label: 'HDMI port damaged', solder: true },
  { id: 'bld', label: 'Blue light of death (PSU works)', solder: true },
];

// ---- Storage ---------------------------------------------------------------
const KEY_OVERRIDES = 'ps4calc.overrides';
const KEY_FORM = 'ps4calc.form';
const KEY_DEALS = 'ps4calc.deals';

const load = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
};
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

let live = null;                         // contents of prices.json
let overrides = load(KEY_OVERRIDES, {}); // { "parts.psu_slim": 15, ... }
let form = load(KEY_FORM, {});           // last-used inputs
let deals = load(KEY_DEALS, []);

// path is like "consoles.slim_1tb", "parts.fan_pro", "settings.ebay_postage"
function liveValue(path) {
  const [group, key] = path.split('.');
  const entry = live[group][key];
  return typeof entry === 'object' ? entry.price : entry;
}
function value(path) {
  return path in overrides ? overrides[path] : liveValue(path);
}
function setOverride(path, v) {
  if (isNaN(v) || v === liveValue(path)) delete overrides[path];
  else overrides[path] = v;
  save(KEY_OVERRIDES, overrides);
}

// ---- Helpers -------------------------------------------------------------
const $ = id => document.getElementById(id);
const num = el => parseFloat(el.value) || 0;
const gbp = n => n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function modelInfo(key) {
  const [family, cap] = key.split('_');
  return { key, family, cap, label: live.consoles[key].label };
}

function sourceText(path) {
  if (path in overrides) return '<span class="edited-tag">Your price</span>';
  const [group, key] = path.split('.');
  const e = live[group][key];
  if (e.listings) return `eBay asking median · ${e.listings} listings`;
  return 'Starting estimate';
}

// ---- Build the page ----------------------------------------------------------
function buildModelSelect() {
  $('model').innerHTML = Object.entries(live.consoles)
    .map(([k, c]) => `<option value="${k}">${esc(c.label)}</option>`).join('');
}

function buildFaults() {
  const m = modelInfo($('model').value);
  const ticked = new Set(form.faults || []);
  $('faults').innerHTML = FAULTS.map(f => {
    const check = `<input type="checkbox" data-fault="${f.id}" ${ticked.has(f.id) ? 'checked' : ''}>`;
    if (f.solder) {
      return `<label class="fault">${check}
        <span class="name">${esc(f.label)}</span>
        <span class="solder-tag">NEEDS SOLDER</span></label>`;
    }
    const path = 'parts.' + f.part(m);
    const v = value(path);
    return `<label class="fault">${check}
      <span class="name">${esc(f.label)}
        ${f.note ? `<small class="muted">${esc(f.note)}</small>` : ''}
        <small class="muted" data-source="${path}">${sourceText(path)}</small></span>
      <input type="number" inputmode="decimal" min="0" step="0.5" value="${v}"
        data-path="${path}" class="${path in overrides ? 'edited' : ''}" aria-label="${esc(f.label)} cost"></label>`;
  }).join('');
}

function fillPriceInputs() {
  const pairs = [
    ['sale', 'consoles.' + $('model').value],
    ['postage', 'settings.ebay_postage'],
    ['cex-rate', 'settings.cex_rate_percent'],
  ];
  for (const [id, path] of pairs) {
    $(id).value = value(path);
    $(id).dataset.path = path;
    $(id).classList.toggle('edited', path in overrides);
  }
  $('sale-source').dataset.source = 'consoles.' + $('model').value;
  refreshSources();
}

function refreshSources() {
  for (const el of document.querySelectorAll('[data-source]')) el.innerHTML = sourceText(el.dataset.source);
  const n = Object.keys(overrides).length;
  $('override-count').textContent = n ? `You have ${n} edited price${n > 1 ? 's' : ''} saved.` : 'No edited prices — using live prices.';
}

function restoreForm() {
  if (form.model && live.consoles[form.model]) $('model').value = form.model;
  for (const id of ['buy', 'channel', 'hours', 'rate', 'contingency', 'target']) {
    if (form[id] !== undefined) $(id).value = form[id];
  }
}

function saveForm() {
  form = {
    model: $('model').value,
    faults: [...document.querySelectorAll('[data-fault]:checked')].map(c => c.dataset.fault),
  };
  for (const id of ['buy', 'channel', 'hours', 'rate', 'contingency', 'target']) form[id] = $(id).value;
  save(KEY_FORM, form);
}

// ---- The maths -------------------------------------------------------------
function calculate() {
  const channel = $('channel').value;
  const buy = num($('buy'));
  const sale = num($('sale'));
  const ticked = [...document.querySelectorAll('[data-fault]:checked')].map(c => c.dataset.fault);

  let parts = 0;
  for (const id of ticked) {
    const input = document.querySelector(`[data-fault="${id}"]`).closest('.fault').querySelector('input[type=number]');
    if (input) parts += num(input);
  }
  const contingency = parts * num($('contingency')) / 100;
  const postage = channel === 'ebay' ? num($('postage')) : 0;
  const labour = num($('hours')) * num($('rate'));
  const back = channel === 'cex' ? sale * num($('cex-rate')) / 100 : sale;

  const costExBuy = parts + contingency + postage + labour;
  const cost = buy + costExBuy;
  const profit = back - cost;
  const roi = cost > 0 ? profit / cost : null;
  const maxPay = back - costExBuy - num($('target'));
  const solder = FAULTS.filter(f => f.solder && ticked.includes(f.id));

  return { channel, buy, sale, ticked, parts, contingency, postage, labour, cost, back, profit, roi, maxPay, solder };
}

function render() {
  const r = calculate();
  $('r-buy').textContent = gbp(r.buy);
  $('r-parts').textContent = gbp(r.parts);
  $('r-contingency').textContent = gbp(r.contingency);
  $('r-postage').textContent = gbp(r.postage);
  $('r-labour').textContent = gbp(r.labour);
  $('r-cost').textContent = gbp(r.cost);
  $('r-back').textContent = gbp(r.back);
  $('r-profit').textContent = gbp(r.profit);
  $('r-roi').textContent = r.roi === null ? '—' : Math.round(r.roi * 100) + '%';
  $('r-maxpay').textContent = r.maxPay > 0 ? gbp(r.maxPay) : '£0 — target not reachable';

  for (const id of ['r-profit', 's-profit']) {
    $(id).classList.toggle('pos', r.profit >= 0);
    $(id).classList.toggle('neg', r.profit < 0);
  }
  $('s-profit').textContent = gbp(r.profit);
  $('s-maxpay').textContent = r.maxPay > 0 ? gbp(r.maxPay) : '£0';

  const w = $('solder-warning');
  w.hidden = r.solder.length === 0;
  w.textContent = r.solder.length
    ? `⚠ NEEDS SOLDER: ${r.solder.map(f => f.label).join(', ')}. You can't fix this without soldering kit, and it's not included in the costs above.`
    : '';

  $('postage-wrap').hidden = r.channel !== 'ebay';
  $('cex-wrap').hidden = r.channel !== 'cex';
  $('contingency-out').textContent = $('contingency').value + '%';
}

// ---- Deal log --------------------------------------------------------------
const channelNames = { local: 'Local cash', ebay: 'eBay', cex: 'CeX' };

function saveDeal() {
  const r = calculate();
  deals.unshift({
    id: Date.now(),
    date: new Date().toISOString().slice(0, 10),
    model: live.consoles[$('model').value].label,
    channel: channelNames[r.channel],
    buy: r.buy,
    faults: FAULTS.filter(f => r.ticked.includes(f.id)).map(f => f.label),
    total_cost: +r.cost.toFixed(2),
    expected_back: +r.back.toFixed(2),
    expected_profit: +r.profit.toFixed(2),
    sold: false,
    actual_sale: null,
    sold_date: null,
  });
  save(KEY_DEALS, deals);
  renderDeals();
  $('save-deal').textContent = 'Saved ✓';
  setTimeout(() => { $('save-deal').textContent = 'Save this deal to log'; }, 1500);
}

function renderDeals() {
  const sold = deals.filter(d => d.sold);
  const totalProfit = sold.reduce((s, d) => s + (d.actual_sale - d.total_cost), 0);
  const pending = deals.filter(d => !d.sold).reduce((s, d) => s + d.expected_profit, 0);
  $('log-summary').innerHTML = deals.length
    ? `<strong>Total profit so far: <span class="${totalProfit >= 0 ? 'pos' : 'neg'}">${gbp(totalProfit)}</span></strong>
       <div class="small muted">${sold.length} sold · ${deals.length - sold.length} unsold (expected ${gbp(pending)})</div>`
    : '<p class="muted small">No deals saved yet.</p>';

  $('log-list').innerHTML = deals.map(d => {
    const actual = d.sold ? d.actual_sale - d.total_cost : null;
    return `<div class="deal">
      <div class="top"><strong>${esc(d.model)}</strong><span class="muted">${esc(d.date)}</span></div>
      <div>Bought ${gbp(d.buy)} · ${esc(d.channel)} · cost ${gbp(d.total_cost)}</div>
      <div class="muted small">${d.faults.length ? esc(d.faults.join(', ')) : 'No faults'}</div>
      ${d.sold
        ? `<div>Sold ${gbp(d.actual_sale)} on ${esc(d.sold_date)} → profit <strong class="${actual >= 0 ? 'pos' : 'neg'}">${gbp(actual)}</strong>
            <span class="muted small">(expected ${gbp(d.expected_profit)})</span></div>`
        : `<div>Expected profit <strong>${gbp(d.expected_profit)}</strong></div>`}
      <div class="actions">
        ${d.sold ? '' : `<input type="number" inputmode="decimal" placeholder="Sold for £" data-sold-input="${d.id}">
          <button class="small" data-sold="${d.id}">Mark sold</button>`}
        <button class="small" data-delete="${d.id}">Delete</button>
      </div>
    </div>`;
  }).join('');
}

function onDealClick(e) {
  const soldId = e.target.dataset.sold;
  const delId = e.target.dataset.delete;
  if (soldId) {
    const input = document.querySelector(`[data-sold-input="${soldId}"]`);
    if (input.value === '') { input.focus(); return; }
    const d = deals.find(x => String(x.id) === soldId);
    d.sold = true;
    d.actual_sale = parseFloat(input.value);
    d.sold_date = new Date().toISOString().slice(0, 10);
  } else if (delId) {
    if (!confirm('Delete this deal?')) return;
    deals = deals.filter(x => String(x.id) !== delId);
  } else return;
  save(KEY_DEALS, deals);
  renderDeals();
}

function exportCsv() {
  const cols = ['date', 'model', 'channel', 'buy', 'faults', 'total_cost', 'expected_back', 'expected_profit',
                'sold', 'actual_sale', 'sold_date', 'actual_profit'];
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = deals.map(d => cols.map(c => cell(
    c === 'faults' ? d.faults.join('; ')
    : c === 'actual_profit' ? (d.sold ? (d.actual_sale - d.total_cost).toFixed(2) : '')
    : d[c])).join(','));
  const csv = [cols.join(','), ...rows].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `ps4-deals-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---- Events ----------------------------------------------------------------
function onInput(e) {
  const el = e.target;
  if (el.dataset.path) {
    setOverride(el.dataset.path, parseFloat(el.value));
    el.classList.toggle('edited', el.dataset.path in overrides);
    refreshSources();
  }
  saveForm();
  render();
}

function onChangeRebuild() {
  // Prices shown depend on the model, so redraw them when it changes.
  saveForm();
  buildFaults();
  fillPriceInputs();
  render();
}

function wireEvents() {
  document.querySelector('main').addEventListener('input', onInput);
  $('model').addEventListener('change', onChangeRebuild);

  $('reset-prices').addEventListener('click', () => {
    if (!confirm('Clear all your edited prices and go back to live prices?')) return;
    overrides = {};
    save(KEY_OVERRIDES, overrides);
    onChangeRebuild();
  });
  $('save-deal').addEventListener('click', saveDeal);
  $('log-list').addEventListener('click', onDealClick);
  $('export-csv').addEventListener('click', exportCsv);
}

// ---- Start -------------------------------------------------------------------
async function start() {
  try {
    const res = await fetch('prices.json', { cache: 'no-cache' });
    live = await res.json();
  } catch (err) {
    $('price-status').textContent = "Couldn't load prices.json. If you opened the file directly, use the local web server instead.";
    return;
  }
  // Drop overrides for prices that no longer exist in prices.json.
  for (const p of Object.keys(overrides)) {
    const [g, k] = p.split('.');
    if (!live[g] || !(k in live[g])) delete overrides[p];
  }
  $('price-status').innerHTML = live.last_updated
    ? `eBay UK asking prices · last updated ${esc(live.last_updated)}`
    : esc(live.source || 'Starting estimates');

  buildModelSelect();
  restoreForm();
  buildFaults();
  fillPriceInputs();
  wireEvents();
  render();
  renderDeals();
}

start();
