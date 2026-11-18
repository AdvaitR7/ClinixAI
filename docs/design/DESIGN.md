---
name: CliniX AI
description: Privacy-first personal health record and clinical workflow platform for patients, doctors and clinic staff.
colors:
  mist-canvas: "#f2f6f6"
  paper-surface: "#ffffff"
  deep-tide-ink: "#172b30"
  slate-secondary: "#566c73"
  jade-action: "#075f56"
  seafoam-selection: "#d6eee8"
  frost-divider: "#dce5e6"
  clinical-red: "#b13839"
  review-amber: "#865411"
  harbour-blue: "#315b85"
  review-tint: "#f8ecd4"
  urgent-tint: "#f8e1e1"
  info-tint: "#dde9f4"
  wash-top: "#e6f0f2"
  wash-sky: "#8fb4d0db"
  wash-mint: "#91cac1db"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.125rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.19
    letterSpacing: "-0.02em"
  headline-compact:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: 1.2
  headline-dense:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.4
  body-large:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.54
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.33
    letterSpacing: "0.08em"
  dock:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: "15px"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    fontFeature: "tnum"
rounded:
  status: "12px"
  field: "16px"
  button: "18px"
  card: "20px"
  control: "22px"
  dock: "28px"
  pill: "9999px"
spacing:
  gutter: "24px"
  section: "24px"
  dock-gap: "16px"
  dock-clearance: "6.5rem"
  focused-column: "430px"
  wide-container: "87.5rem"
components:
  button-primary:
    backgroundColor: "{colors.jade-action}"
    textColor: "{colors.paper-surface}"
    typography: "{typography.body}"
    rounded: "{rounded.button}"
    padding: "0 20px"
    height: "54px"
  button-secondary:
    backgroundColor: "{colors.paper-surface}"
    textColor: "{colors.jade-action}"
    rounded: "{rounded.button}"
    padding: "0 20px"
    height: "54px"
  button-danger:
    backgroundColor: "{colors.paper-surface}"
    textColor: "{colors.clinical-red}"
    rounded: "{rounded.button}"
    padding: "0 20px"
    height: "54px"
  field:
    backgroundColor: "{colors.paper-surface}"
    textColor: "{colors.deep-tide-ink}"
    rounded: "{rounded.field}"
    padding: "14px 16px"
    height: "54px"
  card:
    backgroundColor: "{colors.paper-surface}"
    textColor: "{colors.deep-tide-ink}"
    rounded: "{rounded.card}"
    padding: "16px"
  status-positive:
    backgroundColor: "{colors.seafoam-selection}"
    textColor: "{colors.jade-action}"
    rounded: "{rounded.status}"
    padding: "2px 10px"
  status-review:
    backgroundColor: "{colors.review-tint}"
    textColor: "{colors.review-amber}"
    rounded: "{rounded.status}"
    padding: "2px 10px"
  status-urgent:
    backgroundColor: "{colors.urgent-tint}"
    textColor: "{colors.clinical-red}"
    rounded: "{rounded.status}"
    padding: "2px 10px"
  status-info:
    backgroundColor: "{colors.info-tint}"
    textColor: "{colors.harbour-blue}"
    rounded: "{rounded.status}"
    padding: "2px 10px"
  dock:
    rounded: "{rounded.dock}"
    padding: "6px"
    width: "398px"
  dock-item-active:
    backgroundColor: "{colors.seafoam-selection}"
    textColor: "{colors.jade-action}"
    typography: "{typography.dock}"
    rounded: "{rounded.control}"
    height: "58px"
---

# Design System: CliniX AI

<!-- Source of truth for visuals: the shipped Clear v2 system (apps/web/src/app/globals.css, FigCraft "ClinixAI v2" Clear collection 3). Supersedes the retired Plus Jakarta Sans / Warm Alabaster / Copper system. Clinical provenance, draft-first, privacy and role rules below are unchanged from the previous version. -->

## Overview

**Creative North Star: "The Clear Window"**

CliniX looks through glass at paper. A cool, mist-coloured canvas carries a soft wash of sky and mint behind each screen's opening, and the controls you use to find your way (header buttons, the bottom dock, filter capsules, segmented tabs) float above it as frosted glass. Everything you *read and decide on* (clinical facts, consent, audit entries, confirmations, forms) sits on opaque white paper with a hairline frost border. The split is the point: glass means "navigate", paper means "this is the record".

