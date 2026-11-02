# Live check

Run before every release, on the Foundry and dnd5e versions in `module.json`, after `npm run check` and
`npm run deploy`. A change to the `styles` list in `module.json` needs a server restart; other CSS can be reloaded in
place.

## The automatic part

Open the windows to check, then paste `tools/live-check.js` into the browser console. It reads the page only and
prints four tables; each should be empty:

| Table | Means |
| --- | --- |
| `fonts` | Text not set in Bestiary Onest or Bestiary Display (a Foundry or system font leaking in). |
| `clipped` | Text cut off by its box with no ellipsis. |
| `overflow` | Something sticking out of its window sideways. |
| `unlabeled` | A button or link with no text, `aria-label` or tooltip. |

Run it in both themes (Night and Parchment), at the window's minimum size and at a normal one, and in compact density.

## Flows

Two users: a GM and a player, each in their own browser. Watch the console of both for errors throughout.

- **Library.** Overview, All creatures, Recent, Favourites, Party notes. The empty states: no collections, no
  favourites, a search with no match (the «Clear search» button clears it).
- **Collection.** Search, filters (type, size, family, CR range), the four sort orders, grid and list, the quick
  preview. A player sees creatures whose name they do not know in «Unidentified», never in their family.
- **Creature card.** Every tier from the player's side: nothing above the tier reaches the page, not even in
  attributes. GM: «Preview as» a player, block and item tiers, lock, notes in each channel.
- **Research.** A roll as the player; the GM's client judges it. The DC is shown only once the CR is known or the GM
  set it; the skill only once the type is known or the GM set it.
- **Knowledge board.** A cell change, a bulk change with its confirmation, a locked creature that does not change.
- **Actor menus.** The actor directory's context menu, the sheet's header control and the token HUD button.
- **Encounter reveal.** With the setting on, the first round of a started combat gives players «Rumours» of the
  creatures in it, and the player gets the notification.
- **Chat.** A shared card at each tier (the edge and the label follow the tier), a research result, both themes.
- **Look.** The look drawer: theme, accent, density, motion. With the OS asking for reduced motion, nothing moves.
- **API.** The calls in `API.md` from a macro, as GM and as a player (a player's write rejects).

Restore the test world afterwards: tiers, notes and chat messages made for the check.

## Collection artwork and portraits

- Use square, wide and portrait covers: the complete foreground stays visible, with a frozen blurred backdrop
  filling the remaining area. Captions sit below the collection art. Check normal and compact density, both themes,
  short/long names, and a narrow window; the create button should stay a compact action below the covers.
- Select/upload a GIF or animated WebP through the existing image picker. Its poster stays still until hover or
  keyboard focus. Leaving the tile/portrait stops visible playback; focus must keep it active after pointer exit.
  Include a GIF with a finite loop count after a long idle period, and repeated pointer entry with a cached image.
  Other image formats work when supported by the browser. Existing explicit creature crop/focal settings remain valid.
- Change motion to Reduced/Off while hovering, toggle the OS reduced-motion preference and hide the browser tab:
  playback stops. Scroll artwork outside the visible area and back. Reopen/rerender/close repeatedly without stale
  canvases or listeners. Check a failed URL, a lazy-loaded image, a cached image and an external image without CORS.
- As a player at Unknown, inspect the portrait: only the silhouette asset may be loaded or used to build a backdrop.
