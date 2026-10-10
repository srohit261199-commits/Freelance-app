# Handoff: Freelance Hub v2 UI redesign

## Overview
A full visual redesign of **Freelance Hub**, the Electron + React Windows app in `srohit261199-commits/Freelance-app` (branch `claude/optimistic-shannon-e9mnkj`). The app's logic stays as it is: `src/shared/*` (planner, status, money, mail, ingest), `src/main/*`, and the store. Only the renderer UI changes: `src/renderer/App.tsx`, `src/renderer/ui.tsx`, `src/renderer/styles.css`, and `src/renderer/views/*.tsx`.

## About the design files
`Freelance Hub v2.dc.html` is a **design reference built in HTML**. It's a clickable prototype that shows the intended look and behaviour; it isn't production code. Recreate it in the existing renderer with React + TypeScript, using the repo's current patterns: the `hub` IPC bridge, `useAppState`, `AppCtx`, and the `Icon` component (or switch `Icon` to Phosphor; see Assets). Wire every screen to real `AppState` data instead of the sample arrays in the prototype's logic class.

To view it, open `Freelance Hub v2.dc.html` in a browser. `support.js` must sit next to it. Every sidebar item works, and the Dashboard has a Widgets / Board switch.

## Fidelity
**High fidelity.** Colours, type, radii, spacing and copy are final. Match them closely.

## Mapping to the repo
| Prototype screen | Repo view to restyle | Data source |
|---|---|---|
| Dashboard: Widgets | `views/Today.tsx` | `nextActions()` in `shared/planner.ts`, meetings, `companyEarnings()` |
| Dashboard: Board | new view, or a mode of `Today.tsx` | `state.models` + `skeidarJobs` grouped by `ModelStatus` |
| MetaZtech | `views/Models.tsx` (company=metaztech) | `state.models`, `COMPLEXITY_LABELS`, `statusLabel()` |
| Waveink | `views/Models.tsx` (company=waveink) | `state.models`, `setStatus()` |
| Skeidar | `views/Skeidar.tsx` | `SkeidarJob.done` map `${fabric}:${image}` |
| Payments | `views/Earnings.tsx` | `state.payments`, `companyEarnings()` |
| Subscriptions | `views/Subscriptions.tsx` | `state.subscriptions`, `rollRenewal()` |
| Mail scan | `views/Inbox.tsx` (suggestions part) | `state.suggestions`, `handledEmails` |
| Settings & import | `views/Settings.tsx` + `views/PortalImport.tsx` | `settings`, `portalMappings`, `shared/ingest.ts` |

Portfolio isn't in the redesign. Keep it as a sidebar item under TOOLS, styled like the other screens.

## Shell
- **Window:** a frameless Electron window (`frame:false`, `titleBarStyle:'hidden'`, plus `titleBarOverlay` or custom buttons). Background `#f3f4f9`.
- **Title bar:** 44px tall and draggable (`-webkit-app-region: drag`; buttons and search are `no-drag`).
  - **Left:** a 22×22 app mark (radius 7, `#16171d`, white "FH" at 10px/800), then "Freelance Hub" at 13/600, then "— {screen title}" at 13 in `#9a9daa`.
  - **Centre:** a search field, 520×32, radius 10, white, 1px ring `#e7e8ef`, placeholder "Search models, clients, mail…" with a "Ctrl K" key chip (11/600, bg `#f3f4f9`).
  - **Right:** "Synced 4 min ago" with a 7px green dot `#2fb56a`. Then the Windows caption buttons, each 46×44: minimise, maximise, and close (hover `#c42b1c` with a white glyph). The others hover `#e6e7ee`.
- **Body:** a flex row. Sidebar is 264px with padding `14px 16px 20px 20px`. Main has padding `14px 28px 24px 8px`.

### Sidebar
- **Profile card:** white, radius 18, padding 12. Avatar 44px circle with `linear-gradient(135deg,#a9c1ff,#eaa9f6)` and initials. Name 15/700, role 12 in `#6e7180`.
- **Section labels:** MENU, CLIENTS, MONEY, TOOLS at 11/700, letter-spacing .12em, `#9a9daa`.
- **Nav items:** 44px tall pill (radius 999), 14/600. Each has a 20px icon, or a 20px rounded square (radius 7) in the client colour.
  - **Badge:** pill, 22px tall, 11/700. White on a light background; `rgba(255,255,255,.18)` when active.
  - **Active item:** background `#16171d`, white text, shadow `0 8px 18px rgba(22,23,29,.22)`.
  - **Inactive item:** transparent background.