The product is calm, credible and precise. Density is daily-app dense: clinical lists, schedules and evidence are compact and scannable, grouped by whitespace and hairlines rather than stacked cards. Patient screens breathe a little more; doctor and staff workspaces are denser. One jade action colour marks what to press; three semantic colours (review amber, clinical red, harbour blue) mark state and nothing else.

CliniX is not a chatbot, a wellness app or a hospital ERP. Provenance, patient control and the separation between factual record and AI assistance must be obvious at a glance.

**Key Characteristics:**
- Mist canvas with a top-of-screen sky and mint wash; white paper for every reading surface.
- Frosted glass only for wayfinding controls; never for clinical content.
- A single jade action colour; amber, red and blue are state, not decoration.
- Inter throughout, with JetBrains Mono tabular figures for dense numbers.
- A floating glass dock pinned to the bottom of every signed-in screen.

## Colors

A cool, low-chroma teal-grey palette with one jade accent and three semantic state colours.

### Primary
- **Jade Action** (`jade-action`): primary buttons, the selected date, selected segmented tab, active links and the current dock item's text. It signals "press this" or "you are here", so it never fills large areas or decorates.

### Neutral
- **Mist Canvas** (`mist-canvas`): the app background on every screen, including `html`, the PWA theme colour and disabled field fill.
- **Paper Surface** (`paper-surface`): cards, fields, drawers, dialogs and the opaque fallback for glass.
- **Deep Tide Ink** (`deep-tide-ink`): primary text. There is no pure black anywhere.
- **Slate Secondary** (`slate-secondary`): supporting copy, metadata, placeholders and inactive dock items.
- **Frost Divider** (`frost-divider`): every structural 1px border and row divider.
- **Seafoam Selection** (`seafoam-selection`): quiet selection, the current dock item's background, text selection and the positive status tint.

### Semantic state
- **Review Amber** (`review-amber`, tint `review-tint`): draft, uncertainty and human-review state, including every OCR, voice and AI draft until a doctor finalises it.
- **Clinical Red** (`clinical-red`, tint `urgent-tint`): urgent, destructive, safety-interrupt and dosage-ambiguity states.
- **Harbour Blue** (`harbour-blue`, tint `info-tint`): provenance, source links, verified evidence and information. It is also the focus-ring colour.

### Backdrop wash
- **Wash Top, Wash Sky, Wash Mint** (`wash-top`, `wash-sky`, `wash-mint`): only inside the workspace shell's 450px decorative backdrop (a top-down gradient into the canvas plus two blurred radial pools). Never on text, controls or content.

### Named Rules
**The One Action Colour Rule.** Jade is the only accent. If something is jade, it is pressable or current; nothing else may be jade.

**The State Is Not Decoration Rule.** Amber, red and blue appear only where they explain a state, always with a text label beside them.

## Typography

**Display and body font:** Inter (`--font-inter`, falling back to `ui-sans-serif, system-ui`)
**Mono font:** JetBrains Mono (`--font-jbmono`)

**Character:** one neutral, highly legible sans for everything, so hierarchy comes from weight, size and tone rather than font contrast. Mono appears only where aligned digits help comparison.

### Hierarchy
- **Display** (700, 34px, 1.15, -0.02em): titles on full-width auth, onboarding, settings and notifications screens.
- **Headline** (700, 32px, 1.19, -0.02em): the workspace screen title in the screen intro. Compact screens use 30px (`headline-compact`) and dense doctor and staff screens 28px (`headline-dense`).
- **Title** (600, 22px): section headings inside a screen, such as "Later on this date".
- **Body** (400, 15px, 1.4): orientation lines and general copy, at most 65ch per block. Patient-facing instructions may use 16px (`body-large`).
- **Caption** (400, 13px): metadata lines, timestamps in prose and secondary detail under a title.
- **Label** (700, 12px, 0.08em, uppercase): eyebrows and short category labels above titles and sections.
- **Dock** (500, 11px, 15px line): dock item labels under their icons.
- **Mono** (400, 12px, tabular figures): timestamps, identifiers, dosage notation and numeric columns in dense tables.

### Named Rules
**The 12px Floor Rule.** Essential clinical, consent and status text is never smaller than 12px. Only dock labels go to 11px, and they always sit beside an icon.

**The 16px Field Rule.** Editable text is at least 16px so mobile browsers never zoom on focus.

## Layout

Mobile-first, single-column by default, built on a 24px side gutter (`gutter`).

