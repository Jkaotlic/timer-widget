# Display Block Controls — Scale & Drag

## Overview

Add interactive controls to fullscreen display (display.html + display-script.js) for scaling and repositioning time info blocks (current time, event time, end time).

## Behavior

### Ctrl — Scale Slider

- Hold Ctrl: a horizontal slider appears at bottom of screen (identical to widget scale bars)
- Slider controls `--info-scale` CSS variable for all 3 info blocks simultaneously
- Range: 50%–300%
- Drag uses screenX delta from mousedown start (same proven approach as widgets)
- Fill, thumb, tooltip with percentage — same visual style as widget scale bars
- Release Ctrl hides slider (with 0.2s fade)

### Alt — Drag Blocks

- Hold Alt: cursor changes to `grab`, blocks get subtle highlight border
- Alt + mousedown on a block: begin drag (`grabbing` cursor)
- Mousemove updates block `left`/`top` via inline styles (position: fixed)
- On drag start, remove CSS position class (`top-left`, etc.) from that block — switch to absolute positioning via inline styles
- Free overlap allowed, no snapping
- Mouseup ends drag

### Persistence (localStorage)

- Key: `displayBlockPositions` — stores `{ currentTime: {left, top}, eventTime: {left, top}, endTime: {left, top} }`
- Key: existing `--info-scale` value saved alongside display settings
- On load: if saved positions exist, apply inline left/top instead of CSS position classes
- When control panel changes layout preset (`frame`, `corners`, etc.), clear saved positions and revert to CSS classes

## Files Changed

| File | Changes |
|------|---------|
| display.html | Add `.scale-bar-zone` CSS, `.alt-draggable` highlight styles |
| display-script.js | Ctrl/Alt key listeners, scale bar logic, drag logic, localStorage persist/restore |

## Files NOT Changed

- electron-main.js (no IPC needed, all renderer-local)
- constants.js (no new IPC channels)
- preload.js / channel-validator.js (no new channels)

## Technical Notes

- Scale bar uses `requestAnimationFrame` throttle + `lastSentSize` dedup (widget pattern)
- Drag uses screenX/screenY deltas to avoid feedback loops
- `body.ctrl-active` class toggles scale bar visibility
- `body.alt-active` class toggles drag mode visuals
- Preset changes from control panel (via `display-settings-update` IPC) must clear persisted positions