- **Bottom card:** radius 22, bg `#ece8ff`, padding 18. A 40px white icon tile, a title at 15/700, body at 13 in `#5a5e6d`, and a black pill button "Review now" (38px tall) that opens Mail scan.

## Design tokens
- **Font:** Plus Jakarta Sans (400/500/600/700/800). Bundle it locally for the exe.
- **Base colours:**
  - Ink `#16171d`
  - Text-2 `#3b3e4a`
  - Muted `#6e7180`
  - Faint `#9a9daa`
  - Hairline `#e7e8ef` / `#f0f1f5`
  - App bg `#f3f4f9`
  - Hover row `#f6f7fb`
  - Surface `#ffffff`
  - Column bg (board) `#eceef5`
- **Client colours** (main / tint / deep):
  - Waveink `#a9c1ff` / `#e8eeff` / `#2f4fb8`
  - MetaZtech `#eaa9f6` / `#f9eafc` / `#8a2aa0`
  - Skeidar `#f8ae6c` / `#feefe0` / `#a3520f`
  - Money `#9fdcb8` / `#e3f5ea` / `#1d7646`
- **Status pills** (bg / text), 26–28px tall, radius 999, 12/700:
  - To do, On hold: `#eef0f5` / `#5a5e6d`
  - In progress, Cancelling, Invoiced: `#fff4cf` / `#8a6a00`
  - Submitted, Under review, Pending: `#ece8ff` / `#5b48c2`
  - Rejected, Revision, Trial, Late: `#ffe9e5` / `#b8321f`
  - Approved, Done, Active, Paid: `#e3f5ea` / `#1d7646`
  - Live: `#e8eeff` / `#2f4fb8`
- **Priority flags** (11/800, letter-spacing .06em): URGENT `#e0402c`, HIGH `#d9730d`, NORMAL `#3a63d8`, LOW `#8a8d99`.
- **Radii:**
  - Panels 26
  - Stat tiles 24
  - Cards 20
  - List rows 16
  - Icon tiles 12–14
  - Inputs 12–14
  - Buttons and pills 999
  - Modal 28
- **Shadows:**
  - Board cards: `0 1px 2px rgba(20,22,40,.05)`
  - Modal: `0 30px 70px rgba(20,22,40,.3)`
  - Panels: none (white on `#f3f4f9`)
- **Buttons:**
  - Primary: 44px tall pill, `#16171d`, white 14/600, hover `#34363f`, 18px icon.
  - Secondary: white, ring `0 0 0 1px #e7e8ef`.
  - Small: 32–40px tall, `#f3f4f9`.
- **Spacing:** 20px between panels, 14–22px inside panels.
- **Type scale:**
  - Page title 30–32/800, letter-spacing −.02em
  - Big figures 34–36/800
  - Panel titles 18–20/800
  - Row title 14–15/600
  - Meta 12–13 in `#6e7180`

## Screens
1. **Dashboard: Widgets**
   - **Header:** "Hello, Rohit" 32/800, then the date, the task count and a red warning chip. On the right: the Widgets/Board segmented pill (white container, 4px padding, active item black), "Import sheet" (secondary) and "Add task" (primary).
   - **Row 1:** 4 tiles, 184px tall, radius 26, each filled with a client's main colour (money is green). Each tile has a 38px white icon circle, the name, an arrow circle, a 36/800 figure, a sub line, and a 6px progress bar (track `rgba(255,255,255,.6)`, fill `#16171d`). Clicking a tile opens that client.
   - **Row 2:** a grid of `1fr 420px 400px`.
     - **Up next panel:** the `nextActions()` list, filterable by client pills. Each row is a grid of 26 / 42 / 1fr / 92 / 84 / 20: checkbox (24px, radius 8; done = black fill), client icon tile (tint bg, deep icon), title and detail, due chip (Today red, this week yellow, queue grey), value, chevron. Done rows drop to 45% opacity with a strikethrough. The list scrolls.
     - **Middle column:** an October calendar (Monday first, 40px day circles). Today is black. The MetaZtech payout window (3rd–10th) is a pink band. Meetings and reports are blue, trial ends are red, payday is green. Below it, a "This week" list of meetings with Join buttons.
     - **Right column:** Earnings, with stacked monthly bars in client colours; hatched segments are earned but not paid. Below it, "Renewing soon".
