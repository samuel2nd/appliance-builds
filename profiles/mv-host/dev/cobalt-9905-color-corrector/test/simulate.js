// Simulated 9905-MPx card + stubbed Companion runtime.
// Run: npm test   (no real card needed)
process.env.COMPANION_MODULE_ENTRY = 'test'
const Module = require('module')
const assert = require('assert')
const { WebSocketServer } = require('ws')

// ---- stub @companion-module/base -------------------------------------------
const realBase = require('@companion-module/base')
class FakeBase {
	constructor() {
		this.vars = {}
		this.varDefs = []
		this.checked = new Set()
		this.statusLog = []
	}
	setVariableDefinitions(d) {
		this.varDefs = d
	}
	setVariableValues(v) {
		Object.assign(this.vars, v)
	}
	setActionDefinitions(a) {
		this.actions = a
	}
	setFeedbackDefinitions(f) {
		this.feedbacks = f
	}
	setPresetDefinitions(p) {
		this.presets = p
	}
	checkFeedbacks(...ids) {
		ids.forEach((i) => this.checked.add(i))
	}
	saveConfig(c) {
		this.savedConfig = c
	}
	updateStatus(s, m) {
		this.statusLog.push(s + (m ? ` ${m}` : ''))
	}
	log(level, msg) {
		if (level === 'error') console.log('  [module error]', msg)
	}
}
const origLoad = Module._load
Module._load = function (req, ...rest) {
	if (req === '@companion-module/base') {
		return { ...realBase, InstanceBase: FakeBase, runEntrypoint: () => {} }
	}
	return origLoad.call(this, req, ...rest)
}
const { Cobalt9905Instance, PARAMS, BY_KEY, PATH_SELECT_OID } = require('../main.js')

