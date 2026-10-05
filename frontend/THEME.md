# Shared interface theme

Palette: https://colorhunt.co/palette/e3f2fd90caf92196f30d47a1

- `public/design-tokens.css` is the source for backgrounds, surfaces, separators, overlays and interaction colors across all pages. The four palette anchors are `--blue-50`, `--blue-200`, `--blue-500`, `--blue-900`; surface shades support the existing light text.
- Existing foreground tokens and per-page text colors remain unchanged at the user's request. `--ink-on-accent` preserves the previous dark foreground formerly coupled to `--canvas`.
- `src/theme.ts` retains the original chart colors, independently of interface surfaces.
- `src/ui.tsx`: shared `UiButton` and `SiteHeader` used by dashboard actions and build views. Preserve each page's existing sizing and foreground classes.
- `public/ui.css`: shared surface styles loaded by React entry points and generated content pages. `scripts/generate-content.mjs` supplies one header/footer shell for every guide and informational page.
- Avoid adding literal background and border colors to page styles. Use semantic surface tokens or palette tokens for interaction states.
