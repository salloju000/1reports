# EFI Reporting Hub visual system

The redesign replaces the original blue dashboard identity across the shared application shell and every page. No routes, mock records, repositories, or report workflows were added or replaced.

## Diagnosis

The previous stylesheet contained 224 hardcoded colors across approximately 2,700 lines, including repeated component and responsive overrides. Most later refinements left the original navy sidebar, white 73px header, blue-gray page background, pastel category badges, and nested dashboard cards in place. A prototype banner, sidebar promotional card, catalog banner, and dashboard shortcut panel repeated information and pushed useful report rows below the fold.

## Decisions

- Light stone navigation (`#e8ebe6`), a 60px warm neutral toolbar (`#f6f7f4`), and a white content canvas establish separate workspace surfaces. The desktop rail is 220px and collapses to 64px.
- Graphite text and a restrained forest/teal accent replace navy and blue. Category metadata is neutral; gold is reserved for favorites and amber for simulated execution disclosure.
- `src/design-tokens.css` is the source for palette, system typography, spacing scale, dimensions, radii, borders, focus, and shadows. `src/styles.css` contains the component rules and responsive compositions. Obsolete colors and appended override blocks were removed.
- The header carries company context and one concise demo disclosure instead of repeating the page title. Search, notifications, and the compact profile control form a single aligned group.
- The overview uses a flat summary strip, frequent reports, recent reports, and category links. The promotional sidebar card and redundant shortcut section are removed.
- Catalog controls occupy compact rows directly on the canvas. Tables use title-case headings, aligned durations, clear report names, understated metadata, monochrome document icons, and quiet row dividers. The existing mobile cards and grid remain functional.
- Settings, help, history, popovers, parameter forms, and the report inspector use the same surfaces, control sizes, accent, and focus treatment. Shadows are reserved for overlays.

## Verification

Browser inspection compared the baseline and redesigned catalog at the same viewport. Computed sidebar color changed from `rgb(20, 37, 61)` to `rgb(232, 235, 230)`; toolbar color changed from white to `rgb(246, 247, 244)` and height changed from 73px to 60px. The catalog displays substantially more rows in the same viewport after removal of repeated banners and nested containers.

The palette gives secondary text at least 4.5:1 contrast against the toolbar and content surfaces; focus and active navigation retain distinct contrast. Disabled controls are intentionally subdued. All pages and the desktop/collapsed/mobile navigation are reviewed in the browser. Existing tests, strict TypeScript, and the production build remain the functional verification baseline. This is not a complete cross-browser or screen-reader certification.