- **Containers:** focused task and patient screens use a centred 430px column (`focused-column`). Wider operational screens use up to 1400px (`wide-container`). Most current screens are focused.
- **Screen intro:** an eyebrow label, then the title, then one sentence of orientation, all left-aligned, followed directly by the most important status or task. No hero imagery, no centred titles.
- **Vertical rhythm:** sections are separated by 24px (`section`); dense lists use 1px frost dividers, not extra cards.
- **The dock:** fixed to the viewport at `max(16px, safe-area-inset-bottom)` from the bottom (`dock-gap`), 16px from each side, at most 398px wide and centred, at every breakpoint. All scrolling content reserves `calc(6.5rem + safe-area-inset-bottom)` (`dock-clearance`, the `DOCK_CLEARANCE` constant) so the last control always clears it.
- **Full height:** `min-height: 100dvh`, never `100vh` or fixed artboard heights. `viewport-fit=cover` and safe-area insets are respected top and bottom.
- **Breakpoints:** below 768px every multi-column layout collapses to one column. Tables become labelled rows or contained scroll regions; the page never scrolls sideways (checked at 320, 393, 430, 768 and 1440px).

### Role-specific layout
- **Patient:** calm single-column flow, a clear next action, expandable evidence and visible privacy scope.
- **Doctor:** denser workspace with the patient record and AI assistance clearly separated; review queues put unresolved or ambiguous items first.
- **Clinic staff:** operational density limited by role. Reception and assistant views never expose unrelated clinical detail.

### Named Rules
**The Pinned Dock Rule.** The dock is `position: fixed` on every screen that has one. Never make it `relative` or `sticky` (it scrolls away on long pages and floats mid-screen on short ones), and never put `transform`, `filter` or `will-change` on an ancestor, which would detach it from the viewport.

## Elevation & Depth

Depth is a two-material system: flat opaque paper and lifted frosted glass. Paper surfaces have no shadow, only a 1px frost border. Glass surfaces carry the only shadow in the system plus an inner top highlight, and blur what is behind them.

### Shadow Vocabulary
- **Glass lift** (`box-shadow: inset 0 1px 1.5px rgb(255 255 255 / 85%), 0 7px 19px -8px rgb(36 79 96 / 19%)`): glass controls and the dock, with `backdrop-filter: blur(12px)`, a 24% white fill and an 85% white edge.
- **Dialog** (Tailwind `shadow-xl` / `shadow-2xl`): native dialogs, drawers and the account menu, which float above content.

### Named Rules
**The Glass For Wayfinding Rule.** Glass is for optical controls only: header buttons, the dock, filter and search capsules, segmented tabs and record navigation. Reading, form, consent, audit and confirmation surfaces are always opaque paper.

**The Opaque Fallback Rule.** Where `backdrop-filter` is unsupported, glass becomes Paper Surface with a frost border; a 24% fill without blur is unreadable.

## Shapes

Soft, generous rounding that grows with the size of the surface: status chips 12px, fields 16px, buttons 18px, cards 20px, glass controls and dock items 22px, the dock 28px, and circular 44px account and notification controls. Borders are always a single 1px frost line; no double borders and no heavy outlines. Pills are reserved for short filter and segmented options.

## Components

### Buttons
Confident and quiet: solid jade for the one primary action, paper for everything else.
- **Shape:** gently rounded (18px), 54px tall for primary actions and at least 44px for any control.
- **Primary:** Jade Action fill, white 15px semibold text, 20px horizontal padding.
- **Hover / Press:** fill darkens 12% over 120ms; press moves the button down 1px over 80ms. No glow, bounce or scale.
- **Secondary:** paper fill, frost border, jade text. **Danger:** paper fill, red border and red text, always with an explicit verb.
- **Disabled:** 55% opacity with a not-allowed cursor; never hidden.
- One dominant action per local decision area.

### Status chips
- **Style:** 12px semibold text on a matching tint, 12px radius, 2px by 10px padding; positive (seafoam and jade), review (amber), urgent (red), info (blue), neutral (canvas and slate).
- **Rule:** the label text always renders and never breaks mid-word; colour is never the only signal.

### Cards / Containers
- **Corner Style:** 20px.
- **Background:** Paper Surface on Mist Canvas.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1px Frost Divider.
- **Internal Padding:** 16–20px.
- Dense lists, schedules, ledgers and records use flat rows with dividers instead of repeated cards.

