# Cobalt 9905-MPx — Companion Module (v2.1.1)

Full control of a Cobalt Digital 9905-MPx openGear card over the card's native
WebSocket API, across all 4 signal paths:

- Color Proc and Color Correction (v1)
- 3D LUT (User and NBCU)
- HDR input tagging (Source OETF / Colorimetry) and source select
- Frame Sync and Scaler
- Ancillary data
- SDI and HDMI output routing, HDMI setup and HDR InfoFrame
- Card presets
- Live status: temps, power, formats, references, SDI/audio status, event log

Every parameter in Cobalt's model definition (`tools/models_9905MPX.txt`) is
covered, **except** these settings, which are left out on purpose because they
can knock the card off the network or wipe it: Ethernet Connection, Address
Mode, NTP Source and Restore Factory Defaults.

## Upgrading from v1

The module id (`cobalt-9905-color-corrector`) and every v1 action, option,
feedback, variable and preset id are unchanged, so existing pages and buttons
keep working. `test/simulate.js` checks this.

## How it connects

One connection per card:

```
ws://<frame-ip>/rosetta_api/slots/<slot-number>
```

| Config field | Example |
|---|---|
| Frame IP Address | `<frame-ip>` |
| Card Slot Number | `2` |
| Status poll interval | `5` seconds (`0` = off) |

## How the 4 paths are addressed

Each parameter has a **scope** (see `params.js`):

| Scope | Meaning | Sections |
|---|---|---|
| `path` | Write oid 4864 (Path Select) first, then the parameter | Color Proc, Color Correction, 3D LUT, per-path Frame Sync, Scaler, Ancillary Data (4 ANC entries per path), Closed Captioning |
| `perpath` | One oid per path; no path select needed | Source, Source Colorimetry/OETF, **Source Status**, **Lock Status**, **Framesync Alarm**, Video Delay, Custom Path Name |
| `card` | Card-wide | Lock Mode, Lock to Input Path, routing, HDMI, presets, status |

All scopes are **confirmed** from the card's own menu tree (2026-10 capture of
Frame 2 slot 12): every path-scoped menu starts with Path Select, and Lock Mode
/ Lock to Input Path sit under "Global Framesync Controls".

Fixes from that capture:
- The model file calls oids 5638–5641 "SDI IN 1–4 Status". They are actually
  each path's Source Status.
- The capture adds per-path Lock Status (6436–6439), the Framesync alarm
  (6440–6443), Custom Path Names (4866–4869), ST352 VPID Colorimetry/OETF
  (6027/6028), and LUT choice 5 "Other LUT".

Status fields arrive as `{display, hints: {background-color}}`. The variable
shows the text, and the colour is kept for the status wall.

Path select is one register shared by the whole card. Every operation that
selects a path goes through a single queue, so two button presses or dial turns
can never interleave and send a value to the wrong path. A GET reply can never
overwrite a value written after that GET was sent. Without that, a button would
light and then go dark until the next poll.

## Live values

| What | When it refreshes |
|---|---|
| Path-scoped settings (Color, LUT, Frame Sync, Scaler) | On connect, on **Resync Path Values**, and after every write from Companion |
| Everything else | Polled every *N* seconds (default 5) |

Path-scoped settings are **not** polled in the background. That would mean
flipping the card's shared path register behind an operator's back while
they're using DashBoard or the web UI.

Variables are named `pathN_<key>` for path and per-path settings, and `<key>`
for card-wide ones. For example: `$(FS01-04:path1_lut_processing)`,
`$(FS01-04:core_temp)`. Choice settings show their label, such as `User LUT`.

## Status wall

| Variable | Example |
|---|---|
| `pathN_input_short` | `1080i59.94 SDR`, `1080p59.94 HLG`, `NO INPUT` |
| `pathN_output_short` | `1080p59.94` |
| `pathN_health` | `OK` / `NO INPUT` / `UNLOCKED` / `RATE ERR` / `WRONG FMT` / `NOT ZERO` |

Put the three feedbacks on a tile in this order. The last true one wins.

| Feedback | Colour | True when |
|---|---|---|
| `path_input_ok` | green | Input present, locked, no rate alarm, on the show format |
| `path_not_zero` | yellow | Proc/CC not unity, LUT not bypassed, HDR tags not Auto, Freeze/Flat Field, or frame delay not the "zero" value |
| `path_problem` | red | No input, unlocked, rate mismatch, or off the show format |

