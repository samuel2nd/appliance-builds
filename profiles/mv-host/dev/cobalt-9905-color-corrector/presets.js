const { combineRgb } = require('@companion-module/base')
const PARAMS = require('./params')
const { PATH_CHOICES } = require('./actions')

const MODULE_ID = 'cobalt-9905-color-corrector' // must match companion/manifest.json "id"
const BY_KEY = Object.fromEntries(PARAMS.map((p) => [p.key, p]))
const v = (path, key) => `$(${MODULE_ID}:path${path + 1}_${key})`
const vc = (key) => `$(${MODULE_ID}:${key})`

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const GREEN = combineRgb(0, 150, 0)
const DARK = combineRgb(40, 40, 40)
const ON = { bgcolor: GREEN, color: WHITE }

function button(category, name, text, down, extra = {}) {
	return {
		type: 'button',
		category,
		name,
		style: { text, size: extra.size || '14', color: WHITE, bgcolor: extra.bgcolor ?? DARK },
		steps: [{ down, up: extra.up || [] }],
		feedbacks: extra.feedbacks || [],
		...(extra.options ? { options: extra.options } : {}),
	}
}

// Short on-button text from a choice label: "1 — ESPN 3C SDR2HLG_DIRECT" -> "ESPN 3C SDR2HLG DIRECT"
const shortLabel = (label) => (label.includes(' — ') ? label.split(' — ')[1] : label).replace(/_/g, ' ')

// ---------------------------------------------------------------- v1 presets

function buildParamPresets(presets, path, pathLabel, category, paramList) {
	for (const p of paramList) {
		presets[`p${path}_${p.key}_inc`] = {
			type: 'button',
			category,
			name: `${pathLabel} ${p.label} +${p.buttonStep}`,
			style: {
				text: `${p.label} +${p.buttonStep}\n${v(path, p.key)}`,
				size: '14',
				color: WHITE,
				bgcolor: combineRgb(0, 100, 0),
			},
			steps: [{ down: [{ actionId: p.actionId, options: { path, delta: p.buttonStep } }], up: [] }],
			feedbacks: [],
		}
		presets[`p${path}_${p.key}_dec`] = {
			type: 'button',
			category,
			name: `${pathLabel} ${p.label} -${p.buttonStep}`,
			style: {
				text: `${p.label} -${p.buttonStep}\n${v(path, p.key)}`,
				size: '14',
				color: WHITE,
				bgcolor: combineRgb(100, 0, 0),
			},
			steps: [{ down: [{ actionId: p.actionId, options: { path, delta: -p.buttonStep } }], up: [] }],
			feedbacks: [],
		}
		// Dial: rotate = relative, press = reset to default, release = resync.
		presets[`p${path}_${p.key}_dial`] = {
			type: 'button',
			category,
			name: `${pathLabel} ${p.label} (Dial only — no display)`,
			options: { rotaryActions: true },
			style: { text: `${p.label}\n${v(path, p.key)}`, size: '14', color: WHITE, bgcolor: BLACK },
			steps: [
				{
					down: [{ actionId: p.key, options: { path, value: BY_KEY[p.key].default } }],
					up: [{ actionId: 'resync_path', options: { path } }],
					rotate_left: [{ actionId: p.actionId, options: { path, delta: -p.dialStep } }],
					rotate_right: [{ actionId: p.actionId, options: { path, delta: p.dialStep } }],
				},
			],
			feedbacks: [],
		}
		presets[`p${path}_${p.key}_display`] = {
			type: 'button',
			category,
			name: `${pathLabel} ${p.label} (Strip Display)`,
			style: { text: `${p.label}\n${v(path, p.key)}`, size: 'auto', color: WHITE, bgcolor: p.stripColor || BLACK },
			steps: [{ down: [{ actionId: 'resync_path', options: { path } }], up: [] }],
			feedbacks: [],
		}
	}
}