### Inputs / Fields
- **Style:** paper fill, 1px frost border, 16px radius, 54px minimum height, 14px by 16px padding, 16px text. The label sits above the field; never use floating labels.
- **Focus:** the border turns jade, plus the global 3px Harbour Blue focus ring offset 3px.
- **Error:** red border with `aria-invalid` and error text directly below the field. Never report a form error by toast alone.
- **Disabled:** canvas fill with slate text.
- Medication dose, route, frequency, timing and duration are separate structured fields; structured patient choices keep a free-text "Something else…" path.

### Navigation
- **Dock:** a frosted glass bar (28px radius, 6px padding) holding 4–6 destinations, each a 58px-tall column with a 20px stroke icon and an 11px label. The current item has a Seafoam Selection pill (22px radius) and jade text; others are slate and darken to ink on hover. Labels wrap only at spaces, hyphenating if needed.
- **Destinations by role:** patient Home, Timeline, Vault, Visits, Care, You (some screens swap in Reports or Medications); doctor Desk, Schedule, Patients, Drafts, Follow-ups (`doctorNav()`); staff Home, Schedule, Patients or Intake (assistant), Follow-ups.
- **Coverage:** every signed-in workspace screen, plus Notifications and Settings through `RoleDock`. Focused flows with their own Exit (check-in) and the compact doctor record omit it.
- **Header:** brand at left; a notification bell and an account control as 44px glass circles at right. The account menu offers settings, install, change password and sign out, each at least 44px tall.
- Role switching is explicit and never implies that clinic access changes a person's patient identity.

### Status, provenance and AI boundaries
- Every clinically meaningful item shows its origin when relevant: **Doctor-authored**, **AI-derived**, **Patient-asserted** or **Source document**.
- Factual patient record and AI assistance occupy visibly separate containers or columns. AI output never visually impersonates an authoritative record.
- Draft OCR, voice and AI output always shows a Review Amber draft state until a doctor explicitly finalises it.
- Consent and access controls state scope, duration and affected records in plain language.

### Safety, errors, loading and empty states
- Safety interruptions use Clinical Red sparingly, direct language and a single unambiguous next action, and stop the normal AI flow while active.
- Inline errors say what failed and how to fix it, with a retry where one exists.
- Loading uses skeletons matching the incoming rows or panels, never a circular spinner.
- Empty states explain what belongs there and offer the relevant action.
- Confirmation dialogs summarise the consequence before prescription finalisation, consent changes and record removal.

### Motion
Motion confirms state and never decorates. Animate only `transform` and `opacity`, keep transitions at 80–200ms ease-out, and remove nonessential translation, shimmer and stagger under `prefers-reduced-motion`. Never animate safety text, medication values, dosage ambiguity or finalised clinical records.

## Do's and Don'ts

### Do:
- **Do** put clinical facts, consent, audit and confirmations on opaque Paper Surface cards with a 1px frost border.
- **Do** use Jade Action for the single primary action in each decision area.
- **Do** keep every interactive target at least 44 by 44px, and editable text at least 16px.
- **Do** keep the dock fixed with `DOCK_CLEARANCE` on scrolling content, and build dock lists from the shared helpers (`doctorNav()`, `dockForMe()`) rather than copying arrays.
- **Do** show provenance labels and Review Amber draft state on every AI, OCR and voice output until a doctor finalises it.
- **Do** pair every status colour with readable text.
- **Do** use tokens (`clear-*` utilities or `var(--color-clear-*)`) rather than hex literals in components.

### Don't:
- **Don't** use glass for reading, form, consent or confirmation surfaces.
- **Don't** use the wash colours outside the workspace backdrop, or make text or controls translucent over it.
- **Don't** use pure black, purple, neon, gradient text, outer glows or coloured shadows.
- **Don't** centre screen titles, use hero imagery in clinical workflows, or build three equal cards in a row.
- **Don't** overlap text, controls, drawers or floating elements; nothing may hide content behind the dock.
- **Don't** use emojis, custom cursors, "Scroll to explore" filler or decorative chevrons.
- **Don't** fabricate metrics, percentages, patient counts or performance claims; use clearly marked placeholders.
- **Don't** use generic placeholder names ("John Doe", "Acme"); use synthetic fixtures that are clearly marked.
- **Don't** render a chatbot transcript as the primary patient interaction; use structured questions, choices, forms, timelines and evidence panels.
- **Don't** silently convert AI inference into factual history, or auto-finalise OCR, voice or AI prescription content.
- **Don't** blur patient-controlled vault data with doctor-owned professional records, or give clinic staff unrestricted clinical views.
