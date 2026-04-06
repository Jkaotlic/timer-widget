# Timer Widget — Design Improvements v2

**Date:** 2026-04-06
**Status:** Approved
**Mockup:** `.superpowers/brainstorm/1913-1775470678/content/design-improvements.html`
**Figma:** https://www.figma.com/design/ojj21B75qClGUlDgqAUFIU (control panel only, Starter plan limit)

## Design System Tokens

### Glassmorphism (VisionOS-inspired)
| Token | Value | Usage |
|-------|-------|-------|
| `--glass-blur` | `blur(40px) saturate(180%)` | Widget, Clock, Display info blocks |
| `--glass-bg` | `rgba(15, 15, 25, 0.75)` | Widget/Clock window background |
| `--glass-border` | `1px solid rgba(255,255,255,0.08)` | All glass containers |
| `--glass-inset` | `inset 0 1px 0 rgba(255,255,255,0.08)` | Top highlight on glass |

### Border Radius (3-level hierarchy)
| Level | Value | Usage |
|-------|-------|-------|
| Container | `24px` | Widget/Clock window frame |
| Group | `12px` | Settings cards, info blocks |
| Element | `8px` | Buttons, inputs, presets |

### Typography
| Element | Font | Weight | Size |
|---------|------|--------|------|
| Timer display (circle/analog) | Inter | 200 (Light) | 40px widget, 72px display |
| Timer display (digital LED) | JetBrains Mono | 300 (Light) | 42px widget |
| Timer display (flip) | Inter | 700 (Bold) | 36px per digit |
| Status badge | Inter | 500 (Medium) | 9px |
| UI labels | Inter | 400-500 | 11px |

### Colors (Apple Semantic Palette)
| Name | Value | Usage |
|------|-------|-------|
| systemBlue | `#0a84ff` | Primary accent, active tabs, links |
| systemGreen | `#30d158` | Play button, running status, toggle ON |
| systemOrange | `#ff9f0a` | Pause button, warning status |
| systemRed | `#ff453a` | Reset/danger, overtime, minus adjust |
| systemYellow | `#ffd60a` | Warning 1-min |
| systemPurple | `#bf5af2` | Theme option |
| systemPink | `#ff375f` | Theme option |
| systemTeal | `#0ac7c7` | Theme option |

### Progress Ring
- Style: Gradient stroke `#0a84ff` → `#30d158`
- Track: `rgba(255,255,255,0.06)`, 6px width (widget), 8px width (display)
- Progress: gradient, `stroke-linecap: round`
- Same gradient across widget, clock, and display windows

### Shadows
| Context | Value |
|---------|-------|
| Widget/Clock (transparent window) | **NO external shadows** — only `inset 0 1px 0 rgba(255,255,255,0.08)` and `border` |
| Control panel | `0 25px 80px rgba(0,0,0,0.7)` + `inset 0 1px 0 rgba(255,255,255,0.05)` |
| Display info blocks | `0 4px 16px rgba(0,0,0,0.3)` |
| Buttons (play) | `0 4px 16px rgba(accent, 0.3)` — only in control panel |

### Transitions
- Micro-interactions: `0.2s ease-out`
- Layout changes: `0.3s ease`
- Never > 500ms for UI transitions

## Changes by Window

### 1. Widget (`electron-widget.html`)

**CRITICAL: Window is `transparent: true` — NO external shadows allowed.**

| Change | Before | After |
|--------|--------|-------|
| Backdrop filter | `blur(20px)` | `blur(40px) saturate(180%)` |
| Border radius (frame) | `16px` | `24px` |
| Border | `rgba(255,255,255,0.1)` 2px | `rgba(255,255,255,0.08)` 1px |
| Timer font (circle) | SF Mono, font-weight 700 | Inter, font-weight 200 |
| Timer font (digital) | system mono | JetBrains Mono, font-weight 300 |
| Progress ring | Solid accent color | Gradient `#0a84ff → #30d158` |
| Ring stroke width | varies | 6px uniform |
| Status badge | text only | pill with bg `rgba(accent, 0.15)` |
| External shadows | `drop-shadow(0 0 8px)` | **REMOVED** (transparent window) |
| Inset shadow | none | `inset 0 1px 0 rgba(255,255,255,0.08)` via border |
| Transition timing | `0.3s ease` | `0.2s ease-out` |

Applies to all 4 styles: circle, digital, flip, analog.

### 2. Clock Widget (`electron-clock-widget.html`)

**CRITICAL: Window is `transparent: true` — NO external shadows allowed.**

Same changes as Widget (identical glassmorphism system). Additionally:
- Clock ring uses same gradient as widget progress ring
- Digital LED uses JetBrains Mono instead of system mono
- All 4 styles get the same treatment

### 3. Display (`display.html` + `display-script.js`)

| Change | Before | After |
|--------|--------|-------|
| Progress ring | Solid gradient via SVG | Gradient `#0a84ff → #30d158` (consistent) |
| Ring stroke width | varies | 8px |
| Timer font weight | mixed | 200 (Light) for circle/analog |
| Info blocks backdrop | `blur(10px)` | `blur(10px)` (keep — not transparent window) |
| Info block radius | `16px` | `12px` (group level) |
| Status badge | text | pill with bg |

### 4. Control Panel (`electron-control.html`)

Already redesigned (700x760, 2-col grid). Additional polish:
- Noise texture overlay: SVG turbulence at 0.03 opacity (already in CSS)
- Tab active state: brighter contrast (`#0a84ff` at full opacity)
- Settings cards: ensure consistent 12px radius
- No structural changes needed

## Scope

### In Scope
- CSS-only changes to glassmorphism parameters (blur, border, radius, shadows)
- Font changes (Inter Light for timer, JetBrains Mono for LED)
- Progress ring gradient (SVG linearGradient)
- Status badge styling
- Transition timing updates
- Remove external shadows from widget/clock

### Out of Scope
- No layout changes (already done in v1 redesign)
- No new features
- No JavaScript logic changes
- No new HTML structure (except SVG gradient defs if missing)
- No changes to audio/sound system

## Files to Modify
1. `electron-widget.html` — glassmorphism + typography + ring gradient + shadow cleanup
2. `electron-clock-widget.html` — same changes as widget
3. `display.html` — ring gradient + typography consistency
4. `display-script.js` — if gradient needs JS setup
5. `electron-control.html` — minor polish (optional)
