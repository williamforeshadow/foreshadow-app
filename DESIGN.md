---
name: Foreshadow
description: The unified operations cockpit for short-term-rental teams — calm by default, decisive when it matters.
colors:
  primary: "oklch(0.6112 0.1217 248.9572)"
  signal-violet: "#6366f1"
  signal-violet-light: "#a78bfa"
  signal-violet-deep: "#4c4869"
  bg-light: "oklch(0.9581 0 0)"
  bg-dark: "#0F0F12"
  surface-card-light: "oklch(0.9774 0.0042 236.4961)"
  surface-card-dark: "#1A1A1F"
  surface-elevated-light: "#ffffff"
  surface-elevated-dark: "#2A2A32"
  ink-light: "oklch(0.3134 0.0234 253.6270)"
  ink-dark: "#f0efed"
  muted-light: "oklch(0.6027 0.0062 211.0375)"
  muted-dark: "#a09e9a"
  border-light: "oklch(0.8840 0.0067 208.7806)"
  border-dark: "rgba(255,255,255,0.07)"
  destructive: "#d97757"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 3vw, 2.25rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "normal"
  mono:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "0.225rem"
  md: "0.425rem"
  lg: "0.625rem"
  xl: "1.025rem"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink-light}"
    textColor: "{colors.bg-light}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.ink-light}"
    textColor: "{colors.bg-light}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  chip-active:
    backgroundColor: "{colors.signal-violet}"
    textColor: "{colors.bg-light}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
  card:
    backgroundColor: "{colors.surface-card-light}"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.lg}"
    padding: "16px"
  input:
    backgroundColor: "{colors.bg-light}"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "36px"
---

# Design System: Foreshadow

## 1. Overview

**Creative North Star: "The Quiet Control Room"**

Foreshadow is the room a property-operations manager runs the whole business from: translucent glass surfaces floating over a cool, near-black canvas, where every reservation, turnover, and task reads at a glance and nothing competes for attention until it needs to. The system is quiet by default and decisive when it matters. The cool-neutral palette recedes; a single Signal Violet accent is the only thing that lights up, reserved for what's interactive or what's live right now (an active tab, a CTA, a focus ring, a turnover in progress).

The feel is an operator's desk, not a marketing page. Density is welcome where managers work across many properties at once, but density never means clutter: whitespace, hierarchy, and tonal layering do the sorting so the eye lands on state first and detail second. Craft is carried by precision and material (Apple-style liquid-glass vibrancy, exact spacing, restrained motion), never by decoration shouting for notice.

This system explicitly rejects four things, drawn from the product's anti-references: the **generic SaaS dashboard** (hero-metric templates, identical icon+heading+text card grids, decorative gradients); the **cluttered legacy PMS** (cramped, overwhelming, dated property software); the **toy-like consumer app** (over-rounded, over-colorful, not serious for daily operations); and **cold enterprise software** (sterile gray with no warmth or craft). Warmth here comes from material and motion, not from corporate minimalism.

**Key Characteristics:**
- Cool-neutral canvas, near-black in dark mode, near-white in light.
- One accent — Signal Violet — used sparingly as the system's only "on" state.
- Liquid-glass surfaces with tiered translucency; light = closest to the user.
- Geist throughout: one family, hierarchy from weight and scale, not font-mixing.
- Calm at rest; motion is feedback, never choreography for its own sake.

## 2. Colors

A cool, low-chroma neutral field with a single saturated violet accent — restraint is the strategy, and the accent's rarity is what gives it meaning.

### Primary
- **Operator Blue** (`oklch(0.6112 0.1217 248.9572)`): The semantic `--primary` in light mode — a calm cool blue used for primary actions and focus rings on light surfaces. In dark mode `--primary` inverts to near-white ink on near-black, so the *interactive identity* of the app is carried by Signal Violet below rather than by this token.

### Secondary
- **Signal Violet** (`#6366f1`): The signature interactive accent. Active tabs, primary CTAs, focus rings, and live affordances. This is the indigo anchor of the accent ramp; it is the only color allowed to mean "this is on / act here."
- **Signal Violet Light** (`#a78bfa`): The lavender top of the ramp. Subtle hovers, dark-mode interactive states, and the "active turnover / reservation" surfaces (`--turnover-purple-*`) across Timeline bars, TurnoverCards, and the Schedule grid.
- **Signal Violet Deep** (`#4c4869`): The deepest rung, used rarely for the most recessed accent states.