Macros. Each takes "All 4 paths" or a single path:

- **Wall: Set show format**: Scaler on and Requested Output Format, plus Format
  on Loss of Input and Format on Startup. It also saves the format to the
  connection's *Show format* setting, which the wall checks against.
- **Wall: Zero paths**: Proc + CC Reset to Unity, LUT Bypassed, Source
  OETF/Colorimetry Auto, Output Mode Input Video, and Frame Delay to the *zero
  value* setting (default **0**, matching the cards).
- **Resync All Paths**: re-reads all 4 paths.
- **Presets: Recall card preset**: loads the preset, waits, then re-reads all
  4 paths. Card presets save every layer, including Color Proc and 3D LUT.

**Settle time** (default 150 ms) is the pause after each Proc/CC Reset before
the next path is selected, and before re-reading after a preset load. The
card's reset reports "Applying…". If it finishes after the next path select, it
lands on the wrong path. The simulator test shows this happening at 0 ms.

## Actions

| Setting type | Actions |
|---|---|
| Choice | `<key>` (set) and `<key>_step` (next/previous, for dials) |
| Number | `<key>` (set) and `<key>_relative` (nudge from the live value) |
| Trigger | `<key>` (fire) |

Shortcuts:
- `lut_recall_user`: selects the User LUT, then sets processing to User LUT
- `lut_recall_nbcu`: selects the NBCU LUT, then sets processing to NBCU LUT
- `preset_recall`: Preset Select, then Load
- `resync_path`, `resync_all`, `refresh_status`
- `show_format`, `zero_paths`
- `raw_write`, `raw_read`

## Feedbacks

- `<key>_is` for every choice setting
- `lut_user_active` / `lut_nbcu_active`: green only when that LUT is
  selected **and** processing is set to its bank
- the v1 `video_proc_enabled` and `color_corrector_enabled`

## Files

| File | What |
|---|---|
| `main.js` | Connection, path queue, state, polling, macros |
| `status.js` | Status-wall logic (format strings, path health) |
| `actions.js`, `feedbacks.js`, `presets.js` | Companion definitions, generated from `params.js` |
| `params.js` | **Generated** parameter table — don't edit by hand |
| `tools/gen_params.py` | Builds `params.js` from `tools/models_9905MPX.txt`. Keys, scopes and exclusions live here |
| `test/simulate.js` | Simulated card + stubbed Companion: `npm test` |
| `oids.js` | v1 oid constants, kept for reference |

When Cobalt's model file changes (new firmware, new LUT names), replace
`tools/models_9905MPX.txt` and run `npm run gen-params && npm test`.

## OID reference

