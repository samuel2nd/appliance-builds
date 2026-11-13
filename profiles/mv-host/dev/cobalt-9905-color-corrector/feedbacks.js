const { combineRgb } = require('@companion-module/base')
const PARAMS = require('./params')
const { PATH_CHOICES } = require('./actions')

const PATH_OPTION = { type: 'dropdown', id: 'path', label: 'Path', choices: PATH_CHOICES, default: 0 }
const ON_STYLE = { bgcolor: combineRgb(0, 150, 0), color: combineRgb(255, 255, 255) }

const feedbackIdFor = (p) => (p.type === 'choice' ? `${p.key}_is` : null)
// Extra feedbacks that depend on a param besides its own "_is" feedback.
const EXTRA_FEEDBACKS = {
	lut_processing: ['lut_user_active', 'lut_nbcu_active'],
	lut_user_select: ['lut_user_active'],
	lut_nbcu_select: ['lut_nbcu_active'],
}

function buildFeedbacks(self) {
	const feedbacks = {
		// v1 feedbacks, unchanged ids/options
		video_proc_enabled: {
			type: 'boolean',
			name: 'Color Proc: Video Proc Enabled',
			description: 'True when Video Proc is enabled for the selected path. Use Invert for the Disabled button.',
			defaultStyle: ON_STYLE,
			options: [PATH_OPTION],
			callback: (fb) => self.state.path[fb.options.path]?.video_proc_enable === 1,
		},
		color_corrector_enabled: {
			type: 'boolean',
			name: 'Color Correction: Color Corrector Enabled',
			description:
				'True when the Color Corrector is enabled for the selected path. Use Invert for the Disabled button.',
			defaultStyle: ON_STYLE,
			options: [PATH_OPTION],
			callback: (fb) => self.state.path[fb.options.path]?.color_corrector_enable === 1,
		},
	}

	// LUT "is live" feedbacks: the LUT is selected AND processing is set to that LUT bank.
	const userLut = self.param('lut_user_select')
	const nbcuLut = self.param('lut_nbcu_select')
	feedbacks.lut_user_active = {
		type: 'boolean',
		name: '3D LUT: User LUT is live',
		description: 'True when 3D-LUT Processing is "User LUT" and this User LUT is selected.',
		defaultStyle: ON_STYLE,
		options: [PATH_OPTION, { type: 'dropdown', id: 'lut', label: 'User LUT', choices: userLut.choices, default: 0 }],
		callback: (fb) => {
			const s = self.state.path[fb.options.path] || {}
			return s.lut_processing === 2 && s.lut_user_select === Number(fb.options.lut)
		},
	}
	feedbacks.lut_nbcu_active = {
		type: 'boolean',
		name: '3D LUT: NBCU LUT is live',
		description: 'True when 3D-LUT Processing is "NBCU LUT" and this NBCU LUT is selected.',
		defaultStyle: ON_STYLE,
		options: [PATH_OPTION, { type: 'dropdown', id: 'lut', label: 'NBCU LUT', choices: nbcuLut.choices, default: 0 }],
		callback: (fb) => {
			const s = self.state.path[fb.options.path] || {}
			return s.lut_processing === 4 && s.lut_nbcu_select === Number(fb.options.lut)
		},
	}

	// One "<setting> is <choice>" feedback per choice setting.
	for (const p of PARAMS) {
		const id = feedbackIdFor(p)
		if (!id) continue
		feedbacks[id] = {
			type: 'boolean',
			name: `${p.category}: ${p.name} is…`,
			defaultStyle: ON_STYLE,
			options: [
				...(p.scope === 'card' ? [] : [PATH_OPTION]),
				{ type: 'dropdown', id: 'value', label: 'Value', choices: p.choices, default: p.choices[0].id },
			],
			callback: (fb) => {
				const path = p.scope === 'card' ? 0 : Number(fb.options.path ?? 0)
				return self.getValue(p, path) === Number(fb.options.value)
			},
		}
	}
	// ---- status wall: per-path health (put them on a button in this order) ----
	const health = (fb) => self.health[Number(fb.options.path ?? 0)]
	feedbacks.path_input_ok = {
		type: 'boolean',
		name: 'Wall: Path input OK',
		description: 'Input present, frame sync locked, no rate alarm, and on the show format (if one is set).',
		defaultStyle: { bgcolor: combineRgb(0, 120, 0), color: combineRgb(255, 255, 255) },
		options: [PATH_OPTION],
		callback: (fb) => !!health(fb)?.inputOk,
	}
	feedbacks.path_not_zero = {
		type: 'boolean',
		name: 'Wall: Path not at zero',
		description:
			'Proc/CC not at unity, LUT not bypassed, HDR tags not Auto, Freeze/Flat Field, or frame delay not the zero value.',
		defaultStyle: { bgcolor: combineRgb(230, 180, 0), color: combineRgb(0, 0, 0) },
		options: [PATH_OPTION],
		callback: (fb) => !!health(fb)?.notZero,
	}
	feedbacks.path_problem = {
		type: 'boolean',
		name: 'Wall: Path problem',
		description: 'No input, frame sync unlocked, rate-mismatch alarm, or not on the show format.',
		defaultStyle: { bgcolor: combineRgb(200, 0, 0), color: combineRgb(255, 255, 255) },
		options: [PATH_OPTION],
		callback: (fb) => !!health(fb)?.problem,
	}
	feedbacks.show_format_is = {
		type: 'boolean',
		name: 'Wall: Show format is…',
		defaultStyle: ON_STYLE,
		options: [
			{
				type: 'dropdown',
				id: 'format',
				label: 'Format',
				choices: self.param('scaler_output_format').choices.filter((c) => c.id !== 0),
				default: 28,
			},
		],
		callback: (fb) => self.showFormat === Number(fb.options.format),
	}

	return feedbacks
}

// Re-checked whenever any path's health changes.
const HEALTH_FEEDBACKS = ['path_input_ok', 'path_not_zero', 'path_problem', 'show_format_is']

module.exports = { buildFeedbacks, feedbackIdFor, EXTRA_FEEDBACKS, HEALTH_FEEDBACKS }
