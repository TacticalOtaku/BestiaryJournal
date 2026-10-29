/**
 * Search, filters and sort order of a collection window, on the fields its cards carry
 * (`data-search-text`, `data-type`, `data-size`, `data-family-id`, `data-cr`, `data-name`), so a
 * card's `dataset` can be passed as it is. An unknown CR or name is an empty string.
 *
 * `state`: { query, types, sizes, families (Sets), crMin, crMax (strings, "" for no bound) }.
 */

export function matchesCollectionFilter(card, state) {
  const hasCrBound = state.crMin !== "" || state.crMax !== "";
  // A creature whose CR the viewer has not learned never matches a CR range.
  const inCrRange = () => {
    if (card.cr === "") return false;
    const cr = Number(card.cr);
    return (state.crMin === "" || cr >= Number(state.crMin)) && (state.crMax === "" || cr <= Number(state.crMax));
  };
  return (!state.query || card.searchText.includes(state.query))
    && (!state.types.size || state.types.has(card.type))
    && (!state.sizes.size || state.sizes.has(card.size))
    && (!state.families.size || state.families.has(card.familyId))
    && (!hasCrBound || inCrRange());
}

/** How many filters narrow the list; the search box is not one of them. */
export function activeFilterCount(state) {
  return state.types.size + state.sizes.size + state.families.size
    + Number(state.crMin !== "") + Number(state.crMax !== "");
}

/** `sortMode`: name-asc (default), name-desc, cr-asc, cr-desc. Unnamed and unrated creatures always sort after the ones the viewer knows. */
export function compareCollectionCards(a, b, sortMode) {
  const byName = direction => (!a.name - !b.name) || direction * a.name.localeCompare(b.name);
  const byCr = direction => ((a.cr === "") - (b.cr === ""))
    || direction * (Number(a.cr) - Number(b.cr))
    || byName(1);
  if (sortMode === "name-desc") return byName(-1);
  if (sortMode === "cr-asc") return byCr(1);
  if (sortMode === "cr-desc") return byCr(-1);
  return byName(1);
}
