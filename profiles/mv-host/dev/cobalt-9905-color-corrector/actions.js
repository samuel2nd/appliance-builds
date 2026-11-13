const PARAMS = require('./params')

const PATH_CHOICES = [
	{ id: 0, label: 'Path 1' },
	{ id: 1, label: 'Path 2' },
	{ id: 2, label: 'Path 3' },
	{ id: 3, label: 'Path 4' },
]
const PATH_OPTION = { type: 'dropdown', id: 'path', label: 'Path', choices: PATH_CHOICES, default: 0 }
const RAW_PATH_OPTION = {
	type: 'dropdown',
	id: 'path',
	label: 'Path select before write',
	choices: [{ id: -1, label: 'None (card-wide oid)' }, ...PATH_CHOICES],
	default: -1,
}

// Defaults v1 shipped with, kept so newly added v1-style buttons behave the same.
const CHOICE_DEFAULTS = { video_proc_enable: 1, color_corrector_enable: 1 }

function pathOpts(p) {
	return p.scope === 'card' ? [] : [PATH_OPTION]
}
const pathOf = (p, opts) => (p.scope === 'card' ? 0 : Number(opts.path ?? 0))

function buildActions(self) {
	const actions = {}

	for (const p of PARAMS) {
		if (p.readonly) continue
		const title = `${p.category}: ${p.name}`

		if (p.type === 'trigger') {
			actions[p.key] = {
				name: title,
				options: pathOpts(p),
				callback: (ev) => self.writeParam(p.key, pathOf(p, ev.options), 1),
			}
			continue
		}

		if (p.type === 'choice') {
			actions[p.key] = {
				name: title,
				options: [
					...pathOpts(p),
					{
						type: 'dropdown',
						id: 'value',
						label: 'State',
						choices: p.choices,
						default: CHOICE_DEFAULTS[p.key] ?? p.choices[0].id,
					},
				],
				callback: (ev) => self.writeParam(p.key, pathOf(p, ev.options), Number(ev.options.value)),
			}
			actions[`${p.key}_step`] = {
				name: `${p.category}: Step ${p.name} (next/previous)`,
				description: 'Moves to the next or previous choice, reading the live value first. Handy on a dial.',
				options: [
					...pathOpts(p),
					{
						type: 'dropdown',
						id: 'direction',
						label: 'Direction',
						choices: [
							{ id: 1, label: 'Next' },
							{ id: -1, label: 'Previous' },
						],
						default: 1,
					},
					{ type: 'checkbox', id: 'wrap', label: 'Wrap around at the ends', default: false },
				],
				callback: (ev) =>
					self.stepChoice(p.key, pathOf(p, ev.options), Number(ev.options.direction), !!ev.options.wrap),
			}
			continue
		}

		if (p.type === 'float' || p.type === 'int') {
			const unit = p.unit ? ` (${p.unit})` : ''
			actions[p.key] = {
				name: title,
				options: [
					...pathOpts(p),
					{
						type: 'number',
						id: 'value',
						label: `${p.name}${unit}`,
						min: p.min,
						max: p.max,
						step: p.step,
						default: p.default,
					},
				],
				callback: (ev) => {
					let v = Math.min(p.max, Math.max(p.min, Number(ev.options.value)))
					if (p.type === 'int') v = Math.round(v)
					return self.writeParam(p.key, pathOf(p, ev.options), v)
				},
			}
			actions[`${p.key}_relative`] = {
				name: `${p.category}: Adjust ${p.name} (Relative)`,
				options: [
					...pathOpts(p),
					{
						type: 'number',
						id: 'delta',
						label: 'Change amount (use a negative number to decrease)',
						min: -Math.abs(p.max - p.min),
						max: Math.abs(p.max - p.min),
						step: p.step,
						default: p.step,
					},
				],
				callback: (ev) => self.adjustParam(p.key, pathOf(p, ev.options), Number(ev.options.delta)),
			}
		}
	}

	// ---- convenience actions -------------------------------------------------

	const userLut = self.param('lut_user_select')
	const nbcuLut = self.param('lut_nbcu_select')

	actions.lut_recall_user = {
		name: '3D LUT: Recall User LUT (select LUT + set processing to User LUT)',
		options: [PATH_OPTION, { type: 'dropdown', id: 'lut', label: 'User LUT', choices: userLut.choices, default: 0 }],
		callback: (ev) =>
			self.writeSequence(Number(ev.options.path), [
				['lut_user_select', Number(ev.options.lut)],
				['lut_processing', 2],
			]),
	}
	actions.lut_recall_nbcu = {
		name: '3D LUT: Recall NBCU LUT (select LUT + set processing to NBCU LUT)',
		options: [PATH_OPTION, { type: 'dropdown', id: 'lut', label: 'NBCU LUT', choices: nbcuLut.choices, default: 0 }],
		callback: (ev) =>
			self.writeSequence(Number(ev.options.path), [
				['lut_nbcu_select', Number(ev.options.lut)],
				['lut_processing', 4],
			]),
	}
	actions.preset_recall = {
		name: 'Presets: Recall card preset (select + load, then re-read the card)',
		description: 'Loads a preset saved on the card (every layer it was saved with), then re-reads all 4 paths.',
		options: [{ type: 'number', id: 'preset', label: 'Preset number', min: 1, max: 128, step: 1, default: 1 }],
		callback: (ev) => self.recallPreset(Math.round(Number(ev.options.preset))),
	}

	// ---- whole-card macros (status wall) ----------------------------------------

	const PATHS_OPTION = {
		type: 'dropdown',
		id: 'paths',
		label: 'Paths',
		choices: [{ id: -1, label: 'All 4 paths' }, ...PATH_CHOICES],
		default: -1,
	}
	const formats = self.param('scaler_output_format').choices.filter((c) => c.id !== 0)

	actions.show_format = {
		name: 'Wall: Set show format (Scaler output + fallback formats)',
		description:
			'Scaler on + Requested Output Format on each path, and optionally Format on Loss of Input / Format on Startup. Also becomes the format the status wall checks against.',
		options: [
			PATHS_OPTION,
			{ type: 'dropdown', id: 'format', label: 'Format', choices: formats, default: 28 },
			{
				type: 'checkbox',
				id: 'fallbacks',
				label: 'Also set Format on Loss of Input + Format on Startup',
				default: true,
			},
		],
		callback: (ev) =>
			self.setShowFormat(Number(ev.options.format), self.pathsFrom(ev.options.paths), !!ev.options.fallbacks),
	}
	actions.zero_paths = {
		name: 'Wall: Zero paths (unity / bypass / auto / frame sync defaults)',
		description:
			'Proc + CC Reset to Unity, 3D LUT Bypassed, Source OETF + Colorimetry Auto, Output Mode Input Video and Frame Delay back to the configured "zero" value.',
		options: [
			PATHS_OPTION,
			{ type: 'checkbox', id: 'proc_cc', label: 'Proc + CC reset to unity', default: true },
			{ type: 'checkbox', id: 'lut', label: '3D LUT to Bypassed', default: true },
			{ type: 'checkbox', id: 'hdr', label: 'Source OETF + Colorimetry to Auto', default: true },
			{
				type: 'checkbox',
				id: 'framesync',
				label: 'Output Mode Input Video + Frame Delay to zero value',
				default: true,
			},
		],
		callback: (ev) =>
			self.zeroPaths(self.pathsFrom(ev.options.paths), {
				procCc: !!ev.options.proc_cc,
				lut: !!ev.options.lut,
				hdr: !!ev.options.hdr,
				framesync: !!ev.options.framesync,
			}),
	}
	actions.resync_all = {
		name: 'Resync All Paths',
		description: 'Re-reads Color, 3D LUT, Frame Sync and Scaler settings for all 4 paths (selects each path in turn).',
		options: [],
		callback: () => self.resyncAll(),
	}

	// v1 action — now refreshes every path-scoped setting (Color, LUT, Frame Sync, Scaler).
	actions.resync_path = {
		name: 'Resync Path Values',
		description: 'Selects the path on the card and re-reads its Color, 3D LUT, Frame Sync and Scaler settings.',
		options: [PATH_OPTION],
		callback: (ev) => self.resyncPath(Number(ev.options.path)),
	}
	actions.refresh_status = {
		name: 'Refresh card status now',
		description: 'Re-reads card-wide status, routing, HDMI and per-path input settings immediately.',
		options: [],
		callback: () => self.pollStatus(),
	}

	// ---- raw access, for testing oids that are not in the model file ------------

	actions.raw_write = {
		name: 'Advanced: Raw OID write',
		description: 'Writes any value to any oid. Use with care — no range checking.',
		options: [
			{ type: 'number', id: 'oid', label: 'OID (decimal)', min: 0, max: 65535, step: 1, default: 6273 },
			{ type: 'textinput', id: 'value', label: 'Value (numbers are sent as numbers)', default: '0' },
			RAW_PATH_OPTION,
		],
		callback: (ev) => self.rawWrite(Number(ev.options.oid), ev.options.value, Number(ev.options.path)),
	}
	actions.raw_read = {
		name: 'Advanced: Raw OID read (to variables + log)',
		description: 'Reads any oid into $(…:raw_last_oid) / $(…:raw_last_value) and the module log.',
		options: [
			{ type: 'number', id: 'oid', label: 'OID (decimal)', min: 0, max: 65535, step: 1, default: 6273 },
			{ ...RAW_PATH_OPTION, label: 'Path select before read' },
		],
		callback: (ev) => self.rawRead(Number(ev.options.oid), Number(ev.options.path)),
	}

	return actions
}

module.exports = { buildActions, PATH_CHOICES }
