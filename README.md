# Figma Validator

A local-first QA and developer workbench for validating any localhost screen against its official Figma design reference.

## Key Features

- **Figma is always the reference**: compare layout, typography, spacing, colors (CIEDE2000), radii, borders, shadows, text copy, and pixels against the Figma frame.
- **Three validation modes**:
  - **Offline (No AI, No API keys)**: drop or paste a Figma PNG/SVG export (with optional CSS Spec JSON), point to your localhost URL (via built-in localhost proxy or Browser Console snippet) or drop a screen screenshot, and run full visual + CSS checks locally.
  - **Figma REST API (Online, No AI)**: enter a Figma frame URL and Personal Access Token to fetch the 2x frame render and auto-generate a CSS spec directly from Figma nodes.
  - **Figma MCP + AI Agent (Online)**: generate ready-to-use prompts for Claude, Codex, or Gemini / Antigravity with Figma MCP connected so the agent inspects design tokens, validates live hover/focus states, and posts visual reports here.
- **Visual inspection views**: Side by Side (with synchronized scrolling), Overlay (opacity slider + difference blend mode), interactive Split slider, and Pixel Diff (perceptual YIQ tolerance slider + pixel match percentage).
- **Developer productivity**: 1-click **Copy CSS fix** for failing properties, Markdown and JSON report exports, keyboard navigation (`↑`/`↓` or `j`/`k`, `Esc`), and an **EN / PT** interface language toggle.
- **Assertiveness benchmark**: plant controlled CSS and text mutations into captured pages to measure validator detection accuracy and false-alarm rates.

## Quick validation (no AI)

On the **Validate** page, paste the Figma frame link and the screen address, then click **Validate**. The app:

1. fetches the frame from the Figma REST API (image + auto-generated spec) using your Personal Access Token, saved in the browser;
2. opens the screen in its own background Chrome (the installed Google Chrome, driven over the DevTools protocol, no Playwright);
3. waits for the network and the DOM to settle, measures it with the same engine, takes a screenshot and opens the side-by-side report.

If the screen needs a login or something stored in the browser (a role, a feature flag), click **Open the app's Chrome**, set it up in that window once, then click **Validate**. The window closes by itself and the profile (`.chrome-profile`, git-ignored) keeps the session. Set `CHROME_PATH` if Chrome is not in the default location.

The auto-generated spec checks text styles (font, size, weight, line height, color, alignment and the copy itself) and, with **Also check boxes**, the boxes that draw something (size when fixed in Figma, background, border, radius and shadow). How it finds each element without hand-written selectors:

- texts are matched by their exact copy; the engine first estimates how far the screen is shifted from the frame (for example, when the Figma frame includes the host shell and the local screen does not) and then picks the occurrence in the expected place;
- if the exact copy is not there but a similar text is in the same place, that element is used and the copy difference is reported (for example "Last Update" vs "Last Updated");
- Figma texts that are nowhere on the screen are warnings, since they are often sample data; repeated texts with the same style (table rows) are checked three times at most;
- boxes are matched by position (top-left corner within 24 px and at least 60% overlap), preferring the element that paints the background or border, and then **confirmed by their content** before any style is compared:
  - *content*: the Figma texts inside the box are inside the screen element (texts that differ only in numbers count);
  - *layout*: the texts are sample data, but they sit in the same places inside the box (start, end or center, and first-line center), allowing one shift for the whole content so a wrong padding is still reported;
  - if the Figma texts are elsewhere on the screen, or neither check passes, the box is a warning ("other content / other state") and its style is not compared, so a pagination bar is never compared with a table row, nor a card with an empty state;
  - one screen element belongs to one Figma box only (nested Figma layers of the same size can share it), so a single badge is never counted three times;
  - when Figma paints the box but the matched element is a transparent wrapper, the painted child at the same corner is used;
  - each region of the report says how it was confirmed (`matchedBy`: text, content, label, layout or shape);
