#!/usr/bin/env python3
"""Generate params.js for the Cobalt 9905-MPx Companion module from Cobalt's
OGCP-9000 model definition (models_9905MPX.txt).

usage: python3 gen_params.py models_9905MPX.txt params.js

Every parameter in the model file becomes one entry. The only hand-maintained
parts are below: the key each OID gets, its path scope, and the exclusions.
"""
import re, sys, json

src, dst = sys.argv[1], sys.argv[2]

# ---------------------------------------------------------------- scope rules
# 'path'    : card applies the write/read to whichever path was last selected
#             via oid 4864 (Path Select). CONFIRMED for every section below by
#             the card's own menu tree (2026-10 capture, FS37-40): each of these
#             menus starts with Path Select.
# 'perpath' : the model has a separate oid for each path (grouped here so an
#             action gets one Path dropdown instead of four actions).
# 'card'    : card-wide, no path select.
PATH_SCOPED_SECTIONS = {'Color Correction Proc', '3D-LUT', 'Frame Sync', 'Scaler', 'Ancillary Data'}
PATH_SCOPED_EXTRA = {6017, 6019}  # Input/Output Format status (listed under All Status, belongs to Scaler)
CONFIRMED_PATH = PATH_SCOPED_SECTIONS
# Listed under Frame Sync in the model, but the card shows them under
# "Global Framesync Controls", above Path Select.
CARD_OVERRIDE = {6402, 6414}

# Never exposed: these can knock the card off the network or wipe it.
EXCLUDE = {524: 'Ethernet Connection', 513: 'Address Mode', 518: 'NTP Source', 0x307: 'Restore Factory Defaults',
           4864: 'Path Select (managed internally by the module)',
           24324: 'Unused', 24326: 'Unused', 24328: 'Unused', 24330: 'Unused'}

# Triggers: write 1 to fire (choice 0=idle label, 1=busy label).
TRIGGERS = {6146, 6153, 0x1601, 0x302, 0x303, 0x304, 0x305, 0x306}

# Explicit keys. v1 keys are kept exactly so existing buttons keep working.
KEYS = {
    # Color Proc (v1)
    6145: 'video_proc_enable', 6146: 'proc_reset_to_unity', 6147: 'luma_gain', 6148: 'luma_lift',
    6149: 'color_gain', 6150: 'color_phase', 6151: 'gang_luma_color_gain',
    # Color Correction (v1)
    6152: 'color_corrector_enable', 6153: 'cc_reset_to_unity', 6154: 'red_black', 6155: 'green_black',
    6156: 'blue_black', 6157: 'red_gain', 6158: 'green_gain', 6159: 'blue_gain', 6160: 'red_gamma',
    6161: 'green_gamma', 6162: 'blue_gamma', 6163: 'gang_black_offset', 6164: 'gang_white_gain',
    6165: 'gang_gamma', 6166: 'black_hard_clip', 6167: 'white_hard_clip', 6168: 'white_soft_clip',
    6169: 'chroma_saturation_clip',
    # 3D LUT
    0x1881: 'lut_processing', 0x189e: 'lut_nbcu_status', 0x189d: 'lut_nbcu_select', 0x1895: 'lut_user_select',
    # Ancillary
    7233: 'anc_mode_1', 7234: 'anc_mode_2', 7235: 'anc_mode_3', 7236: 'anc_mode_4',
    0x1c31: 'anc_insert_1', 0x1c32: 'anc_insert_2', 0x1c33: 'anc_insert_3', 0x1c34: 'anc_insert_4',
    # Frame Sync
    6401: 'fs_enable', 6402: 'fs_lock_mode', 6404: 'fs_format_on_startup', 6405: 'fs_output_mode',
    6406: 'fs_mode_on_loss', 6408: 'fs_flat_field_color', 6409: 'fs_vertical_lines', 6410: 'fs_horizontal_us',
    6411: 'fs_frame_delay', 6412: 'fs_video_delay', 6413: 'fs_lock_status', 6414: 'fs_lock_to_input_path',
    6415: 'fs_format_on_loss',
    # Input Video
    0x1601: 'clear_crc_error_count',
    # Network (read-only info only)
    512: 'active_ip_address', 514: 'ip_address', 515: 'subnet_mask', 516: 'default_gateway', 517: 'dns_server',
    # Output routing
    5761: 'sdi_out_1_source', 5762: 'sdi_out_2_source', 5763: 'sdi_out_3_source', 5764: 'sdi_out_4_source',
    5769: 'sdi_out_1_enable', 5770: 'sdi_out_2_enable', 5771: 'sdi_out_3_enable', 5772: 'sdi_out_4_enable',
    5787: 'hdmi_out_1_enable', 5779: 'hdmi_out_1_source',
    # HDMI setup
    6081: 'hdmi_color_space', 6083: 'hdmi_colorimetry', 6082: 'hdmi_bit_depth', 6084: 'hdmi_range',
    6048: 'hdmi_hdr_infoframe', 6085: 'hdmi_audio_channels', 6049: 'hdmi_hdr_oetf', 6050: 'hdmi_hdr_gamut',
    6051: 'hdmi_red_x', 6052: 'hdmi_red_y', 6053: 'hdmi_green_x', 6054: 'hdmi_green_y', 6055: 'hdmi_blue_x',
    6056: 'hdmi_blue_y', 6059: 'hdmi_mastering_lum_min',
    # Presets
    0x301: 'preset_name', 0x302: 'preset_modify', 0x303: 'preset_save', 0x304: 'preset_clear',
    0x305: 'preset_cancel', 0x306: 'preset_load', 768: 'preset_select',
    # Scaler
    6020: 'scaler_enable', 6018: 'scaler_output_format', 6021: 'scaler_aspect_h', 6022: 'scaler_aspect_v',
    6025: 'scaler_downscale_sharpness', 6026: 'scaler_p_to_i_sharpness', 6023: 'scaler_deint_noise_reduction',
    6024: 'scaler_deint_film_detect',
    # Status
    261: 'product', 1033: 'display_name', 1025: 'serial_number', 267: 'firmware_revision', 1027: 'build_date',
    1028: 'hw_build', 1029: 'fpga', 1030: 'kernel_revision', 1040: 'event_log_1', 1041: 'event_log_2',
    1153: 'core_temp', 1154: 'ambient_temp', 1155: 'board_power', 6017: 'input_format', 6019: 'output_format',
    1156: 'reference_1', 1157: 'reference_2', 1158: 'timing_pll', 1159: 'tx_ref_clk_calibration',
    1160: 'sdi_tx_calibration', 1161: 'hdmi_tx_calibration', 6080: 'hdmi_output_format', 6086: 'hdmi_setup_status',
    6087: 'hdmi_sink_status', 1024: 'general', 24323: 'title_line_1', 24325: 'title_line_2', 24327: 'title_line_3',
    24329: 'title_line_4', 65281: 'displayed_product_name',
    5889: 'sdi_in_1_info', 5890: 'sdi_in_2_info', 5891: 'sdi_in_3_info', 5892: 'sdi_in_4_info',
    5893: 'sdi_in_5_info', 5944: 'madi_in_1_info',
}
for i in range(16):
    KEYS[4608 + i] = f'sdi_emb_ch_{i + 1}'

