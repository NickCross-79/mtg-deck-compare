(function () {
  const { parseDeck, diffDecks, totalCards } = window.Deck;

  const SCRYFALL = 'https://api.scryfall.com';
  const REQUEST_INTERVAL_MS = 100; // Scryfall asks for 50-100ms between requests

  const els = {
    deckA: document.getElementById('deck-a'),
    deckB: document.getElementById('deck-b'),
    countA: document.getElementById('count-a'),
    countB: document.getElementById('count-b'),
    compareBtn: document.getElementById('compare-btn'),
    upgradeBtn: document.getElementById('upgrade-btn'),
    status: document.getElementById('status'),
    results: document.getElementById('results'),
  };

  // cardKey -> { name, price (number | null), url, notFound? } ; persists across runs
  const priceCache = new Map();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Spaces request starts REQUEST_INTERVAL_MS apart while letting them overlap.
  let nextSlot = 0;
  async function throttledFetch(url) {
    const now = Date.now();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + REQUEST_INTERVAL_MS;
    await sleep(slot - now);
    return fetch(url);
  }

  // All printings of a card, cheapest first. Returns [] if nothing matches.
  async function searchPrintings(query) {
    const params = new URLSearchParams({ q: query, unique: 'prints', order: 'usd', dir: 'asc' });
    const res = await throttledFetch(`${SCRYFALL}/cards/search?${params}`);
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`Scryfall returned ${res.status}`);
    return (await res.json()).data || [];
  }

  async function fetchCheapestPrice(key) {
    const exact = `!"${key.replace(/"/g, '')}"`;
    const nonFoil = await searchPrintings(`${exact} usd>0`);
    if (nonFoil.length) {
      const card = nonFoil[0];
      return { name: card.name, price: Number(card.prices.usd), url: card.scryfall_uri };
    }

    // No non-foil price (foil-only cards) or no such card at all.
    const prints = await searchPrintings(exact);
    if (!prints.length) return { name: null, price: null, url: null, notFound: true };
    let best = null;
    for (const card of prints) {
      for (const v of [card.prices.usd_foil, card.prices.usd_etched]) {
        if (v != null && (!best || Number(v) < best.price)) {
          best = { name: card.name, price: Number(v), url: card.scryfall_uri };
        }
      }
    }
    return best || { name: prints[0].name, price: null, url: prints[0].scryfall_uri };
  }

  async function loadPrices(keys, onProgress) {
    const missing = [...new Set(keys)].filter((k) => !priceCache.has(k));
    let done = 0;
    let failed = 0;
    onProgress(`Fetching prices… (0/${missing.length})`);
    await Promise.all(missing.map(async (key) => {
      try {
        priceCache.set(key, await fetchCheapestPrice(key));
      } catch {
        failed++; // left uncached so the next run retries it
      }
      onProgress(`Fetching prices… (${++done}/${missing.length})`);
    }));
    if (failed) throw new Error(`${failed} card${failed > 1 ? 's' : ''} failed to load`);
  }

  // ---------- rendering ----------

  const money = (n) => (n == null ? '—' : `$${n.toFixed(2)}`);

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function withPrices(cards) {
    return cards.map((c) => {
      const info = priceCache.get(c.key) || {};
      const unit = info.price ?? null;
      return {
        ...c,
        name: info.name || c.name,
        url: info.url,
        notFound: !!info.notFound,
        unit,
        total: unit == null ? null : unit * c.qty,
      };
    });
  }

  const sumTotal = (cards) => cards.reduce((s, c) => s + (c.total || 0), 0);

  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    const label = btn.textContent;
    btn.textContent = 'Copied!';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 1200);
  }

  function renderList(title, cards, variant) {
    const panel = document.createElement('div');
    panel.className = `list-panel ${variant}`;
    const count = cards.reduce((s, c) => s + c.qty, 0);

    const rows = cards.length
      ? cards.map((c) => {
          const name = c.url
            ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">${escapeHtml(c.name)}</a>`
            : escapeHtml(c.name);
          const each = c.qty > 1 && c.unit != null ? `<span class="each">${money(c.unit)} ea</span>` : '';
          const flag = c.notFound ? '<span class="flag" title="Card not found on Scryfall">not found</span>' : '';
          return `<li><span class="qty">${c.qty}</span><span class="name">${name}${flag}</span>` +
                 `<span class="price">${each}${money(c.total)}</span></li>`;
        }).join('')
      : '<li class="empty">No cards</li>';

    panel.innerHTML = `
      <div class="list-header">
        <h3>${escapeHtml(title)} <span class="muted">(${count})</span></h3>
        <button type="button" class="copy-btn"${cards.length ? '' : ' disabled'}>Copy</button>
      </div>
      <ul class="card-list">${rows}</ul>
      <div class="list-footer"><span>Total</span><span>${money(sumTotal(cards))}</span></div>`;

    const text = cards.map((c) => `${c.qty} ${c.name}`).join('\n');
    panel.querySelector('.copy-btn').addEventListener('click', (e) => copyText(text, e.currentTarget));
    return panel;
  }

  function renderSummary(items) {
    const div = document.createElement('div');
    div.className = 'summary';
    div.innerHTML = items
      .map(([label, value, cls]) => `<div class="stat ${cls || ''}"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`)
      .join('');
    return div;
  }

  function render(mode, a, b, diff) {
    const onlyA = withPrices(diff.onlyA);
    const onlyB = withPrices(diff.onlyB);
    els.results.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = mode === 'compare' ? 'Differences' : 'Upgrade plan';
    els.results.appendChild(heading);

    if (!onlyA.length && !onlyB.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'These decks are identical.';
      els.results.appendChild(p);
      return;
    }

    const lists = document.createElement('div');
    lists.className = 'lists';

    if (mode === 'compare') {
      els.results.appendChild(renderSummary([
        ['Deck 1 cards', totalCards(a)],
        ['Deck 2 cards', totalCards(b)],
        ['Only in Deck 1', onlyA.reduce((s, c) => s + c.qty, 0)],
        ['Only in Deck 2', onlyB.reduce((s, c) => s + c.qty, 0)],
      ]));
      lists.append(renderList('Only in Deck 1', onlyA, 'side-a'), renderList('Only in Deck 2', onlyB, 'side-b'));
    } else {
      const addCost = sumTotal(onlyB);
      const removeValue = sumTotal(onlyA);
      const net = addCost - removeValue;
      els.results.appendChild(renderSummary([
        ['Cards to add', onlyB.reduce((s, c) => s + c.qty, 0)],
        ['Cards to remove', onlyA.reduce((s, c) => s + c.qty, 0)],
        ['Cost of additions', money(addCost), 'cost'],
        ['Value of removals', money(removeValue)],
        ['Net cost', (net < 0 ? '−' : '') + money(Math.abs(net))],
      ]));
      lists.append(renderList('Remove', onlyA, 'remove'), renderList('Add', onlyB, 'add'));
    }
    els.results.appendChild(lists);

    const missing = [...onlyA, ...onlyB].filter((c) => c.notFound).map((c) => c.name);
    if (missing.length) {
      const p = document.createElement('p');
      p.className = 'warning';
      p.textContent = `Couldn't find on Scryfall (check spelling): ${missing.join(', ')}`;
      els.results.appendChild(p);
    }
  }

  // ---------- wiring ----------

  function updateCounts() {
    els.countA.textContent = `${totalCards(parseDeck(els.deckA.value))} cards`;
    els.countB.textContent = `${totalCards(parseDeck(els.deckB.value))} cards`;
  }

  async function run(mode) {
    const a = parseDeck(els.deckA.value);
    const b = parseDeck(els.deckB.value);
    if (!a.size || !b.size) {
      els.status.textContent = 'Paste a deck list into both fields first.';
      els.status.className = 'status error';
      return;
    }

    const diff = diffDecks(a, b);
    els.compareBtn.disabled = els.upgradeBtn.disabled = true;
    els.status.className = 'status';
    try {
      await loadPrices([...diff.onlyA, ...diff.onlyB].map((c) => c.key), (msg) => { els.status.textContent = msg; });
      els.status.textContent = '';
    } catch (err) {
      els.status.textContent = `Couldn't load prices: ${err.message}. Showing cards without prices.`;
      els.status.className = 'status error';
    } finally {
      els.compareBtn.disabled = els.upgradeBtn.disabled = false;
    }
    render(mode, a, b, diff);
  }

  els.deckA.addEventListener('input', updateCounts);
  els.deckB.addEventListener('input', updateCounts);
  els.compareBtn.addEventListener('click', () => run('compare'));
  els.upgradeBtn.addEventListener('click', () => run('upgrade'));
  updateCounts();
})();
