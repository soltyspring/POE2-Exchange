# Local product validation

## 2026-10-05 build presentation update

- Added inventory slot layout, weapon set switching, selected item options, gem icons and supports, and download/table of contents sidebar.
- Latest variant projection remains in use for the display and every export.
- Local checks: frontend build, 11 frontend tests and 6 build importer backend tests passed. Browser verified real equipment icons, set 2 selection and 390px viewport without horizontal overflow.
- Passive nodes are shown as priorities and lists; the API projection does not provide graph coordinates or edges.
- This update follows the user's deployment authorization. Earlier local-only notes below describe the prior review stage.

Review date: 2026-10-03. All changes remain in the local working tree.

## Scope and isolation

- No Git commit, push, SSH connection, server restart or deployment was performed.
- Frontend: `http://127.0.0.1:5174/`; API: `http://127.0.0.1:8001/`.
- Preview uses the existing SQLite snapshot with `mode=ro` and `PRAGMA query_only=ON`. An attempted write was rejected; manual refresh returns HTTP 409. No collectors or AI requests run in this preview. Public image CDN reads can still occur for uncached icons.
- Existing backend code, database schema and deploy configuration were not changed.

## Automated checks

| Check | Result |
| --- | --- |
| `npm test` | 8 passed: storage corruption, unrounded quantity arithmetic, freshness, safe CSV, ad guards, response/header timeouts, static navigation |
| `npm run build` | TypeScript and Vite succeeded; JS 457.05 kB / gzip 143.86 kB, CSS 108.25 kB / gzip 20.62 kB |
| `python -m unittest discover -s backend -p 'test_*.py'` | Existing 12 backend tests passed |
| `git diff --check` | Passed; only Git line-ending notices |

The final contrast fixes were rebuilt successfully. These checks do not establish real-user Core Web Vitals or AdSense approval.

## Browser checks with real local records

- 1440 × 900: dashboard, chart, selector, exchange and rewards share the same dark palette. Exchange cards retain five columns and 62 px height, with breaks after every three rows. Quantity and source details remain visible in the dashboard.
- 390 × 844: exchange search is 362 × 42 px with 14 px side margins; footer is 64 px high. Document width matches viewport. The legacy column toolbar conflicting with search width was fixed.
- 320 × 800: exchange search is 292 × 42 px, document width 320 px. Guide document width matches the 305 px usable width beside the scrollbar after removing the legacy minimum body width.
- Reward items sort by Korean name; the shared card layout provides a full name line above the price.
- Dialog Escape closes and returns focus to its launcher. Tab from the last reward action wraps to search. Background controls are inert while a dialog is open.
- Searching `카오스 오브` selects the correct item. Twenty units calculate 1,282.452 엑잘 from the unrounded source value. Zero quantity shows an invalid state instead of a zero quotation.
- Link copy produces a local URL with league/item parameters; opening it restores 카오스 오브 after loading. An unmatched search clearly states that there are no results.
- Official-volume heatmap has 168 cells and one Tab entry. ArrowDown moves to the next hour. A selected cell describes weekday/hour, median volume and sample hours in text.
- Existing local price records cover only two days. The price-pattern view shows accumulation progress; no buying-time recommendation is manufactured from this snapshot.
- Final visual inspection found pale legacy analysis-card backgrounds behind light text. All three cards now use the shared dark surface and readable text. Legacy important rules for change percentages were removed; falling-price text was verified as the shared readable blue rgb(128, 170, 255).
- The static reading guide renders without application JavaScript, uses the same palette, and includes contents/related links and an explicit unreviewed-draft label.

Screenshots: `runtime/product-review/dashboard.jpg`, `runtime/product-review/exchange.jpg` (local, Git-ignored).

## Remaining verification before public release

- Operator review of editorial content, operator/contact details, actual privacy/log retention, data/image/software rights, and a public HTTPS origin.
- AdSense account/site review and consent/CMP integration where required. No live ad script or publisher ID is present in this version; the eligibility helper is a guard for future integration, not an enabled ad system.
- Real-player usability sessions, production performance/uptime/security checks and restore drills. No claim of achieving store ranking, native-store approval, WCAG conformance or measured Core Web Vitals is made.
- Price-heatmap rendering with at least 21 days of genuine price records remains to be checked. Its official-volume keyboard interaction and insufficient-data state were checked locally.

## Mobalytics build import — 2026-10-05

- Added `/build-import.html` and `POST /api/builds/mobalytics`; linked from the dashboard menu and footer. Kept the existing market layout.
- Used the supplied public build URL. Actual retrieval found `My Build11` by IronKey with four variants. Empty Default is preserved but the first populated variant is selected automatically: 16 equipment records, six unique equipment records, 14 main skills, 26 support/subskills, 94 main-tree nodes and nine ascendancy nodes. Equipment counts include both weapon sets; node counts are not spent passive points.
- Downloaded and parsed the real build JSON (309,092 bytes, four variants), selected-variant Markdown (8,228 bytes at the initial export) and all-variant analysis JSON. Browser download-event observation timed out, but the files were verified directly in Downloads. Later Markdown exports also include the variant ID in their contents and filenames.
- Browser checks passed: invalid profile-only link rejection, empty variant notice, switching to the fourth variant (17 skill cards), 390 px and 320 px widths without horizontal document overflow, and readable dark styling.
- Final frontend build passed and includes both HTML entry points. Frontend tests: 10 passed. New backend import tests: six passed (URL validation, empty variants/weapon sets, cache isolation, published-only access, rate limiting and HTTP contract).
- Full backend suite: 25 passed, two existing overlay tests failed. Reproduced with `test_overlay.py` alone: `test_quotes_preserve_names_and_never_use_unique_as_rare_base` and `test_tablet_variants_are_saved_and_require_exact_selection`. Those fixtures write markets but no successful `fetch_state` entries; existing overlay logic uses `fetch_state.fetched_at` for freshness and therefore returns no live price. Overlay code/tests were not changed by this feature.
- Local API restarted to load the final import module. No production server connection, deployment, commit or push. Price collection stays disabled in the local preview; only an explicitly submitted build request queries Mobalytics. Build data is kept in a bounded memory cache, never the price database.
- Screenshot: `runtime/build-import/result.jpg`.

### Follow-up: show only the last variant

- Removed the variant selector. The web view and all three downloads use only the final entry in published variant order. An empty final entry remains empty, rather than falling back to an earlier populated version.
- Verified the supplied link now displays 17 main skills, 28 support/subskills and 93 main-tree nodes. No combobox is present. Parsed the downloaded build JSON and confirmed exactly one variant: `2538f631-fcef-4fdf-b1b5-90ac1e39d023`.
- Frontend tests: 11 passed, including nonmutation and the empty-last-entry case. TypeScript/Vite build passed. Backend retrieval remains unchanged.
- Screenshot: `runtime/build-import/last-variant.jpg`. Local only; no deployment or push.
