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
- `src/services/repository.ts`: asynchronous repository contract, replaceable mock adapter, shared query logic, validation, explicit execution transitions, and versioned local persistence.
- `src/hooks/`: URL navigation and asynchronous view loading.
- `src/components/`: shared report collection, favorites controls, report details and execution demonstration.
- `src/pages/`: catalog and activity pages; `src/components/Workspace.tsx`: shared page states and category cards.
- `src/App.tsx`: application shell, overview, settings, help, and view coordination; `src/styles.css`: responsive enterprise design.

## Prototype behavior and limits

No connection to SQL Server, EFI Radius Classic, Crystal Reports, enterprise authentication, or any external API. The sample catalog reference date is 29 October 2026. Frequently used means at least 20 seeded accesses; recently added means within 30 days of that reference date. Catalog count is always the actual 96 mock records.

Favorites, preferences, and up to 500 prototype events persist under `efi-hub-v1` in browser local storage. Four initial favorites and four sample events help demonstrate the experience. Local and sample records are labeled. Storage is per browser and origin; local and hosted versions do not synchronize. Corrupt/unavailable storage falls back to defaults or session state with a notice.

Run demonstration validates parameters, then waits for an explicit Show demo result action. The preview is fixed illustrative data unrelated to parameter choices. No timer pretends to run a report. PDF and Excel actions explain that exports are unavailable; no files are generated. Processing can be canceled or reset. Report execution events are explicitly simulated.

The light theme is intentional. Profile editing, real exports, permissions, authentication, production auditing, and backend jobs are future work. A private Sites deployment protects the hosted preview; this does not implement enterprise application authentication.

## Verification

15 automated tests cover catalog integrity, queries over 576 records, composed filters, sorting, pagination, local persistence and fallback, parameter validation, explicit demo transitions, report interactions, URL navigation, global search, category links, empty states, and saved display preferences. Strict TypeScript checking and the production build pass. Dependency installation reports zero known vulnerabilities.

Browser QA exercised the overview and catalog at desktop size, the catalog at 820px tablet and 390px mobile widths, combined filters, favorite persistence across reload, mobile drawer navigation, activity recording, required-field focus, and the complete demo preview/export-disclosure workflow. No console warnings or errors were observed during those checks. These checks are not a complete screen-reader or cross-browser certification.