### Neutral
- **Cool Canvas** (`oklch(0.9581 0 0)` light / `#0F0F12` dark): The body background. Near-white neutral in light, near-black in dark — never warm, never cream.
- **Card Surface** (`oklch(0.9774 0.0042 236.4961)` light / `#1A1A1F` dark): Resting surface for cards, sidebar, popovers.
- **Elevated Surface** (`#ffffff` light / `#2A2A32` dark): The top tier — popouts, menus, the layer "closest to the user." In dark mode this is the *lightest* rung (see Elevation).
- **Ink** (`oklch(0.3134 0.0234 253.6270)` light / `#f0efed` dark): Primary text.
- **Muted** (`oklch(0.6027 0.0062 211.0375)` light / `#a09e9a` dark): Secondary text and labels. Held to the body contrast standard, never lighter "for elegance."
- **Border** (`oklch(0.8840 0.0067 208.7806)` light / `rgba(255,255,255,0.07)` dark): Hairline dividers and outlines.
- **Destructive** (`#d97757`): Warm terracotta for destructive/alert states — the one deliberately warm note, used only as a signal.

### Named Rules
**The One Signal Rule.** Signal Violet appears on a small fraction of any given screen and means exactly one thing: this is interactive or this is live. It is never a decorative fill, never a gradient, never body text or a border color. Its scarcity is the entire point — flood the screen with it and the cockpit stops being calm.

**The Cool-Only Rule.** The neutral field is cool or true-neutral, never warm. No cream, sand, beige, or paper backgrounds. The only warm color in the system is the terracotta destructive, and it only ever appears as a signal.

## 3. Typography

**Display / Body Font:** Geist (with `ui-sans-serif, system-ui, -apple-system, sans-serif`)
**Mono Font:** Geist Mono (with `ui-monospace, SFMono-Regular, Menlo, monospace`)

**Character:** One modern, neutral grotesque carries the entire interface. Hierarchy comes from weight and scale contrast, not from pairing competing typefaces — the restraint reads as composure, which is the point of an operations tool. Mono appears only for IDs, codes, timestamps, and tabular figures where alignment matters.

### Hierarchy
- **Display** (600, `clamp(1.75rem, 3vw, 2.25rem)`, line-height 1.1, tracking -0.02em): Page and primary section titles. Operator-scaled, not marketing-scaled — never shouting.
- **Title** (600, 1.125rem, line-height 1.3): Card headers, panel titles, dialog headings.
- **Body** (400, 0.875rem, line-height 1.5): Default UI text. Cap prose blocks at 65–75ch.
- **Label** (500, 0.75rem, line-height 1.2): Field labels, chips, table headers, metadata. Sentence case by default; uppercase only for short (≤4 word) status labels, used sparingly.
- **Mono** (400, 0.8125rem): Reservation IDs, codes, timestamps, numeric columns.

### Named Rules
**The One Family Rule.** Geist does all the structural work; Geist Mono is the only permitted second face, and only for genuinely monospaced data. No serif, no third family — more than this reads as indecision, not richness.

## 4. Elevation

