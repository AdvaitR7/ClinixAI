# Design System: CliniX AI

> Stitch source of truth for patient, doctor, and clinic-staff screens. Preserve this visual language across every generated screen. CliniX is a privacy-first personal health record and clinical workflow platform—not a chatbot, generic wellness app, or hospital ERP.

## 1. Visual Theme & Atmosphere

CliniX feels like **warm clinical paper with quiet botanical authority**: trustworthy without becoming sterile, human without becoming playful, and information-dense without feeling administrative. Imagine a carefully organized specialist’s notebook translated into a modern mobile clinical workspace.

- **Density: 7/10 — Daily App Dense.** Clinical records, schedules, evidence, and review queues should be compact and scannable. Use strong grouping, short labels, and deliberate whitespace rather than oversized type or excessive cards.
- **Variance: 6/10 — Structured Asymmetry.** Prefer offset summaries, split information bands, stacked records, and uneven content emphasis. Do not use centered marketing compositions or repetitive equal-card grids.
- **Motion: 4/10 — Restrained Fluidity.** Motion confirms state, hierarchy, and progress. It never decorates serious clinical information or competes with safety messages.
- **Tone:** calm, credible, warm, precise, consent-aware, evidence-led.
- **Visual priorities:** provenance, patient control, factual-record versus AI-assistance separation, review state, and safety escalation must be obvious at a glance.
- **Surface philosophy:** Warm Alabaster canvas, Paper surfaces, Botanical anchors, and a single Copper accent. Depth stays whisper-soft. Use borders and negative space before adding elevation.
- **No overlapping elements.** Every label, control, image, drawer, and panel occupies a clean spatial zone.

### Screen-opening composition

This is a clinical application, so use a **screen intro**, not a marketing hero. Begin with a left-aligned eyebrow, a concise title, and one sentence of orientation when needed. Follow with the most important status, task, or record—not decorative imagery.

- Keep titles controlled at `30–32px`; hierarchy comes from weight, contrast, and spacing.
- Patient screens may feel calmer and more spacious; doctor and staff workspaces may be denser.
- Use at most one primary action in the opening region.
- Never center the screen title or place it over imagery.
- Do not use inline headline photography in clinical workflows; it would reduce clarity and trust.
- Never add “Scroll to explore,” chevrons, decorative statistics, or promotional copy.

## 2. Color Palette & Roles

Use one warm-neutral palette across all roles. **Warm Copper is the only accent color.** Evidence Blue, Review Amber, and Critical Red are semantic state colors, not decorative alternatives.

- **Warm Alabaster Canvas** (`#F7F2E9`) — Default application background and page wash.
- **Warm Paper Surface** (`#FFFDFC`) — Cards, sheets, inputs, drawers, and primary light surfaces. Prefer this over pure white.
- **Deep Botanical Surface** (`#12352C`) — App headers, primary dark panels, selected navigation, and high-authority areas.
- **Deep Ink** (`#151919`) — Primary text on light surfaces. This replaces pure black.
- **Muted Graphite** (`#3D4640`) — Secondary copy, metadata, descriptions, and inactive labels.
- **Mineral Sage Line** (`#AFB88A`) — Hairline borders, separators, quiet outlines, and disabled structure.
- **Warm Copper Accent** (`#F5934F`) — The single accent for primary calls to action, active strokes, focus rings, eyebrows, and selected chips. Never apply as a glow or large background field.
- **Soft Evidence Blue** (`#A5C3FF`) — Semantic information state only: source links, verified evidence, and traceable system information.
- **Review Amber** (`#A65F11`) — Semantic draft, uncertainty, and human-review state only.
- **Critical Safety Red** (`#B42318`) — Semantic destructive, emergency-interrupt, dosage-ambiguity, and safety state only.
- **Neutral Hairline** (`#E6E0D6`) — Default structural divider where Sage would imply stronger emphasis.

### Color behavior

- Maintain readable contrast for text, controls, status chips, and focus states.
- Use Botanical with Paper text for primary dark surfaces.
- Use Copper sparingly so an accented element always signals action or active focus.
- Keep semantic colors localized to the state they explain; never create multi-color decorative dashboards.
- Shadows must be neutral or Botanical-tinted. Never use colored outer glows.
- Do not introduce purple, neon blue, cool gray, or gradient accents.
- Never use pure black (`#000000`).

## 3. Typography Rules

Use sans-serif typography exclusively. This is a clinical software interface, not an editorial publication.

