# POE2 MARKET design system

## Purpose and user jobs

1. A player finds a drop: identify its Korean name, league, 1-item value and the market's reliability.
2. A player compares content: keep the original game inventory arrangement, select a reward, and inspect its trend.
3. A buyer plans a purchase: compare the item's recorded weekday/hour deviations with the observation count.

The dashboard is an analysis workspace. The exchange and rewards windows are full-screen inventories. Guides explain how to interpret the same data. These views use one visual system.

## Visual rules

The single source of tokens is `frontend/public/design-tokens.css`. Dark navy surfaces reduce the abrupt transition from the dashboard into inventory windows and suit use beside a game. Avoid unrelated gold/grey panels, bright white chart backgrounds, decorative hero gradients and color changes between workflows.

| Role | Token | Use |
| --- | --- | --- |
| Canvas | `--canvas` #0b121d | Page and list canvas |
| Surface | `--surface` #111a28 | Panels, cards, headers |
| Raised surface | `--surface-raised` #172235 | Filters and secondary panels |
| Primary text | `--text` #eef3fb | Names, headings, selected price |
| Secondary text | `--muted` #a7b6ca | Explanations, dates, units |
| Quiet text | `--quiet` #8395ae | Supporting labels, decimals |
| Action | `--accent` #80aaff | Selection, navigation, focus |
| Item value | `--gold` #efd18d | Inventory quote and quantity total |
| Warning | `--warning` #efd18d | Stale or insufficient data |
| Up/down | #ff8596 / #80aaff | Korean market convention, always accompanied by sign and percentage |

Use Pretendard and system fallbacks. Body text is 13–15px, editorial text 15px, main title 24–32px. Do not put essential meaning only into text below 11px. Numeric values use tabular numerals. Preserve the existing convention: amounts below 1 remain visually whole; amounts at least 1 use quieter fractional digits.

## Layout and interaction invariants

- Keep the desktop inventory 5 columns × 3 rows per 15-item block. Keep group and 3-row separators. Both inventory windows render `ExchangeItemGrid` and share identical 62px card heights and container padding.
- Names sit above quotes inside the existing cards so long prices cannot squeeze names. Preserve full text in accessible names and titles.
- Compact the dashboard's market list prices (K/M/B), with complete values in the tooltip. Keep original numbers in calculator and CSV.
- Desktop: persistent sidebar, chart and market selector side by side when there is adequate width. Collapse to one column when content becomes too narrow.
- Mobile: one-column analysis, scrollable inventory tabs, readable cards, bottom navigation clear of the safe area. Editorial pages need no JS.
- All overlays use the same focus trap, Escape, Ctrl/⌘K, background inertness, scroll locking and focus restoration. Open only one inventory at a time.
- Status must distinguish loading, request error, no observations, stale cache and fresh data. A green dot means fresh data, not merely a successful page request.
- Support visible focus, meaningful icon-button names, reduced motion and a skip link. Heatmap values must be accessible through buttons and explanatory text, not hover/color alone.

## Advertising rules

Do not make an ad look like an item, button, menu or price. Keep chart/quantity controls, inventory dialogs, errors, loading states and navigation screens clear of ads. Reserved editorial slots must have fixed minimum height, be labeled 광고 in the appropriate locale, and sit away from interactive content. Current implementation has no live advertising script. A local-only layout preview is available during content generation.

## Reference and reasoning

[getdesign.md](https://getdesign.md/) describes recording colors, typography, spacing, components and their rationale in a reusable design document. That method is applied here to the established POE2 product rather than importing a different website's visual identity. The improvements were selected using task analysis, Nielsen-style heuristics (status visibility, consistency, error recovery and recognition), progressive disclosure, keyboard accessibility and real viewport checks.
