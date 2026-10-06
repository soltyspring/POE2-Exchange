# Expedition runeshape planner

Source: https://poe2db.tw/kr/Runeshape_Combinations
Snapshot checked: 2026-10-07. 34 rune types and 322 combinations.

The JSON preserves source rune order, repetitions, reward quantities and level ranges. Korean names are source names; untranslated source names remain unchanged. This is a checked-in snapshot, not a live recipe feed. Review and update the snapshot after game patches.

The UI ignores entry order. Contains matching uses a multiset and counts repeated runes independently; it requires every entered rune to occur in the candidate recipe. Remaining runes preserve source order. Input persists only in sessionStorage for the browser tab. Total slots and reward search further narrow candidates. Level ranges remain visible on reward cards; there is no region-level filter.

Prices come from the selected league's existing market response, multiplied by reward quantity. Only unambiguous exact reward-name matches are priced. Random, unmatched and ambiguous variant rewards have no estimated price. Recipe matching does not model all game unlock or combat conditions and does not guarantee rewards.

The planner and recipe data are loaded on demand. Existing exchange layouts are unchanged. Run `npm test` and `npm run build` in frontend. UI verified at desktop and 390px mobile widths.
