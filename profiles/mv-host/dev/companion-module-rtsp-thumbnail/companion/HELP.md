## RTSP Thumbnail

Shows a live stream as a button background, on one key or spread across several. One connection = one stream, decoded once. Every button's layout is set on its own feedback.

### Connection

- **Stream URL**: e.g. `rtsp://<camera-ip>:554/<stream-path>`, or UniFi Protect `rtsp://<UDM-IP>:7447/<token>`. Use a low-res/sub stream.
- **RTSP transport**: TCP is the most reliable.
- **Thumbnail FPS**: 3–5 is plenty.
- **Working resolution**: the size every layout is cut from (default 640 wide). Raise it for big grids, as long as the stream itself is that large.
- **Key render size**: pixels per key.
- **ffmpeg path**: blank uses the bundled ffmpeg, then ffmpeg on PATH.

### Live thumbnail feedback

The button needs an **Image element**. Add it before adding the feedback so Companion links them automatically.

- **Key shape**: Square for normal keys. Wide 2:1 for the Stream Deck + / + XL touch strip segments.
- **Grid columns / rows**: 1×1 = single key. 3×3 = one image across 9 keys.
- **This button: column / row**: which tile this button shows (1-based, top-left = 1,1).
- **Gap**: picture hidden under the physical gap between keys, as % of key. Use the same value on every button in a grid. Tune by eye.
- **Framing**: Fill crops to the grid shape. Fit shows the whole frame with black bars.

Strip tip: Wide, 2 columns × 1 row, Gap 0 spreads one camera across two strip segments (the strip has no physical gap).

The same camera can be 1×1 on one page and 3×3 on another with no extra connections.

### Other

- **Stream is down** feedback: boolean, red by default.
- Variables: `status` (live/down), `fps`, `resolution`.