2. **Dashboard: Board.** 5 columns: To do, In progress, In review, Rejected, Done. Each column has a pastel pill header with a count, and its cards are white with radius 20. A card shows the client dot and code, a 16/700 title, a priority flag, and a footer with the date and meta. Client filter pills sit above the columns. Drag-and-drop should call `setStatus()`.
3. **MetaZtech**
   - **Header:** a 64px client tile (radius 22) and chips for the pay rules. Buttons: Open CMS, Paste a table, Pull from portal.
   - **Status tabs:** pills with count badges.
   - **Table:** inside a white panel. Rejected rows get bg `#fff7f5`, and their action button is black "Fix now".
   - **Right column:**
     - a daily target ring (conic-gradient)
     - "From Teams" chat bubbles
     - fee tiers
4. **Waveink:** the catalog list on the left; selecting a row highlights it in `#e8eeff` with a 1.5px `#a9c1ff` inset ring. The detail panel on the right (620px) has:
   - a status pill row to set the status
   - a full-width black "Mark done" button
   - placeholders for the source photo and GLB preview
   - a field grid
   - the history timeline
5. **Skeidar:** a hero card in `#feefe0` with a progress ring and the earned / still-to-make figures. Below it, a variations grid: 2 master images × N fabrics, tiles 96×96 at radius 20. Not done = `#f6f7fb` with a 2px dashed `#d5d7e0` border and a plus. Done = the fabric's colour with a white check badge. Clicking a tile toggles `done[`${f}:${i}`]`. Past jobs sit in a row underneath.
6. **Payments:** 4 pastel stat tiles (Received, Earned not paid, Late, Best month). A monthly stacked bar chart, a by-client panel, and a transactions table with status pills and the source (mail, rule, or added by hand).
7. **Subscriptions:** 4 stat tiles. A table with a letter tile per app, a status pill, cycle, amount, ₹ per month, next renewal (with days left, red when a trial is ending) and where it was found. A "Next 30 days" date list on the right. "Add manually" opens a modal (560px wide, radius 28) with Name, Amount, Currency, Billed (pills), Next renewal, Remind me and Status.
8. **Mail scan:** a lavender summary banner. "To review" cards, each with "Add subscription" / "Record payment" / "Track as one-off" plus Ignore. Accepting shows a green "Added…" state; ignoring removes the card. On the right, an "Already matched" list and the senders it watches.
9. **Settings & import:**
   - **Left:** a dashed dropzone with a client picker, the last import, a column-mapping table (selects), and other imports.
   - **Right:** cards for Google account (with sync interval pills), Money (rates), Folders, and App (46×26 pill toggles).

## Interactions and state
- **App level:** `route`; Dashboard `layout` (`'widgets'|'board'`), which should be persisted in settings; `filter` (`all|waveink|metaztech|skeidar|money`).
- **Each screen:** the MetaZtech tab, the Waveink selected model id, the Subscriptions `showAdd` modal.
- **Checking a task:** calls the matching action. For model rows that's `setStatus(model,'done')`; for payments, it opens the record-payment form.
- **Transitions:** none in the prototype. Suggested: 150ms ease on background and colour for hover; the modal fades and scales from 0.98.

## Assets
- **Icons:** Phosphor (`@phosphor-icons/react`), Regular for UI and Fill for icon tiles and badges.
- **Images:** none. Photo and GLB previews are placeholders (diagonal stripes); show real thumbnails from Drive or the Skeidar folder when they exist.

## Files
- `Freelance Hub v2.dc.html`: the prototype. Its logic class holds sample data and state.
- `support.js`: the runtime needed to open the prototype in a browser.
- `screenshots/`: 1920×1080 reference captures. Match these pixel for pixel:
  - `01-dashboard-widgets.png`
  - `02-dashboard-board.png`
  - `03-waveink.png`
  - `04-metaztech.png`
  - `05-skeidar.png`
  - `06-payments.png`
  - `07-subscriptions.png`
  - `08-subscriptions-add-modal.png`
  - `09-mail-scan.png`
  - `10-settings-import.png`

## Suggested build order
1. Tokens in `styles.css`, the font, Phosphor icons.
2. Frameless window, title bar and sidebar (`App.tsx`).
3. Dashboard (Widgets, then Board).
4. Client screens: Waveink, MetaZtech, Skeidar.
5. Payments, Subscriptions, Mail scan, Settings.

Run `npm test` after each step. The logic tests in `tests/logic.test.ts` must keep passing, because the redesign doesn't change any logic.