function addV1Presets(presets) {
	const colorProcParams = [
		{ key: 'luma_gain', actionId: 'luma_gain_relative', label: 'Luma Gain', buttonStep: 5, dialStep: 1 },
		{ key: 'luma_lift', actionId: 'luma_lift_relative', label: 'Luma Lift', buttonStep: 5, dialStep: 1 },
		{ key: 'color_gain', actionId: 'color_gain_relative', label: 'Color Gain', buttonStep: 5, dialStep: 1 },
		{ key: 'color_phase', actionId: 'color_phase_relative', label: 'Color Phase', buttonStep: 10, dialStep: 1 },
	]
	const RED_BG = combineRgb(150, 30, 30)
	const GREEN_BG = combineRgb(20, 110, 20)
	const BLUE_BG = combineRgb(30, 30, 160)
	const rgb = (ch, kind, label, bg, buttonStep, dialStep) => ({
		key: `${ch}_${kind}`,
		actionId: `${ch}_${kind}_relative`,
		label,
		buttonStep,
		dialStep,
		stripColor: bg,
	})
	const colorCorrectionParams = [
		rgb('red', 'black', 'Red Black', RED_BG, 5, 1),
		rgb('green', 'black', 'Green Black', GREEN_BG, 5, 1),
		rgb('blue', 'black', 'Blue Black', BLUE_BG, 5, 1),
		rgb('red', 'gain', 'Red Gain', RED_BG, 5, 1),
		rgb('green', 'gain', 'Green Gain', GREEN_BG, 5, 1),
		rgb('blue', 'gain', 'Blue Gain', BLUE_BG, 5, 1),
		rgb('red', 'gamma', 'Red Gamma', RED_BG, 0.1, 0.01),
		rgb('green', 'gamma', 'Green Gamma', GREEN_BG, 0.1, 0.01),
		rgb('blue', 'gamma', 'Blue Gamma', BLUE_BG, 0.1, 0.01),
	]

	for (const { id: path, label: pathLabel } of PATH_CHOICES) {
		const procCategory = `${pathLabel} — Color Proc`
		const ccCategory = `${pathLabel} — Color Correction`
		buildParamPresets(presets, path, pathLabel, procCategory, colorProcParams)
		buildParamPresets(presets, path, pathLabel, ccCategory, colorCorrectionParams)

		const simple = (id, category, name, text, actionId, options, bgcolor) =>
			(presets[id] = button(category, name, text, [{ actionId, options }], { bgcolor }))
		simple(
			`p${path}_reset`,
			procCategory,
			`${pathLabel} Reset to Unity`,
			`${pathLabel}\nProc Reset`,
			'proc_reset_to_unity',
			{ path },
			combineRgb(50, 50, 50),
		)
		simple(
			`p${path}_enable`,
			procCategory,
			`${pathLabel} Video Proc Enable`,
			`${pathLabel}\nEnable`,
			'video_proc_enable',
			{ path, value: 1 },
			combineRgb(0, 80, 0),
		)
		simple(
			`p${path}_disable`,
			procCategory,
			`${pathLabel} Video Proc Disable`,
			`${pathLabel}\nDisable`,
			'video_proc_enable',
			{ path, value: 0 },
			combineRgb(80, 0, 0),
		)
		simple(
			`p${path}_cc_reset`,
			ccCategory,
			`${pathLabel} CC Reset to Unity`,
			`${pathLabel}\nCC Reset`,
			'cc_reset_to_unity',
			{ path },
			combineRgb(50, 50, 50),
		)
		simple(
			`p${path}_cc_enable`,
			ccCategory,
			`${pathLabel} Color Corrector Enable`,
			`${pathLabel}\nCC Enable`,
			'color_corrector_enable',
			{ path, value: 1 },
			combineRgb(0, 80, 0),
		)
		simple(
			`p${path}_cc_disable`,
			ccCategory,
			`${pathLabel} Color Corrector Disable`,
			`${pathLabel}\nCC Disable`,
			'color_corrector_enable',
			{ path, value: 0 },
			combineRgb(80, 0, 0),
		)
		simple(
			`p${path}_activate`,
			procCategory,
			`${pathLabel} ACTIVATE PATH (press on page load)`,
			`ACTIVATE\n${pathLabel}`,
			'resync_path',
			{ path },
			combineRgb(0, 60, 120),
		)
		presets[`p${path}_readout`] = button(
			procCategory,
			`${pathLabel} Readout`,
			`${pathLabel}\nG:${v(path, 'luma_gain')} L:${v(path, 'luma_lift')}\nCG:${v(path, 'color_gain')} CP:${v(path, 'color_phase')}`,
			[{ actionId: 'resync_path', options: { path } }],
			{ size: '7', bgcolor: BLACK },
		)
	}
}

// ---------------------------------------------------------------- v2 presets

