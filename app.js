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

  const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const money = (n) => (n == null ? '—' : currency.format(n));

  // Price tiers borrow the rarity-symbol colors: cheap cards read as commons, pricey ones as mythics.
  function tierOf(price) {
    if (price == null) return 'none';
    if (price < 1) return 'common';
    if (price < 10) return 'uncommon';
    if (price < 50) return 'rare';
    return 'mythic';
  }

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
    btn.textContent = 'Copied';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 1200);
  }

  const countOf = (cards) => cards.reduce((s, c) => s + c.qty, 0);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function renderList(title, cards, variant) {
    const panel = document.createElement('section');
    panel.className = `list-panel ${variant}`;

    const rows = cards.length
      ? cards.map((c) => {
          const name = c.url
            ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">${escapeHtml(c.name)}</a>`
            : escapeHtml(c.name);
          const each = c.qty > 1 && c.unit != null ? `<span class="each">${money(c.unit)} each</span>` : '';
          const flag = c.notFound ? '<span class="flag">Not found</span>' : '';
          const thumb = c.image
            ? `<img class="thumb" src="${escapeHtml(c.image)}" data-large="${escapeHtml(c.imageLarge || c.image)}" alt="" loading="lazy">`
            : '<span class="thumb"></span>';
          return `<li>${thumb}<span class="qty">${c.qty}</span><span class="name">${name}${flag}</span>` +
                 `<span class="price tier-${tierOf(c.unit)}">${each}<span class="amount">${money(c.total)}</span></span></li>`;
        }).join('')
      : '<li class="empty">Nothing here</li>';

    panel.innerHTML = `
      <header class="list-header">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p class="list-meta">${plural(countOf(cards), 'card')}, ${money(sumTotal(cards))}</p>
        </div>
        <button type="button" class="copy-btn"${cards.length ? '' : ' disabled'}>Copy list</button>
      </header>
      <ul class="card-list">${rows}</ul>`;

    const text = cards.map((c) => `${c.qty} ${c.name}`).join('\n');
    panel.querySelector('.copy-btn').addEventListener('click', (e) => copyText(text, e.currentTarget));
    return panel;
  }

  function render(diff) {
    const cuts = withPrices(diff.onlyA);
    const adds = withPrices(diff.onlyB);
    els.results.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = 'Upgrade plan';
    els.results.appendChild(heading);

    const summary = document.createElement('p');
    summary.className = 'summary';
    els.results.appendChild(summary);

    if (!cuts.length && !adds.length) {
      summary.textContent = 'These decks have exactly the same cards. Nothing to cut or add.';
      return;
    }

    const addCost = sumTotal(adds);
    const cutValue = sumTotal(cuts);
    const net = addCost - cutValue;
    summary.innerHTML =
      `Add ${plural(countOf(adds), 'card')} for <strong>${money(addCost)}</strong> ` +
      `and cut ${plural(countOf(cuts), 'card')} worth <strong>${money(cutValue)}</strong>. ` +
      (net >= 0
        ? `Net cost of the upgrade: <strong class="net">${money(net)}</strong>.`
        : `The cuts are worth <strong class="net">${money(-net)}</strong> more than the additions.`);

    const lists = document.createElement('div');
    lists.className = 'lists';
    lists.append(renderList('Cut', cuts, 'cut'), renderList('Add', adds, 'add'));
    els.results.appendChild(lists);

    const missing = [...cuts, ...adds].filter((c) => c.notFound).map((c) => c.name);
    if (missing.length) {
      const p = document.createElement('p');
      p.className = 'warning';
      p.textContent = `Scryfall has no card named ${missing.join(', ')}. Check the spelling in your list and run the upgrade again.`;
      els.results.appendChild(p);
    }
  }

  // ---------- wiring ----------

  function updateCounts() {
    els.countA.textContent = plural(totalCards(parseDeck(els.deckA.value)), 'card');
    els.countB.textContent = plural(totalCards(parseDeck(els.deckB.value)), 'card');
  }

  async function run() {
    const a = parseDeck(els.deckA.value);
    const b = parseDeck(els.deckB.value);
    if (!a.size || !b.size) {
      els.status.textContent = 'Paste a deck list into both boxes, then press Upgrade.';
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
      els.status.textContent = `Prices didn't load (${err.message}). Press Upgrade again to retry.`;
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
