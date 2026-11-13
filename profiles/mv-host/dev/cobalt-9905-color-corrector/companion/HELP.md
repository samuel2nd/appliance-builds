# Cobalt 9905-MPx

Controls a single Cobalt Digital 9905-MPx openGear card, across all 4 signal
paths:

- Color Proc and Color Correction
- 3D LUT (User and NBCU)
- HDR input tagging
- Frame Sync and Scaler
- Routing and HDMI
- Card presets
- Live status

## Setup

1. **Frame IP Address**: IP of the frame's control card (e.g. `<frame-ip>`)
2. **Card Slot Number**: frame slot the card occupies (e.g. `2`)
3. **Status poll interval**: seconds between status refreshes (default 5, 0 = off)

Add one connection per card.

## Tips

- Add **Resync Path Values** to every button that opens a path's page. The card
  doesn't send path settings on its own, so this pulls in that path's Color,
  LUT, Frame Sync and Scaler values.
- **3D LUT: Recall User LUT** / **Recall NBCU LUT** select the LUT and switch
  processing to it in one press. Use the **User LUT is live** / **NBCU LUT is
  live** feedbacks to light the active one.
- Every choice setting has a **Step … (next/previous)** action for dials.
- Ready-made buttons are under Presets, grouped by path and section.
- Network settings and Restore Factory Defaults are deliberately not included.

See README.md in the module folder for the full OID table.

## Status wall

- **Tiles:** use the *Status Wall* preset per path. The tile shows input
  (`1080i59.94 SDR`), output format and colour:
  - **green:** OK
  - **yellow:** not at zero
  - **red:** no input, unlocked, or off the show format
- **Wall: Set show format:** Scaler output plus fallback formats on all paths.
  It also sets the connection's *Show format*, which the tiles check against.
- **Wall: Zero paths:** Proc/CC unity, LUT bypass, HDR tags Auto, frame sync
  defaults. Frame delay goes to the *zero value* setting (default 0).
- **Presets: Recall card preset:** loads the preset, then re-reads all 4 paths.