# Per-path groups: key -> (label, [oid path1..path4])
PERPATH = {
    'source': ('Source', [5634, 5635, 5636, 5637]),
    'source_colorimetry': ('Source Colorimetry', [5642, 5643, 5644, 5645]),
    'source_oetf': ('Source OETF', [5646, 5647, 5648, 5649]),
    'video_delay_status': ('Video Delay Status', [0x1920, 0x1921, 0x1922, 0x1923]),
    'status': ('Path Status', [5664, 5665, 5666, 5667]),
    # The model calls these "SDI IN 1-4 Status"; the card's Input Video menu shows
    # they are each path's Source Status ("1920x1080i 59.94 BT.709" / "Unknown").
    'source_status': ('Source Status', [5638, 5639, 5640, 5641]),
}
for j, pair in enumerate(['1_2', '3_4', '5_6', '7_8', '9_10', '11_12', '13_14', '15_16']):
    PERPATH[f'sdi_emb_{pair}'] = (f'SDI Emb {pair.replace("_", "/")}', [6624 + 8 * p + j for p in range(4)])

# Short category used in action/feedback/variable names in Companion
CATEGORY = {'All Status': 'Status', '3D-LUT': '3D LUT', 'Ancillary Data': 'Ancillary', 'Frame Sync': 'Frame Sync',
            'Input Video': 'Input Video', 'Network Settings': 'Network', 'Presets': 'Presets', 'Scaler': 'Scaler',
            'User Events': 'Status', 'Audio Status': 'Audio Status'}
SUB_CATEGORY = {'Color Proc': 'Color Proc', 'Color Correction': 'Color Correction',
                'Output Video Routing': 'Output Routing', 'HDMI Setup': 'HDMI'}

def category(p):
    return SUB_CATEGORY.get(p['sub']) or CATEGORY[p['section']]

# Float steps where the model's step is coarser than its own default value
STEP_OVERRIDE = {6051: 0.001, 6052: 0.001, 6053: 0.001, 6054: 0.001, 6055: 0.001, 6056: 0.001, 6059: 0.0001}
# Model says max 109 but default 109.1 — allow the default
MAX_OVERRIDE = {6167: 109.1, 6168: 109.1}

