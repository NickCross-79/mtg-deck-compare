# MTG Deck Compare

A small static web app for comparing two Magic: The Gathering deck lists.

- **Compare** shows the cards that are only in Deck 1 and only in Deck 2 (including quantity differences).
- **Upgrade** treats Deck 1 as your current deck and Deck 2 as the target, listing the cards to **remove** and the cards to **add**, with the cost of the additions, the value of the cuts, and the net cost.

Every card shows its USD price from [Scryfall](https://scryfall.com) (per-copy price is shown when there's more than one copy), every list has a total, and every list has a **Copy** button that copies it as `qty name` lines, ready to paste into Moxfield, Archidekt, etc.

## Running

There's no build step. Serve the folder with any static server:

```bash
npm start
```

then open http://localhost:8000. Opening `index.html` directly also works.

## Deck list formats

Paste exports from Moxfield, Archidekt, MTG Arena, MTGO, or plain text. All of these are understood:

```
Commander
1 Atraxa, Praetors' Voice (C16) 28 *F*
4x Lightning Bolt
1x Sol Ring (c21) 263 [Ramp]
Island
SB: 1 Pyroblast
```

Section headers, comments (`//`), set codes, collector numbers, foil markers and Archidekt tags are ignored. Double-faced cards match by their front face, so `Delver of Secrets` and `Delver of Secrets // Insectile Aberration` count as the same card.

## Prices

Prices come from Scryfall's default printing of each card. When that printing has no USD price (e.g. some promos), the cheapest non-foil printing is used instead, then the foil price as a last resort.

## Tests

```bash
npm test
```
