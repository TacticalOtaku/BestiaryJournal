# Reveal thresholds stay on collection entries; a viewer gets the most lenient one

A GM can override reveal thresholds per collection entry, so one creature in two collections can have two sets of
thresholds. The knowledge lens resolves them per creature: for each block (and item) it takes the lowest threshold
among the entries the viewer can see. That is exactly what a player could already reach by opening the creature
from the more open collection, so every page now shows the same thing and no page shows more than another. Storage
is unchanged, so no `dataVersion` bump or migration.

## Considered options

- **First collection by order** (the old library behaviour): pages disagreed; a stricter threshold in one collection
  hid nothing, because the card opened from another collection showed it.
- **Most strict among visible entries**: a GM opening a block in one collection would see no effect while another
  collection keeps it hidden.
- **Move thresholds onto the creature**: the cleanest model, but it needs a data format change and a migration that
  has to merge conflicting overrides. Worth reopening if per-collection overrides turn out to be unused.

## Consequences

A stricter override in one collection has no effect while another visible collection is more open. The GM's tier
editor has to say so.