# ---------------------------------------------------------------- parse model
params, section, sub, cur = [], '', '', None
for ln in open(src, encoding='utf-8', errors='replace').read().splitlines():
    s = ln.strip()
    m = re.match(r'#{10,}\s+(.*)$', s)
    if m and m.group(1).strip():
        t = m.group(1).strip()
        if t.lower().startswith('sub-tab'):
            sub = t[7:].strip()
        else:
            section, sub = t, ''
        continue
    m = re.match(r'#{6,8}\s+(Sub-Tab\s+)?(.*)$', s)
    if m:
        if m.group(1):
            sub = m.group(2).strip()
        else:
            section, sub = m.group(2).strip(), ''
        continue
    if s.startswith('#'):
        continue
    m = re.match(r'parameter\s+(0x[0-9a-fA-F]+|\d+)\s+"([^"]*)"', s)
    if m:
        cur = dict(oid=int(m.group(1), 0), name=re.sub(r'\s+', ' ', m.group(2)).strip(), section=section,
                   sub=sub, type=None, readonly=False, choices=[])
        params.append(cur)
        continue
    if cur is None:
        continue
    m = re.match(r'choice\s+(-?\d+)\s+"([^"]*)"\s+"([^"]*)"', s)
    if m:
        cur['type'] = 'choice'
        short, disp = m.group(2), m.group(3)
        cur['choices'].append({'id': int(m.group(1)), 'label': disp if disp == short else f'{short} — {disp}'})
        continue
    m = re.match(r'(float|int)\s+(\S+)\s+(\S+)\s+(\S+)(.*)', s)
    if m:
        cur.update(type=m.group(1), max=float(m.group(2)), min=float(m.group(3)), step=float(m.group(4)))
        d = re.search(r'default\s+(\S+)', m.group(5))
        u = re.search(r'unit\s+(\S+)', m.group(5))
        cur['default'] = float(d.group(1)) if d else None
        unit = u.group(1) if u else None
        cur['unit'] = unit if unit and not re.match(r'^[\d.]+$', unit) else None
        continue
    if s.startswith('string'):
        cur['type'] = 'string'
        continue
    if s == 'readonly':
        cur['readonly'] = True
        continue
    if s:
        sys.exit(f'unparsed model line: {s!r}')

byoid = {p['oid']: p for p in params}
grouped = {o for _, (_, oids) in PERPATH.items() for o in oids}
missing = [p for p in params if p['oid'] not in KEYS and p['oid'] not in grouped and p['oid'] not in EXCLUDE]
if missing:
    sys.exit('no key for: ' + ', '.join(f"{p['oid']} {p['name']}" for p in missing))

out = []

def finish(e, p):
    t = p['type']
    if p.get('oid') in TRIGGERS:
        t = 'trigger'
    e['type'] = t
    e['readonly'] = p['readonly']
    if t in ('choice', 'trigger'):
        e['choices'] = p['choices']
    if t in ('float', 'int'):
        e['min'] = p['min']
        e['max'] = MAX_OVERRIDE.get(p['oid'], p['max'])
        e['step'] = STEP_OVERRIDE.get(p['oid'], p['step'])
        e['default'] = p['default'] if p['default'] is not None else e['min']
        if p.get('unit'):
            e['unit'] = p['unit']
    return e

for p in params:
    o = p['oid']
    if o in EXCLUDE or o in grouped:
        continue
    scope = 'path' if (p['section'] in PATH_SCOPED_SECTIONS or o in PATH_SCOPED_EXTRA) else 'card'
    if o in CARD_OVERRIDE:
        scope = 'card'
    e = dict(key=KEYS[o], oid=o, name=p['name'], category=category(p), scope=scope)
    if scope == 'path':
        e['confirmed'] = p['section'] in CONFIRMED_PATH or o in PATH_SCOPED_EXTRA  # 6017/6019 are in the card's Scaler menu
    out.append(finish(e, p))

for key, (label, oids) in PERPATH.items():
    first = byoid[oids[0]]
    for o in oids[1:]:
        q = byoid[o]
        assert q['type'] == first['type'] and q['choices'] == first['choices'], (key, o)
    e = dict(key=key, oids=oids, name=label, category=category(first), scope='perpath')
    out.append(finish(e, dict(first, oid=None)))