- **Display and interface:** **Plus Jakarta Sans** — screen titles, section headings, body text, buttons, forms, and navigation.
- **Mono:** **JetBrains Mono** — timestamps, identifiers, dosage notation, tabular values, and dense numerical metadata when monospacing improves comparison.
- **Screen title:** Plus Jakarta Sans SemiBold or Bold, `clamp(1.75rem, 6vw, 2rem)`, tight tracking, compact line height.
- **Brand wordmark:** Plus Jakarta Sans SemiBold, `22–24px`.
- **Section heading:** Plus Jakarta Sans SemiBold, `12–15px`.
- **Body:** Plus Jakarta Sans Regular or Medium, `14–16px` for production UI, `1.5–1.65` line height, maximum `65ch` per text block.
- **Metadata and caption:** Plus Jakarta Sans Regular or Medium, `12–13px`; never reduce essential clinical or consent information below `12px`.
- **Eyebrow and status chip:** Plus Jakarta Sans SemiBold, `10–12px`, concise uppercase only when the category genuinely benefits from it.
- **Numbers in dense doctor/staff tables:** JetBrains Mono, tabular figures enabled.

### Typographic behavior

- Use weight and tone before increasing size.
- Keep labels plain and direct. Sentence case is the default.
- Reserve uppercase for short status, provenance, or workflow labels.
- Distinguish factual record and AI assistance through headings, surface treatment, and provenance—not novelty fonts.
- Never use Inter, generic system fonts, or serif fonts.
- Never use `LABEL // YEAR` or similar pseudo-technical formatting.

## 4. Component Stylings

### Buttons

- Primary buttons use Deep Botanical fill with Warm Paper text, or Warm Copper when the action must be the single dominant action on a Botanical surface.
- Secondary buttons use transparent or Paper fill with a `1px` Copper, Sage, or neutral border according to meaning.
- Use compact pill geometry: `44px` minimum height, `12–16px` horizontal padding, fully rounded only for concise actions.
- On press, translate down `1px` and slightly reduce shadow. Never glow, bounce, or scale dramatically.
- Show one dominant action per local decision area. Avoid clusters of equally weighted buttons.
- Destructive actions use Critical Red with explicit text; never rely on color alone.

### Cards and record containers

- Use Paper fill on Alabaster with `14–22px` corner radius and `16–20px` internal padding.
- Use elevation only when a surface must float above surrounding content, such as a drawer, active review item, or confirmation panel.
- Standard lift: black at `15%`, `0 8px 18px`, plus a subtle white inner top highlight at `7%`.
- Ambient lift: black at `4%`, `0 8px 24px -12px`.
- In dense lists, schedules, ledgers, and clinical records, replace repeated cards with flat rows, `1px` border-top dividers, and grouped whitespace.
- Never produce three equal feature cards in a row.

### Inputs and forms

- Place the label above the field. Place helper text beneath the label or field, and error text directly below the affected field.
- Use Paper fill, Deep Ink text, `1px` Mineral Sage or Neutral Hairline border, `12–16px` radius, and a minimum `44px` height.
- Focus uses a visible Copper ring or `2px` active border without an outer glow.
- Use native controls when they communicate the task clearly. Never use floating labels.
- Group medication dose, route, frequency, timing, and duration as distinct structured fields.
- Preserve a free-text path such as “Something else…” when structured patient choices are offered.

### Navigation

- Desktop navigation is compact and role-aware. Mobile navigation uses a bottom dock with a clearly selected item.
- Active navigation uses Botanical or a restrained Copper marker, never a neon indicator.
- Role switching must be explicit and must not imply that clinic access changes a person’s patient identity.
- Keep mobile tap targets at least `44×44px`.

### Status, provenance, and AI boundaries

- Every clinically meaningful item should show its origin when relevant: **Doctor-authored**, **AI-derived**, **Patient-asserted**, or **Source document**.
- Status chips are compact, readable, and use text plus color.
- Factual patient record and AI assistance must occupy visibly separate containers or columns. AI output never visually impersonates an authoritative clinical record.
- Draft OCR and voice output always display a Review Amber draft state until a doctor finalizes it.
- Consent and access controls show scope, duration, and affected records in plain language.

### Safety, errors, loading, and empty states

- Safety interruptions use Critical Red sparingly, direct language, and a single unambiguous next action. Stop the normal AI flow when a critical state is active.
- Inline errors explain what failed and how to correct it. Never rely on toast-only reporting for form or safety errors.
- Loading uses skeletal placeholders matching the exact dimensions of the incoming rows or panels. No generic circular spinners.
- Empty states explain what belongs in the area and provide the relevant action. Use a composed layout, not a lonely “No data” label or decorative illustration.
- Confirmation dialogs summarize the consequence before the action, especially for prescription finalization, consent changes, and record removal requests.