// ---- simulated card ---------------------------------------------------------
// Values below are copied from a real capture of Frame 2 slot 12 (FS37-40):
// FS37 1080i SDR, FS38 1080p HLG, FS39/40 no input.
const icon = (display, color) => ({ display, hints: { 'background-color': color } })
const FORMAT_LABEL = Object.fromEntries(
	PARAMS.find((p) => p.key === 'scaler_output_format').choices.map((c) => [c.id, c.label]),
)
function startCard(port) {
	const pathScoped = new Set(PARAMS.filter((p) => p.scope === 'path').map((p) => p.oid))
	const card = { path: 3, perPath: [new Map(), new Map(), new Map(), new Map()], cardWide: new Map(), writes: [] }
	for (const p of PARAMS) {
		const init =
			p.type === 'string'
				? `${p.name} OK`
				: p.type === 'choice'
					? p.choices[0].id
					: p.type === 'trigger'
						? 0
						: p.default
		if (p.scope === 'path') card.perPath.forEach((m, i) => m.set(p.oid, p.type === 'float' ? init + i : init))
		else (p.oids || [p.oid]).forEach((o) => card.cardWide.set(o, init))
	}
	const real = {
		5638: icon('1920x1080i 59.94 BT.709', 'green'),
		5639: icon('1920x1080p 59.94 A BT.2020', 'green'),
		5640: icon('Unknown', 'red'),
		5641: icon('Unknown', 'red'),
		5889: icon('1920x1080i 59.94 BT.709 SDR 00:07:31:17 0 Errors', 'green'),
		5890: icon('1920x1080p 59.94 A BT.2020 HLG 00:03:29:18 0 Errors', 'green'),
		5891: icon('Unlocked', 'yellow'),
		5892: icon('Unlocked', 'yellow'),
		5893: icon('Unlocked', 'yellow'),
		6436: icon('Framesync Locked to Reference 1', 'green'),
		6437: icon('Framesync Locked to Reference 1', 'green'),
		6438: icon('Framesync Locked to Reference 1', 'green'),
		6439: icon('Framesync Locked to Reference 1', 'green'),
		6440: 1,
		6441: 1,
		6442: 1,
		6443: 1,
		4866: 'FS 37',
		4867: 'FS 38',
		4868: 'FS 39',
		4869: 'FS 40',
		5634: 0,
		5635: 1,
		5636: 2,
		5637: 3,
		512: -1073741222, // 192.0.2.90 (RFC 5737 documentation address)
		1153: 59,
		1155: 37.209377,
	}
	for (const [oid, v] of Object.entries(real)) card.cardWide.set(Number(oid), v)
	card.perPath.forEach((m) => {
		m.set(6020, 1) // scaler on
		m.set(6018, 28) // 1080p59.94 A
		m.set(6411, 0) // frame delay 0, like the real card
	})
	const outputFormat = (m) => (m.get(6020) === 1 ? FORMAT_LABEL[m.get(6018)] : m.get(6017))
	const get = (oid) => {
		if (oid === 6019) return outputFormat(card.perPath[card.path])
		return pathScoped.has(oid) ? card.perPath[card.path].get(oid) : card.cardWide.get(oid)
	}
	const UNITY = { 6147: 100, 6148: 0, 6149: 100, 6150: 0 }
	const CC_UNITY = { 6154: 0, 6155: 0, 6156: 0, 6157: 100, 6158: 100, 6159: 100, 6160: 1, 6161: 1, 6162: 1 }
	// Triggers complete a moment later, on whatever path is selected THEN (like the
	// card's "Applying..." state) — this is what the settle delay protects against.
	const later = (ms, fn) => setTimeout(fn, ms)
	const wss = new WebSocketServer({ port, path: '/rosetta_api/slots/2' })
	wss.on('connection', (ws) => {
		const tele = setInterval(() => {
			ws.send(JSON.stringify({ parameters: [{ oid: 1155, value: 37 + Math.random() }] }))
		}, 40)
		ws.on('close', () => clearInterval(tele))
		let chain = Promise.resolve()
		ws.on('message', (raw) => {
			const msg = JSON.parse(raw)
			chain = chain.then(async () => {
				if (msg.method === 'post') {
					for (const { oid, value } of msg.parameters) {
						if (oid === PATH_SELECT_OID) {
							card.path = value
							continue
						}
						card.writes.push({ oid, value, path: card.path })
						if (oid === 6146 && value === 1)
							later(60, () => Object.entries(UNITY).forEach(([o, v]) => card.perPath[card.path].set(+o, v)))
						else if (oid === 6153 && value === 1)
							later(60, () => Object.entries(CC_UNITY).forEach(([o, v]) => card.perPath[card.path].set(+o, v)))
						else if (oid === 774 && value === 1) {
							const preset = card.cardWide.get(768)
							later(300, () =>
								card.perPath.forEach((m) => {
									m.set(6018, preset === 2 ? 12 : preset === 3 ? 9 : 28)
									Object.entries({ ...UNITY, ...CC_UNITY }).forEach(([o, v]) => m.set(+o, v))
								}),
							)
						} else if (pathScoped.has(oid)) card.perPath[card.path].set(oid, value)
						else card.cardWide.set(oid, value)
					}
					ws.send(JSON.stringify({ id: msg.id, success: true, changed: msg.parameters.map((p) => ({ oid: p.oid })) }))
				} else if (msg.method === 'get') {
					const snapshot = msg.oids.map((oid) => ({ oid, value: get(oid) }))
					await new Promise((r) => setTimeout(r, Math.random() * 15))
					ws.send(JSON.stringify({ id: msg.id, parameters: snapshot }))
				}
			})
		})
	})
	return { card, wss }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const idle = async (inst) => {
	await sleep(30)
	await inst.queue
	await sleep(60)
}

;(async () => {
	const PORT = 18905
	const { card, wss } = startCard(PORT)
	const inst = new Cobalt9905Instance()
	await inst.init({ host: `127.0.0.1:${PORT}`, slot: '2', poll_interval: 0.2 })
	// Regex.IP rejects nothing here; we just need the socket
	await sleep(300)
	await idle(inst)
	let pass = 0
	const ok = (name) => (pass++, console.log('  ✓', name))

	// 1. definitions -----------------------------------------------------------
	const v1Actions = [
		'video_proc_enable',
		'proc_reset_to_unity',
		'luma_gain',
		'luma_gain_relative',
		'luma_lift',
		'luma_lift_relative',
		'color_gain',
		'color_gain_relative',
		'color_phase',
		'color_phase_relative',
		'gang_luma_color_gain',
		'color_corrector_enable',
		'cc_reset_to_unity',
		'red_black',
		'red_black_relative',
		'green_black',
		'green_black_relative',
		'blue_black',
		'blue_black_relative',
		'red_gain',
		'red_gain_relative',
		'green_gain',
		'green_gain_relative',
		'blue_gain',
		'blue_gain_relative',
		'red_gamma',
		'red_gamma_relative',
		'green_gamma',
		'green_gamma_relative',
		'blue_gamma',
		'blue_gamma_relative',
		'gang_black_offset',
		'gang_white_gain',
		'gang_gamma',
		'black_hard_clip',
		'white_hard_clip',
		'white_soft_clip',
		'chroma_saturation_clip',
		'resync_path',
	]
	for (const a of v1Actions) assert(inst.actions[a], `missing v1 action ${a}`)
	// v1 option ids unchanged
	assert.deepStrictEqual(
		inst.actions.luma_gain.options.map((o) => o.id),
		['path', 'value'],
	)
	assert.deepStrictEqual(
		inst.actions.luma_gain_relative.options.map((o) => o.id),
		['path', 'delta'],
	)
	assert.deepStrictEqual(
		inst.actions.video_proc_enable.options.map((o) => o.id),
		['path', 'value'],
	)
	assert.deepStrictEqual(
		inst.actions.proc_reset_to_unity.options.map((o) => o.id),
		['path'],
	)
	ok(`all ${v1Actions.length} v1 action ids + option ids intact`)
	assert(inst.feedbacks.video_proc_enabled && inst.feedbacks.color_corrector_enabled)
	ok('v1 feedback ids intact')
	const varIds = new Set(inst.varDefs.map((d) => d.variableId))
	for (const k of ['luma_gain', 'red_gamma', 'chroma_saturation_clip'])
		for (const n of [1, 2, 3, 4]) assert(varIds.has(`path${n}_${k}`))
	assert(varIds.has('active_path'))
	ok('v1 variable ids intact')
	const writable = PARAMS.filter((p) => !p.readonly)
	for (const p of writable) assert(inst.actions[p.key], `no action for ${p.key}`)
	ok(
		`every writable oid has an action (${writable.length} settings, ${Object.keys(inst.actions).length} actions total)`,
	)
	for (const bad of [524, 513, 518, 0x307]) assert(!PARAMS.some((p) => p.oid === bad || (p.oids || []).includes(bad)))
	ok('network settings + factory reset are not exposed')

	// presets reference real actions/feedbacks with valid options
	let presetCount = 0
	for (const [id, pr] of Object.entries(inst.presets)) {
		presetCount++
		for (const step of pr.steps)
			for (const set of Object.values(step))
				for (const a of set) {
					const def = inst.actions[a.actionId]
					assert(def, `preset ${id} uses unknown action ${a.actionId}`)
					for (const [k, val] of Object.entries(a.options)) {
						const o = def.options.find((o) => o.id === k)
						assert(o, `preset ${id}: action ${a.actionId} has no option ${k}`)
						if (o.type === 'dropdown')
							assert(
								o.choices.some((c) => c.id === val),
								`preset ${id}: ${k}=${val} not a choice`,
							)
					}
				}
		for (const f of pr.feedbacks) {
			const def = inst.feedbacks[f.feedbackId]
			assert(def, `preset ${id} uses unknown feedback ${f.feedbackId}`)
			for (const [k, val] of Object.entries(f.options)) {
				const o = def.options.find((o) => o.id === k)
				assert(o, `preset ${id}: feedback ${f.feedbackId} has no option ${k}`)
				if (o.type === 'dropdown')
					assert(
						o.choices.some((c) => c.id === val),
						`preset ${id}: fb ${k}=${val} not a choice`,
					)
			}
		}
		const vars = (pr.style.text.match(/\$\(cobalt-9905-color-corrector:([^)]+)\)/g) || []).map((s) =>
			s.slice('$(cobalt-9905-color-corrector:'.length, -1),
		)
		for (const vId of vars) assert(varIds.has(vId), `preset ${id} shows unknown variable ${vId}`)
	}
	ok(`all ${presetCount} presets reference valid actions, options, feedbacks and variables`)

	// 2. startup sync ------------------------------------------------------------
	assert.strictEqual(inst.vars.path3_luma_gain, 102, 'path 3 luma gain should come from path 3')
	assert.strictEqual(inst.vars.path1_lut_processing, 'Bypassed')
	assert.strictEqual(inst.vars.firmware_revision, 'Firmware Revision OK')
	assert.strictEqual(inst.vars.path1_source_status, '1920x1080i 59.94 BT.709', 'icon value shows its display text')
	assert.strictEqual(inst.vars.path3_source_status, 'Unknown')
	assert.strictEqual(inst.vars.path2_path_name, 'FS 38')
	assert.strictEqual(inst.vars.active_ip_address, '192.0.2.90')
	assert.strictEqual(inst.vars.path1_fs_alarm, 'OK')
	assert.strictEqual(inst.vars.path4_source_oetf, 'Auto/Used as Marked')
	ok('startup: all 4 paths + card status read into variables')

	// 3. LUT recall -> correct path, feedbacks ---------------------------------
	card.writes.length = 0
	await inst.actions.lut_recall_user.callback({ options: { path: 2, lut: 3 } })
	await idle(inst)
	assert.deepStrictEqual(card.writes, [
		{ oid: 0x1895, value: 3, path: 2 },
		{ oid: 0x1881, value: 2, path: 2 },
	])
	assert.strictEqual(inst.feedbacks.lut_user_active.callback({ options: { path: 2, lut: 3 } }), true)
	assert.strictEqual(inst.feedbacks.lut_user_active.callback({ options: { path: 2, lut: 0 } }), false)
	assert.strictEqual(inst.feedbacks.lut_user_active.callback({ options: { path: 1, lut: 3 } }), false)
	assert.strictEqual(inst.vars.path3_lut_user_select, '4 — ESPN 9C HLG2SDR_DOWN')
	ok('LUT recall: select + mode written on path 3 only, "is live" feedback correct')

	// 4. per-path oid + card-wide writes: no path select ---------------------------
	card.writes.length = 0
	const pathBefore = card.path
	await inst.actions.source_oetf.callback({ options: { path: 3, value: 3 } })
	await inst.actions.hdmi_hdr_oetf.callback({ options: { value: 4 } })
	await idle(inst)
	assert.deepStrictEqual(
		card.writes.map((w) => [w.oid, w.value]),
		[
			[5649, 3],
			[6049, 4],
		],
	)
	assert.strictEqual(card.path, pathBefore, 'per-path/card writes must not touch path select')
	assert.strictEqual(inst.feedbacks.source_oetf_is.callback({ options: { path: 3, value: 3 } }), true)
	ok('Source OETF writes its own path-4 oid; HDMI is card-wide; neither changes Path Select')

	// 5. race: everything at once, 20 rounds ---------------------------------------
	const start = card.perPath.map((m) => m.get(6147)) // luma gain
	const fdStart = card.perPath.map((m) => m.get(6411)) // frame delay
	const N = 20
	const jobs = []
	for (let i = 0; i < N; i++) {
		jobs.push(inst.actions.luma_gain_relative.callback({ options: { path: 0, delta: 1 } }))
		jobs.push(inst.actions.luma_gain_relative.callback({ options: { path: 3, delta: -2 } }))
		jobs.push(inst.actions.lut_processing.callback({ options: { path: 1, value: i % 2 ? 4 : 0 } }))
		jobs.push(inst.actions.resync_path.callback({ options: { path: 2 } }))
		jobs.push(inst.pollStatus())
		jobs.push(inst.actions.fs_frame_delay_relative.callback({ options: { path: 2, delta: 1 } }))
	}
	await Promise.all(jobs)
	await idle(inst)
	assert.strictEqual(card.perPath[0].get(6147), start[0] + N, 'path 1 luma')
	assert.strictEqual(card.perPath[3].get(6147), start[3] - 2 * N, 'path 4 luma')
	assert.strictEqual(card.perPath[1].get(6147), start[1], 'path 2 luma untouched')
	assert.strictEqual(card.perPath[2].get(6147), start[2], 'path 3 luma untouched')
	assert.strictEqual(card.perPath[2].get(6411), Math.min(20, fdStart[2] + N), 'path 3 frame delay')
	assert.strictEqual(card.perPath[0].get(6411), fdStart[0], 'path 1 frame delay untouched')
	assert.strictEqual(card.perPath[1].get(0x1881), 4)
	assert.strictEqual(inst.vars.path1_luma_gain, start[0] + N)
	assert.strictEqual(inst.vars.path4_luma_gain, start[3] - 2 * N)
	ok(`race: ${jobs.length} overlapping dial turns/writes/resyncs/polls — every write landed on its own path`)

	// 6. choice step (dial) ---------------------------------------------------------
	await inst.actions.lut_user_select_step.callback({ options: { path: 0, direction: 1, wrap: false } })
	await inst.actions.lut_user_select_step.callback({ options: { path: 0, direction: 1, wrap: false } })
	await inst.actions.lut_user_select_step.callback({ options: { path: 0, direction: -1, wrap: false } })
	await idle(inst)
	assert.strictEqual(card.perPath[0].get(0x1895), 1)
	await inst.actions.lut_user_select_step.callback({ options: { path: 0, direction: -1, wrap: true } })
	await inst.actions.lut_user_select_step.callback({ options: { path: 0, direction: -1, wrap: true } })
	await idle(inst)
	assert.strictEqual(card.perPath[0].get(0x1895), 15, 'wraps from 1 back to 16')
	ok('User LUT step: next/previous/wrap read live value and step correctly')

	// 7. preset recall sequence ------------------------------------------------------
	card.writes.length = 0
	await inst.actions.preset_recall.callback({ options: { preset: 7 } })
	await idle(inst)
	assert.deepStrictEqual(
		card.writes.map((w) => [w.oid, w.value]),
		[
			[768, 7],
			[0x306, 1],
		],
	)
	ok('card preset recall writes Preset Select then Load')

	// 8. raw access ------------------------------------------------------------------
	await inst.actions.raw_write.callback({ options: { oid: 6150, value: '12.5', path: 1 } })
	await inst.actions.raw_read.callback({ options: { oid: 6150, path: 1 } })
	await idle(inst)
	assert.strictEqual(card.perPath[1].get(6150), 12.5)
	assert.strictEqual(inst.vars.raw_last_value, 12.5)
	ok('raw OID write/read with path select')

	// 9. polling keeps card status live ----------------------------------------------
	card.cardWide.set(1154, '33 C')
	await sleep(400)
	assert.strictEqual(inst.vars.ambient_temp, '33 C')
	ok('background poll refreshes card status')

	// 11. status wall values -------------------------------------------------------
	await inst.actions.resync_all.callback({ options: {} })
	await idle(inst)
	assert.strictEqual(inst.vars.path1_input_short, '1080i59.94 SDR')
	assert.strictEqual(inst.vars.path2_input_short, '1080p59.94 HLG')
	assert.strictEqual(inst.vars.path3_input_short, 'NO INPUT')
	assert.strictEqual(inst.vars.path1_output_short, '1080p59.94')
	const fb = (id, path) => inst.feedbacks[id].callback({ options: { path } })
	assert.strictEqual(fb('path_problem', 2), true, 'FS39 no input = problem')
	assert.strictEqual(fb('path_problem', 3), true, 'FS40 no input = problem')
	assert.strictEqual(fb('path_input_ok', 0), true, 'FS37 input ok')
	assert.strictEqual(fb('path_input_ok', 1), true, 'FS38 input ok')
	assert.strictEqual(inst.vars.path3_health, 'NO INPUT')
	ok('wall: FS37 "1080i59.94 SDR", FS38 "1080p59.94 HLG", FS39/40 "NO INPUT" (red) — matches the real capture')

	// 12. show format on all paths ----------------------------------------------------
	card.writes.length = 0
	await inst.actions.show_format.callback({ options: { paths: -1, format: 12, fallbacks: true } })
	await idle(inst)
	for (const path of [0, 1, 2, 3]) {
		const w = card.writes.filter((x) => x.path === path).map((x) => [x.oid, x.value])
		assert.deepStrictEqual(
			w,
			[
				[6020, 1],
				[6018, 12],
				[6415, 12],
				[6404, 12],
			],
			`path ${path + 1} writes`,
		)
	}
	assert.strictEqual(inst.savedConfig.show_format, 12, 'show format saved to config')
	assert.strictEqual(inst.vars.show_format, '1920x1080i 59.94')
	assert.strictEqual(inst.vars.path2_output_short, '1080i59.94')
	assert.strictEqual(fb('path_problem', 0), false)
	assert.strictEqual(inst.feedbacks.show_format_is.callback({ options: { format: 12 } }), true)
	await inst.actions.scaler_output_format.callback({ options: { path: 0, value: 28 } })
	await idle(inst)
	assert.strictEqual(fb('path_problem', 0), true, 'FS37 off show format = problem')
	assert.strictEqual(inst.vars.path1_health, 'WRONG FMT')
	await inst.actions.show_format.callback({ options: { paths: -1, format: 28, fallbacks: true } })
	await idle(inst)
	assert.strictEqual(fb('path_problem', 0), false)
	ok('show format: Scaler + Output + Loss + Startup format written on each of the 4 paths; off-format path flagged red')

	// 13. zero all paths ---------------------------------------------------------------
	await inst.actions.luma_gain.callback({ options: { path: 1, value: 150 } })
	await inst.actions.lut_processing.callback({ options: { path: 0, value: 2 } })
	await inst.actions.source_oetf.callback({ options: { path: 2, value: 3 } })
	await inst.actions.fs_output_mode.callback({ options: { path: 3, value: 2 } })
	await inst.actions.fs_frame_delay.callback({ options: { path: 1, value: 3 } })
	await idle(inst)
	assert.strictEqual(fb('path_not_zero', 1), true)
	assert.strictEqual(fb('path_not_zero', 0), true)
	await inst.actions.zero_paths.callback({
		options: { paths: -1, proc_cc: true, lut: true, hdr: true, framesync: true },
	})
	await idle(inst)
	for (const path of [0, 1, 2, 3]) {
		const m = card.perPath[path]
		for (const [oid, v] of [
			[6147, 100],
			[6148, 0],
			[6149, 100],
			[6150, 0],
			[6157, 100],
			[6160, 1],
			[6154, 0],
			[6273, 0],
			[6405, 0],
			[6411, 0],
		])
			assert.strictEqual(m.get(oid), v, `path ${path + 1} oid ${oid}`)
		assert.strictEqual(card.cardWide.get(BY_KEY.source_oetf.oids[path]), 0)
		assert.strictEqual(card.cardWide.get(BY_KEY.source_colorimetry.oids[path]), 0)
		assert.strictEqual(
			fb('path_not_zero', path),
			false,
			`path ${path + 1} back to zero: ${JSON.stringify(inst.health[path].notZeroKeys)} ${JSON.stringify(inst.health[path].notZeroKeys.map((k) => [inst.state.path[path][k], card.perPath[path].get(BY_KEY[k].oid)]))}`,
		)
	}
	assert.strictEqual(inst.vars.path1_health, 'OK')
	ok('zero: all 4 paths back to unity / bypass / Auto / Input Video / 0 frames, and the wall agrees')

	// 14. the settle delay is what keeps a reset on its own path -------------------------
	await inst.configUpdated({ ...inst.config, settle_ms: 0 })
	for (const path of [0, 1, 2, 3]) await inst.actions.luma_gain.callback({ options: { path, value: 150 } })
	await idle(inst)
	await inst.actions.zero_paths.callback({
		options: { paths: -1, proc_cc: true, lut: false, hdr: false, framesync: false },
	})
	await idle(inst)
	await sleep(200)
	const leftover = [0, 1, 2, 3].filter((p) => card.perPath[p].get(6147) !== 100)
	assert(leftover.length > 0, 'with no settle time the async reset should miss a path')
	await inst.configUpdated({ ...inst.config, settle_ms: 150 })
	await inst.actions.zero_paths.callback({
		options: { paths: -1, proc_cc: true, lut: false, hdr: false, framesync: false },
	})
	await idle(inst)
	for (const path of [0, 1, 2, 3]) assert.strictEqual(card.perPath[path].get(6147), 100, `path ${path + 1} reset`)
	ok(`settle delay: with 0 ms a reset missed path(s) ${leftover.map((p) => p + 1)}; with 150 ms every reset lands`)

	// 15. preset recall re-reads the card ------------------------------------------------
	card.writes.length = 0
	await inst.actions.preset_recall.callback({ options: { preset: 2 } })
	await idle(inst)
	assert.deepStrictEqual(
		card.writes.slice(0, 2).map((w) => [w.oid, w.value]),
		[
			[768, 2],
			[774, 1],
		],
	)
	assert.strictEqual(inst.vars.path1_scaler_output_format, '1920x1080i 59.94', 'preset result read back')
	assert.strictEqual(inst.vars.path4_output_short, '1080i59.94')
	assert.strictEqual(fb('path_problem', 0), true, 'preset 2 (1080i) vs show format 1080p = flagged')
	ok('preset recall: Preset Select + Load, then all 4 paths re-read (wall shows the new format)')

	// 10. reconnect --------------------------------------------------------------------
	for (const c of wss.clients) c.terminate()
	await sleep(5600)
	assert(inst.isOpen(), 'should reconnect')
	ok('reconnects after the card drops the socket')

	await inst.destroy()
	wss.close()
	console.log(`\n${pass} checks passed`)
	process.exit(0)
})().catch((e) => {
	console.error(
		'\nFAILED:',
		e.message,
		(e.stack || '').split('\n').find((l) => l.includes('simulate.js')),
	)
	process.exit(1)
})