# ------------------------------------------------- not in the model file
# Seen in the card's own parameter list (rosetta "oids":"all" capture, fw on FS37-40).
EXTRA = [
    dict(key='lock_status', oids=[6436, 6437, 6438, 6439], name='Lock Status', category='Frame Sync', scope='perpath',
         type='string', readonly=True),
    dict(key='fs_alarm', oids=[6440, 6441, 6442, 6443], name='Framesync Alarm', category='Frame Sync', scope='perpath',
         type='alarm', readonly=True,
         alarms=[{'bit': 0, 'severity': 'success', 'label': 'OK'},
                 {'bit': 1, 'severity': 'error', 'label': 'Rate Mismatch'},
                 {'bit': 2, 'severity': 'warn', 'label': 'Incompatible Reference'}]),
    dict(key='path_name', oids=[4866, 4867, 4868, 4869], name='Custom Path Name', category='Status', scope='perpath',
         type='string', readonly=True),
    dict(key='scaler_vpid_colorimetry', oid=6027, name='ST352 VPID Colorimetry', category='Scaler', scope='path',
         confirmed=True, type='choice', readonly=False,
         choices=[{'id': 0, 'label': 'Auto'}, {'id': 2, 'label': 'BT.709'}, {'id': 3, 'label': 'BT.2020'}]),
    dict(key='scaler_vpid_oetf', oid=6028, name='ST352 VPID OETF', category='Scaler', scope='path', confirmed=True,
         type='choice', readonly=False,
         choices=[{'id': 0, 'label': 'Auto'}, {'id': 1, 'label': 'SDR'}, {'id': 2, 'label': 'PQ/ST 2084'},
                  {'id': 3, 'label': 'HLG'}]),
    # Ancillary Data: the card lists 4 ANC bridge entries per path after Path Select.
] + [
    dict(key=f'anc_did_{n}', oid=7184 + n, name=f'ANC {n} DID', category='Ancillary', scope='path', confirmed=True,
         type='int', readonly=False, min=0, max=255, step=1, default=0) for n in range(1, 5)
] + [
    dict(key=f'anc_sdid_{n}', oid=7200 + n, name=f'ANC {n} SDID', category='Ancillary', scope='path', confirmed=True,
         type='int', readonly=False, min=0, max=255, step=1, default=0) for n in range(1, 5)
] + [
    # Closed Captioning menu: also listed after Path Select.
    dict(key='cc_remove_incoming', oid=7296, name='Remove Incoming CC', category='Closed Captioning', scope='path',
         confirmed=True, type='choice', readonly=False,
         choices=[{'id': 0, 'label': 'Disabled'}, {'id': 1, 'label': 'Enabled'}]),
    dict(key='cc_regenerate_outgoing', oid=7297, name='Regenerate Outgoing CC', category='Closed Captioning',
         scope='path', confirmed=True, type='choice', readonly=False,
         choices=[{'id': 0, 'label': 'Disabled'}, {'id': 1, 'label': 'Enabled'}]),
    dict(key='cc_hd_output_line', oid=7298, name='HD CC Output Line Number', category='Closed Captioning',
         scope='path', confirmed=True, type='int', readonly=False, min=9, max=41, step=1, default=9),
    dict(key='supplier', oid=258, name='Supplier', category='Status', scope='card', type='string', readonly=True),
    dict(key='board_calibration', oid=1162, name='Board Calibration', category='Status', scope='card', type='string',
         readonly=True),
    dict(key='license_3d_lut', oid=1072, name='Licensed Option (3D LUT)', category='Status', scope='card',
         type='string', readonly=True),
    dict(key='license_color_proc', oid=1073, name='Licensed Option (Color Proc)', category='Status', scope='card',
         type='string', readonly=True),
] + [
    dict(key=f'fiber_in_{n}_info', oid=5894 + n, name=f'Fiber IN {n}', category='Status', scope='card',
         type='string', readonly=True) for n in range(1, 5)
] + [
    dict(key=f'gpi_{n}', oid=5951 + n, name=f'GPI {n}', category='Status', scope='card', type='string',
         readonly=True) for n in range(1, 7)
]
out += EXTRA

# Choices the card reports that the model file doesn't list
for e in out:
    if e['key'] == 'lut_processing':
        e['choices'].append({'id': 5, 'label': 'Other LUT'})
    if e['key'] == 'active_ip_address':
        e['format'] = 'ip'

keys = [e['key'] for e in out]
oids = [o for e in out for o in (e.get('oids') or [e['oid']])]
assert len(oids) == len(set(oids)), 'duplicate oids'
assert len(keys) == len(set(keys)), 'duplicate keys'

with open(dst, 'w') as f:
    f.write('// GENERATED by tools/gen_params.py from models_9905MPX.txt — do not edit by hand.\n')
    f.write('// scope: "path" = needs Path Select (oid 4864) first; "perpath" = one oid per path; "card" = card-wide.\n')
    f.write('// confirmed:false marks a path scope that is assumed, not yet verified on a real card.\n\n')
    f.write('module.exports = ' + json.dumps(out, indent='\t') + '\n')

import collections
print('entries', len(out), collections.Counter((e['scope'], e['type'], e['readonly']) for e in out))
print('writable', sum(not e['readonly'] for e in out), 'excluded', sorted(EXCLUDE.values()))
