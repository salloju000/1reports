# EFI Reporting Hub

Interactive frontend demonstration for centralized EFI Radius Classic report discovery. Built with React, strict TypeScript, Vite, Tailwind CSS, and Lucide React.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. For validation: `npm test`, `npm run typecheck`, and `npm run build`. `dist/` contains the static production application. Hash routing supports direct links on static hosting.

## Architecture

- `src/data/mock/`: 96 realistic reports, eight categories, metadata-driven parameters, mock user, notifications, seeded history, and sample preview.
- `src/services/contracts.ts`: typed repository boundary for catalog queries, metadata, dashboard summaries, recent history, favorites, and demonstration execution. `repository.ts` is the local mock adapter.
- `src/services/`: shared query normalization, access-history selectors, strict parameter validation, execution transitions, and versioned local storage. Preferences use a separate persistence interface.
- `src/hooks/`: URL navigation and asynchronous view loading.
- `src/components/`: semantic desktop report table, mobile/grid cards, favorites controls, details panel, shared page states, and category cards.
- `src/features/reports/`: metadata-driven parameter form and serialized demonstration workflow.
- `src/layouts/`: accessible application shell, sidebar, mobile drawer, and popovers. `src/pages/`: catalog, overview, recent reports, activity, settings, and help.
- `src/App.tsx`: dependency injection and page coordination; `src/styles.css`: responsive enterprise design.

Pass a `ReportRepository` and optional `PreferencesPersistence` to `App` to replace its data adapters. Pages and presentation components do not import mock catalogs. `getMetadata` supplies filter options and category counts; paginated queries return the effective page; summaries and previews are adapter-owned. An independent test adapter verifies that alternative categories, totals, user data, reports, and previews render without page changes. No API adapter is implemented in this phase.

## Prototype behavior and limits

No connection to SQL Server, EFI Radius Classic, Crystal Reports, enterprise authentication, or any external API. The sample catalog reference date is 29 October 2026. Frequently used means at least 20 seeded accesses; recently added means within 30 days of that reference date. Catalog count is always the actual 96 mock records.

Favorites, preferences, and up to 500 prototype events persist under `efi-hub-v1` in browser local storage. Four initial favorites and four sample events help demonstrate the experience. Local and sample records are labeled. Storage is per browser and origin; local and hosted versions do not synchronize. Corrupt/unavailable storage falls back to defaults or session state with a notice.

The catalog's play action opens the parameter section directly. Run demonstration validates real calendar dates, required values, date ordering, and configured selections, then waits for an explicit Show demo result action. Previews use category-specific illustrative data unrelated to parameter choices. No timer pretends to run a report. PDF and Excel actions explain that exports are unavailable; no files are generated. Processing can be canceled or reset; concurrent transitions are prevented. Report execution events are explicitly simulated.

Search and filters compose against the latest URL state, and page links remain bounded for large catalogs. Invalid URL values normalize safely. Recent history and dashboard access timestamps use access/execution events, excluding favorite changes. Effect replay does not duplicate deep-link view records. The existing `efi-hub-v1` storage format is preserved.

The light theme is intentional. Profile editing, real exports, permissions, authentication, production auditing, and backend jobs are future work. A private Sites deployment protects the hosted preview; this does not implement enterprise application authentication.

## Verification

40 automated tests cover catalog integrity, queries over 576 records, bounded pagination, malformed URLs, search/filter/sort races, local persistence and fallback, strict date/option validation, serialized demo transitions, reset/cancel behavior, repository failures and retry, independent-adapter rendering, activity accuracy, deep-link effect replay, modal focus restoration, popover/drawer dismissal, navigation names, global search, category links, empty states, and saved display preferences. Run `npm test`, `npm run typecheck`, and `npm run build` to verify.

Browser QA exercised the overview and catalog at desktop size, the catalog at 820px tablet and 390px mobile widths, combined filters, favorite persistence across reload, mobile drawer navigation, activity recording, required-field focus, and the complete demo preview/export-disclosure workflow. No console warnings or errors were observed during those checks. These checks are not a complete screen-reader or cross-browser certification.