Depth is built from **tiered liquid glass over tonal layering**, not from drop shadows. Surfaces are translucent and blurred (`backdrop-filter`), separated by tone and a thin top rim-light rather than by hard cast shadows. Shadows that exist are soft and ambient — they suggest a surface floating above the canvas, never a hard 2014-style drop. (Audit test: if a surface has a dark, tight drop shadow, it's wrong — soften and diffuse it, or replace it with a tonal step.)

The ordering rule is inverted for dark mode: **the higher the z-index, the lighter the surface.** A popout sits above a card, so it's the lightest rung of the cool ramp (`#2A2A32`), while the card and sidebar share `#1A1A1F` and the canvas is darkest at `#0F0F12`. Light mode keeps elevated surfaces plain white.

### Shadow Vocabulary
- **Ambient card** (`box-shadow: 0 1px 1px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.45)`): The resting glass-card lift — diffuse, plus an inner rim highlight that sells the glass edge.
- **Glass panel** (`backdrop-filter: blur(24px) saturate(1.6)` + faint ambient shadow): Filter bars, sticky headers.
- **Liquid-glass surface** (`blur(28px) saturate(1.8)`, tint + sheen + `inset 0 1px 0 rim`): The premium vibrancy surface for the topmost tier.

### Named Rules
**The Light-Is-Closest Rule.** In dark mode, elevation reads through lightness: the closest layer to the user is the lightest. Never invert this by darkening a popout below the surface it floats over.

**The Glass-On-Backing Rule.** Radix popouts are positioned with `transform`, which makes Chromium drop `backdrop-filter`. Apply `.liquid-glass-surface` to a non-transformed backing layer *inside* the content, never to the transformed content element itself, or the blur silently disappears.

## 5. Components

Built on a shadcn-style library (Radix + base-ui primitives, `class-variance-authority` variants, Tailwind v4 tokens). Components are calm and tactile: gentle radii, hairline borders, state communicated through subtle background and ring shifts rather than motion or color floods.

### Buttons
- **Shape:** Gently rounded (`rounded-md`, ~0.425rem). Default height 36px (`h-9`), with `sm` (32px), `lg` (40px), and square icon variants.
- **Primary (`default`):** Solid ink fill (`bg-primary`) with inverted foreground; hover dims to 90% opacity. Decisive but quiet — no gradient, no lift bounce.
- **Hover / Focus:** `transition-all`; focus shows a 3px `ring-ring/50` with a border shift. Focus is always visible.
- **Secondary / Outline / Ghost / Link:** Secondary uses the muted surface; outline is a hairline border over the background; ghost is transparent until a soft `accent` hover; link is text-only with underline-on-hover.

### Chips
- **Style:** Compact pill (`rounded-md`, 4px×12px padding) for filters and status.
- **State:** Active/selected filters take Signal Violet fill with inverted text; unselected stay on the muted surface. The active chip is one of the few places the accent is allowed to fill.

### Cards / Containers
- **Corner Style:** `rounded-lg` (0.625rem).
- **Background:** Card surface token; glass-card utility for floating/translucent contexts.
- **Shadow Strategy:** Ambient card shadow from Elevation — diffuse, never a hard drop. Nested cards are forbidden.
- **Border:** Hairline border token; in dark mode a low-alpha white line.
- **Internal Padding:** 16px (`md`) default.

### Inputs / Fields
- **Style:** Hairline stroke over the background, `rounded-md`, 36px height. Placeholder text held to the body contrast standard.
- **Focus:** Ring + border shift in the focus color; no glow flood.
- **Error / Disabled:** `aria-invalid` drives a destructive ring; disabled drops to 50% opacity with pointer-events off.

### Navigation
- **Style:** Persistent left sidebar (256px open / 64px collapsed, width driven live by `--sidebar-width`). Items are quiet at rest; the active item is marked with Signal Violet (text/indicator), hover gets a soft accent background. On mobile (Capacitor iOS/Android), navigation collapses to a touch-first shell with large targets.

### Signature: Liquid-Glass Surface
The system's hallmark. Tinted, blurred, saturated vibrancy with a top sheen gradient and an inset rim-light, designed to read as glass against both the near-black dark canvas and the near-white light one. Reserved for the topmost tier (popouts, the full-screen AI chat panel, key floating panels) — used purposefully, never as a default skin on every card.

## 6. Do's and Don'ts

### Do:
- **Do** keep Signal Violet (`#6366f1` / `#a78bfa`) rare — reserve it for interactive and live states (active tab, CTA, focus ring, active turnover). Its scarcity is the design.
- **Do** keep the canvas cool or true-neutral (`oklch(0.9581 0 0)` light, `#0F0F12` dark). Warmth comes only from the terracotta destructive signal.
- **Do** build depth with tiered glass + tonal layering, and in dark mode make the highest layer the lightest (`#2A2A32` popouts above `#1A1A1F` cards above `#0F0F12` canvas).
- **Do** apply `.liquid-glass-surface` to a non-transformed backing layer inside Radix popouts, or the backdrop blur silently drops.
- **Do** carry hierarchy with Geist weight + scale; hold muted text to the 4.5:1 body contrast standard.
- **Do** give every animation a `prefers-reduced-motion` fallback, and make sure state is never communicated by motion alone.
- **Do** keep field-facing surfaces (cleaner-facing forms, mobile) large-target and high-contrast.

### Don't:
- **Don't** build the **generic SaaS dashboard**: no hero-metric template (big number + small label + gradient accent), no endless identical icon+heading+text card grids, no decorative gradients.
- **Don't** drift toward a **cluttered legacy PMS** — cramped, dense, overwhelming. Whitespace and hierarchy do the work.
- **Don't** make it **toy-like / consumer** — no over-rounding, no color floods, nothing that undercuts being a serious daily operations tool.
- **Don't** ship **cold enterprise gray** with no craft; warmth is earned through material, motion, and precise spacing.
- **Don't** use `background-clip: text` gradient text, `border-left`/`border-right` colored side-stripes, or glassmorphism as a default decorative skin.
- **Don't** introduce a warm cream/sand/beige background or a third font family.
- **Don't** use hard, tight, dark drop shadows; if a surface has one, it reads as a 2014 app — diffuse it or replace it with a tonal step.
