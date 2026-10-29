# MTG Deck Compare

A small static web app for upgrading one Magic: The Gathering deck into another.

Paste your current deck as Deck 1 and the target deck as Deck 2, then press **Upgrade** to see the cards to **remove** and the cards to **add** (including quantity differences), with the cost of the additions, the value of the cuts, and the net cost.

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

Each card is priced at its cheapest printing on Scryfall: the cheapest non-foil USD price, or the cheapest foil/etched price for cards that only exist in foil.

## Tests

```bash
npm test
```
