# Shared interface theme

Design references: [Linear interface refresh](https://linear.app/now/behind-the-latest-design-refresh), [TradingView market overview](https://www.tradingview.com/markets/).

- `public/design-tokens.css` is the source for backgrounds, surfaces, separators, overlays and interaction colors across all pages. Neutral charcoal layers let prices stand out; navigation is subdued and selection uses a small muted accent. The rejected saturated blue palette is removed.
- Existing foreground tokens and per-page text colors remain unchanged at the user's request. `--ink-on-accent` preserves the previous dark foreground formerly coupled to `--canvas`.
- `src/theme.ts` retains the original chart colors, independently of interface surfaces.
- `src/ui.tsx`: shared `UiButton` and `SiteHeader` used by dashboard actions and build views. Preserve each page's existing sizing and foreground classes.
- `public/ui.css`: shared surface styles loaded by React entry points and generated content pages. `scripts/generate-content.mjs` supplies one header/footer shell for every guide and informational page.
- Avoid adding literal background and border colors to page styles. Use semantic surface tokens for interaction states. Preserve exchange grid placement and existing typography/price colors.