- colors with transparency (backgrounds, borders and text) are compared as they look over the background behind them; radii in % are converted, and any radius from half the height up counts as fully rounded;
- copy that differs only in numbers (counters, dates, amounts) is a warning, since it is sample data; uppercase applied by `text-transform` counts as the same text when Figma asks for the same transform;
- a badge, chip or button that shows another label on screen is another state, so it becomes a warning instead of a style comparison;
- similar-text matching only applies to texts of 8+ characters, so short sample values ("Male" vs "Female") are not compared.

**Extra elements on screen (screen → Figma).** The engine also lists controls that are on screen but not in the Figma frame: a button, filter, tab or link with a short label (up to 4 words, no numbers) that does not exist anywhere in Figma, sitting where Figma has nothing (position pairing is one-to-one and by type, using the offsets of nearby matched texts and boxes). It is an error only when that line on screen has more items of the same kind than Figma. Loose text, images and cards that may not exist in Figma become warnings ("possibly not in the Figma frame"). Extra table/list rows, items that repeat a list (same tag and class as their siblings), @mentions, #tags, emails, links, avatar initials and anything outside the area of the frame are not reported (they are sample data or page context); inside a box shown in another state the finding is a warning.

**Lists are matched by order.** Sibling layers with the same name stem in Figma (`Row 1`, `Row 2`…; default names like `Frame 12` only inside an auto-layout) form a list, ordered by position on the canvas. On screen the rows are the siblings with the same tag and class, also ordered by position. A row confirmed by its own copy (label, or most of its texts) keeps its match; the other rows are matched by the row offset most matched rows agree on, so one taller or highlighted row no longer shifts all the others. To see two planted extras, open **Validate**, choose **Offline (with images)**, open the spec JSON section, click **Load demo spec** (it carries the positions of every text in the demo frame, `figmaLeaves`), set the localhost URL to `http://localhost:5199/demo/sample-screen?extra=1` and click **Compare Now**: the report lists "Export JSON" and "Only delayed" as not in Figma, and nothing else. A hand-written spec with `figmaLeaves` also gets this check.

The **What it does** page (`/capabilities`) sums up what each mode (quick validation, offline, API + spec, Figma MCP + AI) does and does not do.

**Right and bottom padding** are measured only where Figma defines where the content ends (a Hug box, a space-between or end-aligned auto-layout) and the last content ends at a fixed place (icon, image, auto-width or right-aligned text); bottom is compared by the center of the last line. A difference over 40 px is a warning (missing content or another state), not an error. Loose text, images or cards that may not exist in Figma are listed as warnings ("possibly not in the Figma frame"), never as errors.

**Terminal (agents without a browser).** The skill ships `bin/validar.mjs` (source: `scripts/skill-cli.mjs`, copied by `npm run sync-skill`): `node ~/.agents/skills/validar-figma/bin/validar.mjs --url <screen> --spec <spec.json> [--send]` opens a headless Chrome, injects the same validator and writes `report.md`, `report.json` and `screen.png`; `--login --url <screen>` opens a visible window once for SSO. It needs Node 22+ and Chrome/Chromium/Edge, and no Figma token (the agent reads Figma through the MCP).

**Accuracy & assertiveness testing.** Use the **Benchmark** (`/benchmark`) page to capture the built-in demo (`/demo/sample-screen`) or any localhost screen, generate deterministic CSS/text mutations against a baseline, and measure precision and false-alarm rates; the measured summary is on the **What it does** page (`/capabilities`).

**Spacing (padding and gap) is compared as it looks, not as CSS.** The code can build the same space with padding, margin, gap or an extra wrapper, so the engine measures distances on screen and in Figma the same way:

- *padding*: from the box edge to its first content (text, icon, image, field), top and left; the top is compared by the center of the first line, so a different line height is not counted twice; left padding is only measured when the Figma auto-layout starts at the left;
- *gap*: between neighbours (one below or beside the other) inside the same block, only where the Figma auto-layout defines a fixed gap (not space-between), only when nothing sits between them in Figma or on screen (so sample data never leaks in), and only when the order is the same on screen;
- text boxes use the Figma line height around the line centers, and dividers, backgrounds and designer annotations (purple #9747FF, "Redline", "Dot ·") are ignored;
- each box is matched using its own first text as anchor, so a block that moved still matches the right box.

**API access.** Only the routes the skill calls from inside the measured screen accept other origins (`/validator.js`, `/capture.js`, `GET /api/health`, `POST /api/reports`, the session and benchmark capture/result routes). Listing, reading or deleting reports, opening screens in the app's Chrome, the proxy and the Figma routes answer only the app itself (or requests without an `Origin`, like the CLI and curl), so a website open in the browser cannot read screenshots or act with the user's login.

**Visible vs CSS-only.** Every error is also tagged as *visible* or *CSS-only* (`visibility` in the report, `failVisible` / `failCss` in the summary). CSS-only means a real difference in the code that cannot be seen on screen: color ΔE under 3 (with less than 0.15 of alpha difference), under 4 px of padding, gap, size, line height or radius, under 1 px of font size, under 0.5 px of letter spacing, or a border width change that keeps the border visible. Font family, weight, text and alignment are always visible, and anything the rule does not know counts as visible. The thresholds were calibrated on 804 errors from 22 real screens judged side by side with Figma: below them 6 of 249 were seen, above them most were. The report opens on **Visible** (with the CSS-only count one click away), `report.md` lists CSS-only errors in their own section, and the CLI prints them as a count. Strictness does not change: CSS-only errors are still errors.

**Strictness is always 100% (Exact)** in the app, the API, the skill and the engine (any `precision` in a request or spec is ignored): only invisible rounding is accepted (0.1 px, ΔE 0.5, whole device pixels for borders, 1 px for spacing measured through text).

The screen always opens at the exact Figma frame size (width and height) and the screenshot has that size too. Reports measured at another size (console capture, agent) show a warning at the top. Downloads from Figma are retried up to three times on network errors.

## Run Locally

```sh
npm install
npm run dev
```

Open `http://localhost:5199`.

## Architecture

| Path | Purpose |
|---|---|
| `src/engine/` | Self-contained CSS comparison (`compare.ts`), DOM runner (`runner.ts`), snapshot script (`capture.ts`), and Figma parser (`figmaParser.ts`) |
| `src/utils/` | Perceptual pixel diff (`pixelDiff.ts`), CSS fix generator (`cssFix.ts`), typed fetch helper (`api.ts`) |
| `src/i18n/` | English (`en.ts`) and Portuguese (`pt.ts`) UI translations + `I18nProvider` |
| `src/pages/` | `ValidatePage`, `ReportsPage`, `ReportDetailPage`, `BenchmarkPage`, `GuidePage` |
| `src/benchmark/` | Deterministic mutation generator and scoring engine |
| `src/demo/` | Built-in demo screen (`/demo/sample-screen`) and Figma SVG reference |
| `server/` | Vite middleware serving `/validator.js`, `/capture.js`, `/api/proxy`, `/api/figma/fetch`, `/api/reports`, `/api/sessions`, `/api/validate/run`, `/api/browser/login` and `/api/benchmark/*` |

## Agent skill sync

The `validar-figma` agent skill (used by Claude Code, Codex and Gemini/Antigravity, in `~/.agents/skills/validar-figma`) ships the same browser scripts as this app. After changing anything in `src/engine/`, regenerate them:

```sh
npm run sync-skill
```

It writes `browser/validator.js` and `browser/capture.js` into the skill folder (override with `VALIDAR_FIGMA_SKILL=/path/to/skill`).

## Tests & Checks

```sh
npm test
npm run lint
npm run build
```
