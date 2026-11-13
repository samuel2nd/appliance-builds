## RTSPmv

Controls an [RTSPmv](https://github.com/) software multiviewer: route cameras to tiles, change
layouts, recall presets. Updates are pushed live from the server, so feedbacks change the moment
anything is routed (from Companion, the settings page, or another client).

### Setup
Enter the IP of the computer running RTSPmv and its web port (default **8090**). If the
connection stays red, open `http://<ip>:8090/api/state` from the Companion machine; if that
times out, the RTSPmv computer's firewall is blocking the port (`sudo ufw allow 8090/tcp`).

### Actions
- **Route camera to tile** (swaps if the camera is already on another tile)
- **Next / previous camera on tile**
- **Swap two tiles**, **Clear tile**
- **Set layout**
- **Recall preset**, **Save current as preset**

### Feedbacks
- Camera is on tile · Camera is on screen · Tile is empty
- Layout is active · Preset matches what is on screen

### Variables
`$(rtspmv:layout)`, `$(rtspmv:layout_label)`, `$(rtspmv:tile_count)`,
`$(rtspmv:tile_1)` … `$(rtspmv:tile_16)` (camera names), `$(rtspmv:tile_N_id)` (camera IDs).
Replace `rtspmv` with your connection's label.

### Presets
Ready-made buttons for every camera × tile in the current layout, every layout, and every saved
preset, with feedback already attached. Preset buttons regenerate when cameras, layout, or saved
presets change.

### Router panel
Works like a router control panel: press a **destination** (tile), then a **source** (camera).
The selected destination lights amber; the source currently on it lights green.
Turn on **require TAKE** in the connection settings to make source buttons preselect (amber) and
a **TAKE** button execute the route. Pressing a preselected source again cancels it.
Variables: `$(label:dest)`, `$(label:dest_source)`, `$(label:preselect)`.

### Recovery
The MV running on the RTSPmv box reports which tiles show NO SIGNAL.
- Feedbacks: **tile has NO SIGNAL**, **any tile has NO SIGNAL**, **signal unknown** (MV not running on the box)
- Actions: **reconnect tile**, **reconnect all NO SIGNAL tiles**, **restart streams** (re-pulls every camera, reloads the MV)
- Variables: `$(label:signal)` (OK / n NO SIGNAL / UNKNOWN), `$(label:no_signal_count)`, `$(label:no_signal_tiles)`