## 5. Layout Principles

Use a mobile-first CSS Grid architecture with clear containment and strong vertical rhythm.

- **Mobile baseline:** `393px` reference frame with `24px` side padding.
- **Desktop containment:** center application content within a maximum width of `1400px`; operational workspaces may use nested rails and content columns inside this boundary.
- **Primary spacing rhythm:** `4, 6, 8, 12, 16, 20, 24, 32, 40px`.
- **Section spacing:** use `clamp(3rem, 8vw, 6rem)` only for major page regions; clinical list spacing remains tighter.
- **Grid first:** use CSS Grid for shell, split workspace, schedule, ledger, and record layouts. Do not use percentage calculations or `calc()` hacks to imitate a grid.
- **No overlaps:** no absolute-positioned content stacking, text over images, floating controls obscuring records, or clipped status labels.
- **No generic feature rows:** avoid three equal horizontal cards. Prefer a dominant summary beside a narrower action rail, a two-column clinical split, asymmetric stacked groups, or flat records.
- **Full-height screens:** use `min-height: 100dvh`, never `100vh` or fixed viewport height.

### Role-specific layout

- **Patient:** calm single-column flow, clear next action, expandable evidence, visible privacy scope.
- **Doctor:** denser split workspace with patient record and AI assistance clearly separated; review queues prioritize unresolved or ambiguous items.
- **Clinic staff:** operational density with role-limited information; reception and clinical-assistant views must not expose unrelated clinical detail.

### Responsive behavior

- Below `768px`, every multi-column layout collapses to one column without exception.
- No horizontal page scrolling on mobile. Tables transform into labeled record rows or use contained, explicitly scrollable data regions only when comparison would otherwise be lost.
- Screen titles scale with `clamp()`; body text remains at least `14px`, preferably `16px` for patient-facing instructions.
- Navigation collapses to a clean mobile menu or bottom dock.
- Drawers become full-width bottom sheets or full-screen review steps on small screens.
- Preserve at least `44px` touch targets and adequate space between destructive and primary actions.

## 6. Motion & Interaction

Motion is quiet feedback, never spectacle.

- Use spring behavior near `stiffness: 100, damping: 20` for drawers, selected chips, expandable evidence, and local state transitions.
- Animate only `transform` and `opacity`. Never animate `top`, `left`, `width`, or `height`.
- Stagger newly revealed record rows by `30–50ms`, capped so long clinical lists do not delay access.
- Button press: `translateY(1px)` with immediate feedback.
- Drawer and sheet entrance: short upward movement with opacity, settling without bounce.
- Active synchronization or review states may use a subtle low-contrast pulse or shimmer. Do not animate every active component indefinitely; persistent motion is inappropriate for clinical focus and accessibility.
- Respect `prefers-reduced-motion` by removing nonessential translation, shimmer, and stagger.
- Never animate safety text, medication values, dosage ambiguity, or finalized clinical records.
- Keep fixed noise or grain effects out of the clinical workspace; surface texture should come from color and spacing, not visual interference.

## 7. Anti-Patterns — Never Do

- No emojis anywhere in the product interface.
- No Inter, generic system font, or serif font.
- No pure black (`#000000`).
- No purple, neon blue, neon gradients, outer glows, or oversaturated accents.
- No decorative gradient text on headings.
- No custom mouse cursors.
- No overlapping text, imagery, controls, cards, drawers, or floating action elements.
- No centered hero or centered screen-opening composition.
- No three-column equal-card layout.
- No generic chatbot transcript as the primary patient interaction. Render structured questions as buttons, choices, forms, timelines, and evidence panels.
- No fabricated metrics, percentages, response times, uptime claims, patient counts, or performance statistics. Use `[metric]` when real data is unavailable.
- No fake “System Metrics,” “By the Numbers,” or performance dashboard sections.
- No generic placeholder names such as “John Doe,” “Acme,” or “Nexus.” Use clearly marked placeholders like `[patient name]` or approved realistic test fixtures.
- No AI copywriting clichés such as “Elevate,” “Seamless,” “Unleash,” “Revolutionize,” or “Next-Gen.”
- No filler text such as “Scroll to explore,” “Swipe down,” or decorative chevrons.
- No decorative or broken stock-image URLs. Clinical workflow screens should generally avoid stock photography.
- No circular loading spinner when a skeleton can represent the incoming content.
- No color-only status communication.
- No silent conversion of AI inference into factual patient history.
- No auto-finalized OCR, voice, or AI-generated prescription content.
- No visual ambiguity between patient-controlled vault data and doctor-owned professional records.
- No unrestricted clinic-staff views; information density must remain bounded by role and active task.