// One button per choice of a setting, lit when that choice is active.
function choiceButtons(presets, idPrefix, category, key, path, opts = {}) {
	const p = BY_KEY[key]
	const pathed = p.scope !== 'card'
	for (const c of p.choices) {
		if (opts.skip && opts.skip(c)) continue
		const options = pathed ? { path, value: c.id } : { value: c.id }
		presets[`${idPrefix}_${key}_${c.id}`] = button(
			category,
			`${pathed ? `Path ${path + 1} ` : ''}${p.name}: ${c.label}`,
			`${opts.title ?? p.name}\n${opts.text ? opts.text(c) : c.label}`,
			[{ actionId: key, options }],
			{ size: opts.size || 'auto', feedbacks: [{ feedbackId: `${key}_is`, options, style: ON }] },
		)
	}
}

function displayButton(category, name, text, down = []) {
	return button(category, name, text, down, { size: 'auto', bgcolor: BLACK })
}

function addV2Presets(presets) {
	for (const { id: path, label: pathLabel } of PATH_CHOICES) {
		const pre = `p${path}`

		// ---- 3D LUT
		const lutCat = `${pathLabel} — 3D LUT`
		choiceButtons(presets, pre, lutCat, 'lut_processing', path, { title: 'LUT' })
		for (const c of BY_KEY.lut_user_select.choices) {
			presets[`${pre}_lut_user_${c.id}`] = button(
				lutCat,
				`${pathLabel} User LUT ${c.label}`,
				`USER ${c.id + 1}\n${shortLabel(c.label)}`,
				[{ actionId: 'lut_recall_user', options: { path, lut: c.id } }],
				{ size: 'auto', feedbacks: [{ feedbackId: 'lut_user_active', options: { path, lut: c.id }, style: ON }] },
			)
		}
		for (const c of BY_KEY.lut_nbcu_select.choices) {
			presets[`${pre}_lut_nbcu_${c.id}`] = button(
				lutCat,
				`${pathLabel} NBCU LUT ${c.label}`,
				`NBCU\n${shortLabel(c.label).replace(/^\d+-NBCU /, '')}`,
				[{ actionId: 'lut_recall_nbcu', options: { path, lut: c.id } }],
				{ size: 'auto', feedbacks: [{ feedbackId: 'lut_nbcu_active', options: { path, lut: c.id }, style: ON }] },
			)
		}
		presets[`${pre}_lut_status`] = displayButton(
			lutCat,
			`${pathLabel} LUT status`,
			`${v(path, 'lut_processing')}\n${v(path, 'lut_nbcu_status')}`,
			[{ actionId: 'resync_path', options: { path } }],
		)
		presets[`${pre}_lut_user_dial`] = {
			type: 'button',
			category: lutCat,
			name: `${pathLabel} User LUT dial (turn = step LUT live, press = User LUT on)`,
			options: { rotaryActions: true },
			style: { text: `USER LUT\n${v(path, 'lut_user_select')}`, size: 'auto', color: WHITE, bgcolor: BLACK },
			steps: [
				{
					down: [{ actionId: 'lut_processing', options: { path, value: 2 } }],
					up: [],
					rotate_left: [{ actionId: 'lut_user_select_step', options: { path, direction: -1, wrap: false } }],
					rotate_right: [{ actionId: 'lut_user_select_step', options: { path, direction: 1, wrap: false } }],
				},
			],
			feedbacks: [{ feedbackId: 'lut_processing_is', options: { path, value: 2 }, style: ON }],
		}

		// ---- HDR input tagging + source
		const hdrCat = `${pathLabel} — HDR / Input`
		choiceButtons(presets, pre, hdrCat, 'source_oetf', path, { title: 'OETF' })
		choiceButtons(presets, pre, hdrCat, 'source_colorimetry', path, { title: 'GAMUT' })
		choiceButtons(presets, pre, hdrCat, 'source', path, { title: 'SOURCE' })

		// ---- Frame sync
		const fsCat = `${pathLabel} — Frame Sync`
		choiceButtons(presets, pre, fsCat, 'fs_output_mode', path, { title: 'OUTPUT' })
		choiceButtons(presets, pre, fsCat, 'fs_enable', path, {
			title: 'FRAMESYNC',
			text: (c) => c.label.replace('Framesync ', ''),
		})
		presets[`${pre}_fs_delay_dial`] = {
			type: 'button',
			category: fsCat,
			name: `${pathLabel} Frame Delay dial (press = 1 frame)`,
			options: { rotaryActions: true },
			style: { text: `DELAY\n${v(path, 'fs_frame_delay')} fr`, size: 'auto', color: WHITE, bgcolor: BLACK },
			steps: [
				{
					down: [{ actionId: 'fs_frame_delay', options: { path, value: 1 } }],
					up: [],
					rotate_left: [{ actionId: 'fs_frame_delay_relative', options: { path, delta: -1 } }],
					rotate_right: [{ actionId: 'fs_frame_delay_relative', options: { path, delta: 1 } }],
				},
			],
			feedbacks: [],
		}
		presets[`${pre}_fs_status`] = displayButton(
			fsCat,
			`${pathLabel} Frame Sync status`,
			`${v(path, 'fs_lock_status')}\n${v(path, 'video_delay_status')}`,
			[{ actionId: 'resync_path', options: { path } }],
		)
	}

	// ---- status wall tiles
	for (const { id: path, label: pathLabel } of PATH_CHOICES) {
		presets[`p${path}_wall_tile`] = {
			type: 'button',
			category: 'Status Wall',
			name: `${pathLabel} status tile (green OK / yellow not zero / red problem)`,
			style: {
				text: `${v(path, 'path_name')}\n${v(path, 'input_short')}\n${v(path, 'output_short')}`,
				size: 'auto',
				color: WHITE,
				bgcolor: combineRgb(50, 50, 50),
			},
			steps: [{ down: [{ actionId: 'resync_path', options: { path } }], up: [] }],
			feedbacks: [
				{ feedbackId: 'path_input_ok', options: { path }, style: { bgcolor: combineRgb(0, 120, 0), color: WHITE } },
				{ feedbackId: 'path_not_zero', options: { path }, style: { bgcolor: combineRgb(230, 180, 0), color: BLACK } },
				{ feedbackId: 'path_problem', options: { path }, style: { bgcolor: combineRgb(200, 0, 0), color: WHITE } },
			],
		}
	}
	presets.card_resync_all = button('Status Wall', 'Resync all 4 paths', 'REFRESH\nALL PATHS', [
		{ actionId: 'resync_all', options: {} },
		{ actionId: 'refresh_status', options: {} },
	])

	// ---- card-wide
	const routeCat = 'Card — Output Routing'
	for (const n of [1, 2, 3, 4])
		choiceButtons(presets, 'card', routeCat, `sdi_out_${n}_source`, 0, { title: `SDI OUT ${n}` })
	choiceButtons(presets, 'card', routeCat, 'hdmi_out_1_source', 0, { title: 'HDMI OUT' })

	const hdmiCat = 'Card — HDMI'
	choiceButtons(presets, 'card', hdmiCat, 'hdmi_hdr_infoframe', 0, { title: 'HDR INFOFRAME' })
	choiceButtons(presets, 'card', hdmiCat, 'hdmi_hdr_oetf', 0, {
		title: 'HDR OETF',
		skip: (c) => /Reserved/.test(c.label),
	})
	choiceButtons(presets, 'card', hdmiCat, 'hdmi_colorimetry', 0, { title: 'HDMI GAMUT' })

	const presetCat = 'Card — Presets'
	for (let n = 1; n <= 10; n++) {
		presets[`card_preset_recall_${n}`] = button(presetCat, `Recall card preset ${n}`, `RECALL\nPRESET ${n}`, [
			{ actionId: 'preset_recall', options: { preset: n } },
		])
	}
	presets.card_preset_name = displayButton(presetCat, 'Preset name', `PRESET\n${vc('preset_name')}`)

	const statusCat = 'Card — Status'
	presets.card_status_health = displayButton(
		statusCat,
		'Card health (temps + power)',
		`CORE ${vc('core_temp')}\nAMB ${vc('ambient_temp')}\n${vc('board_power')} W`,
		[{ actionId: 'refresh_status', options: {} }],
	)
	presets.card_status_refs = displayButton(
		statusCat,
		'References',
		`REF1 ${vc('reference_1')}\nREF2 ${vc('reference_2')}`,
	)
	for (const n of [1, 2, 3, 4, 5]) {
		presets[`card_status_sdi_in_${n}`] = displayButton(
			statusCat,
			`SDI IN ${n}`,
			`SDI IN ${n}\n${vc(`sdi_in_${n}_info`)}`,
		)
	}
	presets.card_status_firmware = displayButton(statusCat, 'Firmware', `FW\n${vc('firmware_revision')}`)
}

function buildPresets() {
	const presets = {}
	addV1Presets(presets)
	addV2Presets(presets)
	return presets
}

module.exports = { buildPresets }
