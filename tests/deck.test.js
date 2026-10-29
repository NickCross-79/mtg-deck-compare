const test = require('node:test');
const assert = require('node:assert');
const { parseDeck, diffDecks, totalCards } = require('../deck.js');

test('parses common export formats', () => {
  const deck = parseDeck(`
Commander
1 Atraxa, Praetors' Voice (C16) 28 *F*
Deck
4x Lightning Bolt
1x Sol Ring (c21) 263 [Ramp] ^Have,#37d67a^
Island
2 Delver of Secrets // Insectile Aberration
SB: 1 Pyroblast
// a comment
Sideboard:
1 Delver of Secrets
`);
  assert.deepStrictEqual([...deck.entries()], [
    ["atraxa, praetors' voice", { name: "Atraxa, Praetors' Voice", qty: 1 }],
    ['lightning bolt', { name: 'Lightning Bolt', qty: 4 }],
    ['sol ring', { name: 'Sol Ring', qty: 1 }],
    ['island', { name: 'Island', qty: 1 }],
    ['delver of secrets', { name: 'Delver of Secrets // Insectile Aberration', qty: 3 }],
    ['pyroblast', { name: 'Pyroblast', qty: 1 }],
  ]);
  assert.strictEqual(totalCards(deck), 11);
});

test('diff accounts for quantity differences', () => {
  const a = parseDeck('4 Lightning Bolt\n1 Sol Ring\n10 Island');
  const b = parseDeck('2 lightning bolt\n1 Sol Ring\n12 Island\n1 Counterspell');
  assert.deepStrictEqual(diffDecks(a, b), {
    onlyA: [{ key: 'lightning bolt', name: 'Lightning Bolt', qty: 2 }],
    onlyB: [
      { key: 'counterspell', name: 'Counterspell', qty: 1 },
      { key: 'island', name: 'Island', qty: 2 },
    ],
  });
});
