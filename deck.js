// Deck list parsing and diffing. Pure functions, shared by the browser app and the tests.
(function (root) {
  const SECTION_HEADERS = new Set([
    'commander', 'commanders', 'companion', 'deck', 'main', 'maindeck', 'main deck',
    'mainboard', 'sideboard', 'maybeboard', 'considering', 'tokens', 'token',
    'creature', 'creatures', 'instant', 'instants', 'sorcery', 'sorceries',
    'artifact', 'artifacts', 'enchantment', 'enchantments', 'planeswalker',
    'planeswalkers', 'land', 'lands', 'battle', 'battles', 'spells', 'other',
  ]);

  // Lowercased front-face name, so "Delver of Secrets" and
  // "Delver of Secrets // Insectile Aberration" are treated as the same card.
  function cardKey(name) {
    return name.split(/\s*\/\/?\s*/)[0].trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function cleanName(raw) {
    return raw
      .replace(/\s+\^[^^]*\^/g, '')            // Archidekt color tags: ^Have,#37d67a^
      .replace(/\s+\[[^\]]*\]/g, '')           // Archidekt categories: [Ramp]
      .replace(/\s+\*[^*]+\*/g, '')            // foil / etched / commander markers: *F*
      .replace(/\s+\([A-Za-z0-9]{2,6}\)(\s+\S+)?\s*$/, '') // set + collector number: (C21) 263
      .replace(/\s+#\S.*$/, '')                // trailing tags
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Parses a pasted deck list (Moxfield, Archidekt, Arena, MTGO or plain text)
  // into a Map of cardKey -> { name, qty }.
  function parseDeck(text) {
    const cards = new Map();
    for (let line of text.split(/\r?\n/)) {
      line = line.trim();
      if (!line || line.startsWith('//') || line.startsWith('#')) continue;
      line = line.replace(/^SB:\s*/i, '');

      const header = line.replace(/\s*\(\d+\)\s*$/, '').replace(/:$/, '').trim().toLowerCase();
      if (SECTION_HEADERS.has(header) || /:$/.test(line)) continue;

      let qty = 1;
      let rest = line;
      const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
      if (m) {
        qty = parseInt(m[1], 10);
        rest = m[2];
      }
      const name = cleanName(rest);
      if (!name || qty <= 0) continue;

      const key = cardKey(name);
      const existing = cards.get(key);
      if (existing) existing.qty += qty;
      else cards.set(key, { name, qty });
    }
    return cards;
  }

  // Cards (with the extra quantity) that `a` has beyond what `b` has.
  function subtract(a, b) {
    const out = [];
    for (const [key, card] of a) {
      const extra = card.qty - (b.get(key)?.qty || 0);
      if (extra > 0) out.push({ key, name: card.name, qty: extra });
    }
    return out.sort((x, y) => x.name.localeCompare(y.name));
  }

  // Cards in both decks, at the quantity they have in common.
  function intersect(a, b) {
    const out = [];
    for (const [key, card] of a) {
      const qty = Math.min(card.qty, b.get(key)?.qty || 0);
      if (qty > 0) out.push({ key, name: card.name, qty });
    }
    return out.sort((x, y) => x.name.localeCompare(y.name));
  }

  function diffDecks(a, b) {
    return { onlyA: subtract(a, b), onlyB: subtract(b, a), shared: intersect(a, b) };
  }

  function totalCards(deck) {
    let n = 0;
    for (const card of deck.values()) n += card.qty;
    return n;
  }

  const api = { parseDeck, diffDecks, cardKey, totalCards };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Deck = api;
})(this);
