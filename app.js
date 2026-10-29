(function () {
  const { parseDeck, diffDecks, cardKey, totalCards } = window.Deck;

  const SCRYFALL = 'https://api.scryfall.com';
  // Scryfall limits /cards/search to about 2 requests per second; going faster gets requests rejected.
  const REQUEST_INTERVAL_MS = 500;
  const NAMES_PER_QUERY = 20; // keeps the search URL a reasonable length
  const MAX_ATTEMPTS = 4;

  const els = {
    deckA: document.getElementById('deck-a'),
    deckB: document.getElementById('deck-b'),
    countA: document.getElementById('count-a'),
    countB: document.getElementById('count-b'),
    upgradeBtn: document.getElementById('upgrade-btn'),
    status: document.getElementById('status'),
    results: document.getElementById('results'),
  };

  // cardKey -> { name, price (number | null), url, image, imageLarge, notFound? } ; persists across runs
  const priceCache = new Map();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Spaces request starts REQUEST_INTERVAL_MS apart, retrying with backoff when Scryfall
  // rejects one (a rate-limited response has no CORS headers, so it surfaces as a network error).
  let nextSlot = 0;
  async function scryfallGet(url) {
    for (let attempt = 1; ; attempt++) {
      const now = Date.now();
      const slot = Math.max(now, nextSlot);
      nextSlot = slot + REQUEST_INTERVAL_MS;
      await sleep(slot - now);
      try {
        const res = await fetch(url);
        if (res.status === 404) return { data: [] }; // query matched nothing
        if (res.ok) return await res.json();
        if (res.status !== 429 && res.status < 500) throw new Error(`Scryfall returned ${res.status}`);
      } catch (err) {
        if (attempt >= MAX_ATTEMPTS || err.message.startsWith('Scryfall returned')) throw err;
      }
      if (attempt >= MAX_ATTEMPTS) throw new Error('Scryfall is rate limiting requests, try again shortly');
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }

  function imagesOf(card) {
    const uris = card.image_uris || card.card_faces?.[0]?.image_uris || {};
    return { image: uris.small || null, imageLarge: uris.normal || uris.large || null };
  }

  // Every paper printing of the given cards, in one paged search per batch of names.
  async function fetchPrintings(keys) {
    const query = `game:paper (${keys.map((k) => `!"${k.replace(/"/g, '')}"`).join(' or ')})`;
    const params = new URLSearchParams({ q: query, unique: 'prints', order: 'name' });
    let url = `${SCRYFALL}/cards/search?${params}`;
    const prints = [];
    while (url) {
      const page = await scryfallGet(url);
      prints.push(...(page.data || []));
      url = page.has_more ? page.next_page : null;
    }
    return prints;
  }

  // Picks the cheapest printing: the lowest non-foil price, or the lowest foil/etched
  // price for cards that only exist in foil.
  function cheapest(prints) {
    let best = null;
    let bestFoil = null;
    for (const card of prints) {
      const p = card.prices || {};
      if (p.usd != null && (!best || Number(p.usd) < best.price)) best = { card, price: Number(p.usd) };
      for (const v of [p.usd_foil, p.usd_etched]) {
        if (v != null && (!bestFoil || Number(v) < bestFoil.price)) bestFoil = { card, price: Number(v) };
      }
    }
    const pick = best || bestFoil || { card: prints[0], price: null };
    return { name: pick.card.name, price: pick.price, url: pick.card.scryfall_uri, ...imagesOf(pick.card) };
  }

  async function loadPrices(keys, onProgress) {
    const missing = [...new Set(keys)].filter((k) => !priceCache.has(k));
    let done = 0;
    for (let i = 0; i < missing.length; i += NAMES_PER_QUERY) {
      onProgress(`Fetching prices… (${done}/${missing.length})`);
      const batch = missing.slice(i, i + NAMES_PER_QUERY);
      const byKey = new Map();
      for (const card of await fetchPrintings(batch)) {
        const key = cardKey(card.name);
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(card);
      }
      for (const key of batch) {
        const prints = byKey.get(key);
        priceCache.set(key, prints ? cheapest(prints) : { name: null, price: null, url: null, notFound: true });
      }
      done += batch.length;
    }
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
        image: info.image,
        imageLarge: info.imageLarge,
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
          const thumb = c.image
            ? `<img class="thumb" src="${escapeHtml(c.image)}" data-large="${escapeHtml(c.imageLarge || c.image)}" alt="" loading="lazy">`
            : '<span class="thumb"></span>';
          return `<li><span class="qty">${c.qty}</span>${thumb}<span class="name">${name}${flag}</span>` +
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

  function render(diff) {
    const onlyA = withPrices(diff.onlyA);
    const onlyB = withPrices(diff.onlyB);
    els.results.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = 'Upgrade plan';
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

  async function run() {
    const a = parseDeck(els.deckA.value);
    const b = parseDeck(els.deckB.value);
    if (!a.size || !b.size) {
      els.status.textContent = 'Paste a deck list into both fields first.';
      els.status.className = 'status error';
      return;
    }

    const diff = diffDecks(a, b);
    els.upgradeBtn.disabled = true;
    els.status.className = 'status';
    try {
      await loadPrices([...diff.onlyA, ...diff.onlyB].map((c) => c.key), (msg) => { els.status.textContent = msg; });
      els.status.textContent = '';
    } catch (err) {
      els.status.textContent = `Couldn't load prices: ${err.message}. Showing cards without prices.`;
      els.status.className = 'status error';
    } finally {
      els.upgradeBtn.disabled = false;
    }
    render(diff);
  }

  // Enlarged card image that follows the cursor while hovering a thumbnail.
  const preview = document.createElement('img');
  preview.className = 'card-preview';
  preview.alt = '';
  document.body.appendChild(preview);

  function placePreview(e) {
    const gap = 16;
    const w = preview.offsetWidth;
    const h = preview.offsetHeight;
    let x = e.clientX + gap;
    if (x + w > window.innerWidth - gap) x = e.clientX - w - gap;
    const y = Math.min(Math.max(gap, e.clientY - h / 2), window.innerHeight - h - gap);
    preview.style.transform = `translate(${Math.max(gap, x)}px, ${y}px)`;
  }

  els.results.addEventListener('mouseover', (e) => {
    const thumb = e.target.closest('img.thumb');
    if (!thumb) return;
    preview.src = thumb.dataset.large;
    preview.classList.add('visible');
    placePreview(e);
  });
  els.results.addEventListener('mousemove', (e) => {
    if (preview.classList.contains('visible')) placePreview(e);
  });
  els.results.addEventListener('mouseout', (e) => {
    if (e.target.closest('img.thumb')) preview.classList.remove('visible');
  });

  els.deckA.addEventListener('input', updateCounts);
  els.deckB.addEventListener('input', updateCounts);
  els.upgradeBtn.addEventListener('click', run);
  updateCounts();
})();
