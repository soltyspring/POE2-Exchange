# Local product review and release preparation

Review date: 2026-10-03. Scope: local implementation and verification only. No push, SSH, server restart or production deployment is part of this change.

## User-facing problems and changes

| Finding | Effect on a player | Implemented response |
| --- | --- | --- |
| Light dashboard → charcoal/gold inventory | Feels like a different product | Shared navy tokens across all views and static guides; chart palette matched |
| Long raw prices squeeze item names | Difficult to identify drops | Compact selector prices; names and prices separated within the same inventory card |
| Green freshness dot despite old data | Outdated price looks current | Per-category status, conservative whole-market freshness, no past next-refresh time |
| Missing quantity tools | Must calculate in another app | Full-precision quantity estimate with currency unit and invalid-input handling |
| Analysis cannot be shared or saved | Hard to return to a specific market or compare personally | League/item deep links and safe CSV exports |
| Different overlay keyboard behavior | Focus can escape into the underlying chart | Common focus trap, inert background, Escape, Ctrl/⌘K and return focus |
| Heatmap depends on hover and color | Mobile and keyboard users lose detail | Focusable cells, text detail and sparse-sample marker |
| Fetch can hang / league requests race | Permanent loading or wrong league data | Request timeout, latest-market-response check, immediate clearing of old analysis |
| JSON storage assumed to be arrays | A corrupt/private browser state breaks UI | Validated preference storage and root recovery boundary |
| Only raw price tables | Little explanation of the service's value | 4 task-based guides plus methodology, about, contact, privacy and usage pages |
| Important pages require client JS | Difficult to read when JS/API fails | Generated static HTML with semantic structure and working internal links |

## Engineering approach

Small shared domain modules cover storage, quantity math, freshness and CSV. Request timeouts are isolated in `apiClient`. Market-window behavior is isolated in `useMarketDialog`. The existing collector and DB schema are unchanged. No deployment script is modified.

`tools/local_preview.py` runs a separate loopback-only FastAPI service. It reads the existing SQLite DB with `mode=ro` and `PRAGMA query_only=ON`, starts no background collectors, does not write tracked views or observations, refuses manual refresh, and uses statistical summaries without sending AI requests. Missing local icons can redirect to the public image CDN; this is a read of image data, not a price or collection request.

Static content is generated from `frontend/content/pages.json` before dev/build. Review state is explicit and defaults to unreviewed. Public indexing and canonical URLs require a configured `POE_PUBLIC_SITE_URL`; sitemap generation never guesses a production domain. Live ad code is absent. Layout previews require `POE_AD_LAYOUT_PREVIEW=1` with no public-site origin.

## AdSense requirements and remaining gates

These are release tasks, not an approval guarantee. Google reviews the actual public site; a local UI cannot be submitted as a finished live site.

| Area | This version | Before public submission |
| --- | --- | --- |
| Useful original content | Quantity math, analysis, curated original use guides | Operator reviews accuracy, adds actual editorial experience, sets reviewed flags |
| Navigation / usability | Clear views, guides, footer, recovery | Run a small real-player usability round and resolve blockers |
| Site ownership and reachability | Static HTML and configurable public origin | Owner-controlled stable HTTPS domain, accessible to crawlers, request review in AdSense |
| Privacy and third parties | Honest disclosure of current storage, APIs, fonts, disabled ads | Confirm operator identity/contact, actual logs/retention, providers, dates and jurisdictions |
| Consent | No home-made consent pretending to be a CMP | Configure Google-certified TCF CMP for relevant EEA/UK/Swiss ad traffic and validate it |
| Ad placement | No ads in tool controls or overlays; local editorial spacing preview | Approval, valid publisher/slot IDs, consent gating, responsive reserved space, correct ads.txt line from account |
| Rights / attribution | Game and data source attribution | Review API redistribution/commercial terms, game assets and third-party software licenses |
| Invalid traffic | No incentivized clicking or auto-clicking | Bot/rate monitoring, operator access separated from ad traffic, no artificial traffic |
| Service reliability | Local readonly preview and existing collector tests | Verify uptime, backups and restore, server logs/alerts, API concurrency and abuse limits |

Primary sources checked:

- [Eligibility](https://support.google.com/adsense/answer/9724)
- [Unique content and experience](https://support.google.com/adsense/answer/7299563)
- [Site setup and live-site review](https://support.google.com/adsense/answer/7402256)
- [Publisher-content requirements](https://support.google.com/publisherpolicies/answer/11112688)
- [Privacy disclosures](https://support.google.com/adsense/answer/1348695)
- [Certified CMP requirements](https://support.google.com/adsense/answer/13554116)
- [Ad placement](https://support.google.com/adsense/answer/1346295)

No minimum article count, word count or traffic number is presented here as an official approval threshold.

## Becoming a service players choose repeatedly

Ranking first in an app store is an outcome to validate, not a feature or a claim this work can make. This repository is currently a web service. A native store release would be a separate product and review task; AdSense eligibility is not native App Store approval.

Next milestones should be driven by evidence:

1. **Usability:** 5–8 actual players attempt finding a drop, converting 20 units, switching league, adding a favorite, and interpreting one heatmap cell. Record completion, mistaken units and time spent without recording private account data.
2. **Trust:** ensure source failures and stale references never masquerade as fresh quotes. Audit rights and factual guide accuracy. Add data validation for market anomalies before calling any value a recommendation.
3. **Performance:** measure real LCP/INP/CLS, initial item-selection latency and icon failures. Targets chosen for this project: LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 at the 75th percentile; these are targets, not achieved metrics.
4. **Retention:** opt-in price targets, saved comparison baskets, exported personal farming records and league-specific watchlists. Build only after consent, notification semantics and backend ownership are defined.
5. **Distribution:** structured content, indexable stable URLs and a real content publishing process. Manifest establishes install metadata; native stores, offline behavior, push and app-quality gates still need separate work.

## Local running

From the repository root:

```powershell
python tools/local_preview.py
```

In `frontend`:

```powershell
$env:POE_API_PROXY_TARGET='http://127.0.0.1:8001'
npm run dev -- --port 5174 --strictPort
```

Open http://127.0.0.1:5174/. No server connection or deployment is needed. For local ad-spacing review only, set `POE_AD_LAYOUT_PREVIEW=1` before `npm run generate:content`. Reset it and regenerate before any production build.

Validation results are recorded in `LOCAL_VALIDATION.md` after the checks complete.