| OID | Key | Setting | Scope | Type |
|---|---|---|---|---|
| 261 | `product` | Status: Product | card | read-only |
| 1033 | `display_name` | Status: Display Name | card | read-only |
| 1025 | `serial_number` | Status: Serial Number | card | read-only |
| 267 | `firmware_revision` | Status: Firmware Revision | card | read-only |
| 1027 | `build_date` | Status: Build Date | card | read-only |
| 1028 | `hw_build` | Status: HW Build | card | read-only |
| 1029 | `fpga` | Status: FPGA | card | read-only |
| 1030 | `kernel_revision` | Status: Kernel Revision | card | read-only |
| 1040 | `event_log_1` | Status: Event Log 1 | card | read-only |
| 1041 | `event_log_2` | Status: Event Log 2 | card | read-only |
| 1153 | `core_temp` | Status: Core Temp (C) | card | read-only |
| 1154 | `ambient_temp` | Status: Ambient Temp (C) | card | read-only |
| 1155 | `board_power` | Status: Board Power (W) | card | read-only |
| 6017 | `input_format` | Status: Input Format | path | read-only |
| 6019 | `output_format` | Status: Output Format | path | read-only |
| 1156 | `reference_1` | Status: Reference 1 | card | read-only |
| 1157 | `reference_2` | Status: Reference 2 | card | read-only |
| 1158 | `timing_pll` | Status: Timing PLL | card | read-only |
| 1159 | `tx_ref_clk_calibration` | Status: TX Ref Clk Calibration | card | read-only |
| 1160 | `sdi_tx_calibration` | Status: SDI TX Calibration | card | read-only |
| 1161 | `hdmi_tx_calibration` | Status: HDMI TX Calibration | card | read-only |
| 6080 | `hdmi_output_format` | Status: HDMI Output Format | card | read-only |
| 6086 | `hdmi_setup_status` | Status: HDMI Setup | card | read-only |
| 6087 | `hdmi_sink_status` | Status: Sink Status | card | read-only |
| 512 | `active_ip_address` | Status: Active IP Address | card | read-only |
| 1024 | `general` | Status: General | card | read-only |
| 24323 | `title_line_1` | Status: TitleLine 1 | card | read-only |
| 24325 | `title_line_2` | Status: TitleLine 2 | card | read-only |
| 24327 | `title_line_3` | Status: TitleLine 3 | card | read-only |
| 24329 | `title_line_4` | Status: TitleLine 4 | card | read-only |
| 65281 | `displayed_product_name` | Status: Displayed Product Name | card | read-only |
| 6273 | `lut_processing` | 3D LUT: 3D-LUT Processing | path | choice |
| 6302 | `lut_nbcu_status` | 3D LUT: NBCU LUT Status | path | read-only |
| 6301 | `lut_nbcu_select` | 3D LUT: NBCU LUT Select | path | choice |
| 6293 | `lut_user_select` | 3D LUT: User LUT Select | path | choice |
| 7233 | `anc_mode_1` | Ancillary: Mode 1 | path | choice |
| 7234 | `anc_mode_2` | Ancillary: Mode 2 | path | choice |
| 7235 | `anc_mode_3` | Ancillary: Mode 3 | path | choice |
| 7236 | `anc_mode_4` | Ancillary: Mode 4 | path | choice |
| 7217 | `anc_insert_1` | Ancillary: Insert VANC/HANC 1 | path | choice |
| 7218 | `anc_insert_2` | Ancillary: Insert VANC/HANC 2 | path | choice |
| 7219 | `anc_insert_3` | Ancillary: Insert VANC/HANC 3 | path | choice |
| 7220 | `anc_insert_4` | Ancillary: Insert VANC/HANC 4 | path | choice |
| 6145 | `video_proc_enable` | Color Proc: Video Proc | path | choice |
| 6146 | `proc_reset_to_unity` | Color Proc: Proc Reset to Unity | path | trigger |
| 6147 | `luma_gain` | Color Proc: Luma Gain | path | float |
| 6148 | `luma_lift` | Color Proc: Luma Lift | path | float |
| 6149 | `color_gain` | Color Proc: Color Gain | path | float |
| 6150 | `color_phase` | Color Proc: Color Phase | path | float |
| 6151 | `gang_luma_color_gain` | Color Proc: Gang Luma/Color Gain | path | choice |
| 6152 | `color_corrector_enable` | Color Correction: Color Corrector | path | choice |
| 6153 | `cc_reset_to_unity` | Color Correction: CC Reset to Unity | path | trigger |
| 6154 | `red_black` | Color Correction: Red Black | path | float |
| 6155 | `green_black` | Color Correction: Green Black | path | float |
| 6156 | `blue_black` | Color Correction: Blue Black | path | float |
| 6157 | `red_gain` | Color Correction: Red Gain | path | float |
| 6158 | `green_gain` | Color Correction: Green Gain | path | float |
| 6159 | `blue_gain` | Color Correction: Blue Gain | path | float |
| 6160 | `red_gamma` | Color Correction: Red Gamma | path | float |
| 6161 | `green_gamma` | Color Correction: Green Gamma | path | float |
| 6162 | `blue_gamma` | Color Correction: Blue Gamma | path | float |
| 6163 | `gang_black_offset` | Color Correction: Gang Black Offset | path | choice |
| 6164 | `gang_white_gain` | Color Correction: Gang White Gain | path | choice |
| 6165 | `gang_gamma` | Color Correction: Gang Gamma | path | choice |
| 6166 | `black_hard_clip` | Color Correction: Black Hard Clip | path | float |
| 6167 | `white_hard_clip` | Color Correction: White Hard Clip | path | float |
| 6168 | `white_soft_clip` | Color Correction: White Soft Clip | path | float |
| 6169 | `chroma_saturation_clip` | Color Correction: Chroma Saturation Clip | path | float |
| 6401 | `fs_enable` | Frame Sync: Framesync Enable | path | choice |
| 6402 | `fs_lock_mode` | Frame Sync: Lock Mode | card | choice |
| 6404 | `fs_format_on_startup` | Frame Sync: Format on Startup | path | choice |
| 6405 | `fs_output_mode` | Frame Sync: Output Mode | path | choice |
| 6406 | `fs_mode_on_loss` | Frame Sync: Mode on Loss of Input | path | choice |
| 6408 | `fs_flat_field_color` | Frame Sync: Flat Field Color | path | choice |
| 6409 | `fs_vertical_lines` | Frame Sync: Vertical Lines | path | int |
| 6410 | `fs_horizontal_us` | Frame Sync: Horizontal (us) | path | float |
| 6411 | `fs_frame_delay` | Frame Sync: Frame Delay | path | int |
| 6412 | `fs_video_delay` | Frame Sync: Video Delay | path | read-only |
| 6413 | `fs_lock_status` | Frame Sync: Lock Status | path | read-only |
| 6414 | `fs_lock_to_input_path` | Frame Sync: Lock to Input Path | card | choice |
| 6415 | `fs_format_on_loss` | Frame Sync: Format on Loss of Input | path | choice |
| 5633 | `clear_crc_error_count` | Input Video: Clear CRC Error Count | card | trigger |
| 514 | `ip_address` | Network: IP Address | card | read-only |
| 515 | `subnet_mask` | Network: Subnet Mask | card | read-only |
| 516 | `default_gateway` | Network: Default Gateway | card | read-only |
| 517 | `dns_server` | Network: DNS Server | card | read-only |
| 5761 | `sdi_out_1_source` | Output Routing: SDI Output 1 | card | choice |
| 5769 | `sdi_out_1_enable` | Output Routing: SDI Output 1 Enabled/Disabled | card | choice |
| 5762 | `sdi_out_2_source` | Output Routing: SDI Output 2 | card | choice |
| 5770 | `sdi_out_2_enable` | Output Routing: SDI Output 2 Enabled/Disabled | card | choice |
| 5771 | `sdi_out_3_enable` | Output Routing: SDI Output 3 Enabled/Disabled | card | choice |
| 5763 | `sdi_out_3_source` | Output Routing: SDI Output 3 | card | choice |
| 5772 | `sdi_out_4_enable` | Output Routing: SDI Output 4 Enabled/Disabled | card | choice |
| 5764 | `sdi_out_4_source` | Output Routing: SDI Output 4 | card | choice |
| 5787 | `hdmi_out_1_enable` | Output Routing: HDMI Output 1 Enable/Disable | card | choice |
| 5779 | `hdmi_out_1_source` | Output Routing: HDMI Output 1 Scr Select | card | choice |
| 6081 | `hdmi_color_space` | HDMI: Color Space | card | choice |
| 6083 | `hdmi_colorimetry` | HDMI: Colorimetry | card | choice |
| 6082 | `hdmi_bit_depth` | HDMI: Bit Depth | card | choice |
| 6084 | `hdmi_range` | HDMI: Range | card | choice |
| 6048 | `hdmi_hdr_infoframe` | HDMI: HDR InfoFrame Insertion | card | choice |
| 6085 | `hdmi_audio_channels` | HDMI: Audio Channel Count | card | choice |
| 6049 | `hdmi_hdr_oetf` | HDMI: HDR InfoFrame OETF | card | choice |
| 6050 | `hdmi_hdr_gamut` | HDMI: HDR InfoFrame Gamut | card | choice |
| 6051 | `hdmi_red_x` | HDMI: Red x[2] | card | float |
| 6052 | `hdmi_red_y` | HDMI: Red y[2] | card | float |
| 6053 | `hdmi_green_x` | HDMI: Green x[0] | card | float |
| 6054 | `hdmi_green_y` | HDMI: Green y[0] | card | float |
| 6055 | `hdmi_blue_x` | HDMI: Blue x[1] | card | float |
| 6056 | `hdmi_blue_y` | HDMI: Blue y[1] | card | float |
| 6059 | `hdmi_mastering_lum_min` | HDMI: Display Mastering Luminance Min | card | float |
| 769 | `preset_name` | Presets: Preset Name | card | read-only |
| 770 | `preset_modify` | Presets: Modify Preset | card | trigger |
| 771 | `preset_save` | Presets: Save Preset | card | trigger |
| 772 | `preset_clear` | Presets: Clear Preset | card | trigger |
| 773 | `preset_cancel` | Presets: Cancel Action | card | trigger |
| 774 | `preset_load` | Presets: Load Preset | card | trigger |
| 768 | `preset_select` | Presets: Preset Select | card | choice |
| 6020 | `scaler_enable` | Scaler: Scaler | path | choice |
| 6018 | `scaler_output_format` | Scaler: Requested Output Format | path | choice |
| 6021 | `scaler_aspect_h` | Scaler: Aspect Ratio Horizontal | path | float |
| 6022 | `scaler_aspect_v` | Scaler: Aspect Ratio Vertical | path | float |
| 6025 | `scaler_downscale_sharpness` | Scaler: Downscale Filter Sharpness | path | float |
| 6026 | `scaler_p_to_i_sharpness` | Scaler: P to I Conversion Sharpness | path | float |
| 6023 | `scaler_deint_noise_reduction` | Scaler: Deinterlacer Temporal Noise Reduction | path | choice |
| 6024 | `scaler_deint_film_detect` | Scaler: Deinterlacer Film Rate Detection | path | choice |
| 5889 | `sdi_in_1_info` | Status: SDI IN 1 | card | read-only |
| 5890 | `sdi_in_2_info` | Status: SDI IN 2 | card | read-only |
| 5891 | `sdi_in_3_info` | Status: SDI IN 3 | card | read-only |
| 5892 | `sdi_in_4_info` | Status: SDI IN 4 | card | read-only |
| 5893 | `sdi_in_5_info` | Status: SDI IN 5 | card | read-only |
| 5944 | `madi_in_1_info` | Status: MADI IN 1 | card | read-only |
| 4608 | `sdi_emb_ch_1` | Audio Status: SDI Emb Ch 1 | card | read-only |
| 4609 | `sdi_emb_ch_2` | Audio Status: SDI Emb Ch 2 | card | read-only |
| 4610 | `sdi_emb_ch_3` | Audio Status: SDI Emb Ch 3 | card | read-only |
| 4611 | `sdi_emb_ch_4` | Audio Status: SDI Emb Ch 4 | card | read-only |
| 4612 | `sdi_emb_ch_5` | Audio Status: SDI Emb Ch 5 | card | read-only |
| 4613 | `sdi_emb_ch_6` | Audio Status: SDI Emb Ch 6 | card | read-only |
| 4614 | `sdi_emb_ch_7` | Audio Status: SDI Emb Ch 7 | card | read-only |
| 4615 | `sdi_emb_ch_8` | Audio Status: SDI Emb Ch 8 | card | read-only |
| 4616 | `sdi_emb_ch_9` | Audio Status: SDI Emb Ch 9 | card | read-only |
| 4617 | `sdi_emb_ch_10` | Audio Status: SDI Emb Ch 10 | card | read-only |
| 4618 | `sdi_emb_ch_11` | Audio Status: SDI Emb Ch 11 | card | read-only |
| 4619 | `sdi_emb_ch_12` | Audio Status: SDI Emb Ch 12 | card | read-only |
| 4620 | `sdi_emb_ch_13` | Audio Status: SDI Emb Ch 13 | card | read-only |
| 4621 | `sdi_emb_ch_14` | Audio Status: SDI Emb Ch 14 | card | read-only |
| 4622 | `sdi_emb_ch_15` | Audio Status: SDI Emb Ch 15 | card | read-only |
| 4623 | `sdi_emb_ch_16` | Audio Status: SDI Emb Ch 16 | card | read-only |
| 5634 / 5635 / 5636 / 5637 | `source` | Input Video: Source | perpath | choice |
| 5642 / 5643 / 5644 / 5645 | `source_colorimetry` | Input Video: Source Colorimetry | perpath | choice |
| 5646 / 5647 / 5648 / 5649 | `source_oetf` | Input Video: Source OETF | perpath | choice |
| 6432 / 6433 / 6434 / 6435 | `video_delay_status` | Frame Sync: Video Delay Status | perpath | read-only |
| 5664 / 5665 / 5666 / 5667 | `status` | Status: Path Status | perpath | read-only |
| 5638 / 5639 / 5640 / 5641 | `source_status` | Input Video: Source Status | perpath | read-only |
| 6624 / 6632 / 6640 / 6648 | `sdi_emb_1_2` | Status: SDI Emb 1/2 | perpath | read-only |
| 6625 / 6633 / 6641 / 6649 | `sdi_emb_3_4` | Status: SDI Emb 3/4 | perpath | read-only |
| 6626 / 6634 / 6642 / 6650 | `sdi_emb_5_6` | Status: SDI Emb 5/6 | perpath | read-only |
| 6627 / 6635 / 6643 / 6651 | `sdi_emb_7_8` | Status: SDI Emb 7/8 | perpath | read-only |
| 6628 / 6636 / 6644 / 6652 | `sdi_emb_9_10` | Status: SDI Emb 9/10 | perpath | read-only |
| 6629 / 6637 / 6645 / 6653 | `sdi_emb_11_12` | Status: SDI Emb 11/12 | perpath | read-only |
| 6630 / 6638 / 6646 / 6654 | `sdi_emb_13_14` | Status: SDI Emb 13/14 | perpath | read-only |
| 6631 / 6639 / 6647 / 6655 | `sdi_emb_15_16` | Status: SDI Emb 15/16 | perpath | read-only |
| 6436 / 6437 / 6438 / 6439 | `lock_status` | Frame Sync: Lock Status | perpath | read-only |
| 6440 / 6441 / 6442 / 6443 | `fs_alarm` | Frame Sync: Framesync Alarm | perpath | read-only |
| 4866 / 4867 / 4868 / 4869 | `path_name` | Status: Custom Path Name | perpath | read-only |
| 6027 | `scaler_vpid_colorimetry` | Scaler: ST352 VPID Colorimetry | path | choice |
| 6028 | `scaler_vpid_oetf` | Scaler: ST352 VPID OETF | path | choice |
| 7185 | `anc_did_1` | Ancillary: ANC 1 DID | path | int |
| 7186 | `anc_did_2` | Ancillary: ANC 2 DID | path | int |
| 7187 | `anc_did_3` | Ancillary: ANC 3 DID | path | int |
| 7188 | `anc_did_4` | Ancillary: ANC 4 DID | path | int |
| 7201 | `anc_sdid_1` | Ancillary: ANC 1 SDID | path | int |
| 7202 | `anc_sdid_2` | Ancillary: ANC 2 SDID | path | int |
| 7203 | `anc_sdid_3` | Ancillary: ANC 3 SDID | path | int |
| 7204 | `anc_sdid_4` | Ancillary: ANC 4 SDID | path | int |
| 7296 | `cc_remove_incoming` | Closed Captioning: Remove Incoming CC | path | choice |
| 7297 | `cc_regenerate_outgoing` | Closed Captioning: Regenerate Outgoing CC | path | choice |
| 7298 | `cc_hd_output_line` | Closed Captioning: HD CC Output Line Number | path | int |
| 258 | `supplier` | Status: Supplier | card | read-only |
| 1162 | `board_calibration` | Status: Board Calibration | card | read-only |
| 1072 | `license_3d_lut` | Status: Licensed Option (3D LUT) | card | read-only |
| 1073 | `license_color_proc` | Status: Licensed Option (Color Proc) | card | read-only |
| 5895 | `fiber_in_1_info` | Status: Fiber IN 1 | card | read-only |
| 5896 | `fiber_in_2_info` | Status: Fiber IN 2 | card | read-only |
| 5897 | `fiber_in_3_info` | Status: Fiber IN 3 | card | read-only |
| 5898 | `fiber_in_4_info` | Status: Fiber IN 4 | card | read-only |
| 5952 | `gpi_1` | Status: GPI 1 | card | read-only |
| 5953 | `gpi_2` | Status: GPI 2 | card | read-only |
| 5954 | `gpi_3` | Status: GPI 3 | card | read-only |
| 5955 | `gpi_4` | Status: GPI 4 | card | read-only |
| 5956 | `gpi_5` | Status: GPI 5 | card | read-only |
| 5957 | `gpi_6` | Status: GPI 6 | card | read-only |
