const { combineRgb } = require('@companion-module/base')
const { tileChoices } = require('./actions')

const ON = { bgcolor: combineRgb(0, 153, 51), color: combineRgb(255, 255, 255) }

function getFeedbacks(self) {
	const cams = self.cameraChoices()
	const layouts = self.layoutChoices()
	const presets = self.presetChoices()
	const camDefault = cams[0]?.id ?? 'cam1'
	const tiles = () => (self.state ? self.state.tiles : [])

	return {
		// ---- router panel
		dest_selected: {
			type: 'boolean',
			name: 'Router: destination is selected',
			defaultStyle: { bgcolor: combineRgb(255, 191, 0), color: combineRgb(0, 0, 0) },
			options: [{ type: 'dropdown', id: 'tile', label: 'Tile', default: 1, choices: tileChoices() }],
			callback: (fb) => self.selDest === Number(fb.options.tile),
		},
		source_on_dest: {
			type: 'boolean',
			name: 'Router: source is on selected destination',
			defaultStyle: ON,
			options: [{ type: 'dropdown', id: 'cam', label: 'Camera', default: camDefault, choices: cams }],
			callback: (fb) => tiles()[self.selDest - 1] === fb.options.cam,
		},
		source_preselected: {
			type: 'boolean',
			name: 'Router: source is preselected (TAKE mode)',
			defaultStyle: { bgcolor: combineRgb(255, 191, 0), color: combineRgb(0, 0, 0) },
			options: [{ type: 'dropdown', id: 'cam', label: 'Camera', default: camDefault, choices: cams }],
			callback: (fb) => self.preSource === fb.options.cam,
		},
		take_armed: {
			type: 'boolean',
			name: 'Router: TAKE is armed',
			defaultStyle: { bgcolor: combineRgb(204, 0, 0), color: combineRgb(255, 255, 255) },
			options: [],
			callback: () => !!self.preSource,
		},
		// ---- signal (reported by the MV running on the RTSPmv box)
		tile_no_signal: {
			type: 'boolean',
			name: 'Signal: tile has NO SIGNAL',
			defaultStyle: { bgcolor: combineRgb(204, 0, 0), color: combineRgb(255, 255, 255) },
			options: [{ type: 'dropdown', id: 'tile', label: 'Tile', default: 1, choices: tileChoices() }],
			callback: (fb) => {
				const cam = tiles()[fb.options.tile - 1]
				return !!cam && (self.state?.down || []).includes(cam)
			},
		},
		any_no_signal: {
			type: 'boolean',
			name: 'Signal: any tile has NO SIGNAL',
			defaultStyle: { bgcolor: combineRgb(204, 0, 0), color: combineRgb(255, 255, 255) },
			options: [],
			callback: () => (self.state?.down || []).length > 0,
		},
		signal_unknown: {
			type: 'boolean',
			name: 'Signal: unknown (MV not running on the box)',
			defaultStyle: { bgcolor: combineRgb(90, 90, 90), color: combineRgb(255, 255, 255) },
			options: [],
			callback: () => !!self.state && !self.state.health_live,
		},
		// ---- direct routing
		cam_on_tile: {
			type: 'boolean',
			name: 'Camera is on tile',
			defaultStyle: ON,
			options: [
				{ type: 'dropdown', id: 'tile', label: 'Tile', default: 1, choices: tileChoices() },
				{ type: 'dropdown', id: 'cam', label: 'Camera', default: camDefault, choices: cams },
			],
			callback: (fb) => tiles()[fb.options.tile - 1] === fb.options.cam,
		},
		cam_on_screen: {
			type: 'boolean',
			name: 'Camera is on screen (any tile)',
			defaultStyle: ON,
			options: [
				{ type: 'dropdown', id: 'cam', label: 'Camera', default: camDefault, choices: cams },
			],
			callback: (fb) => tiles().includes(fb.options.cam),
		},
		tile_empty: {
			type: 'boolean',
			name: 'Tile is empty',
			defaultStyle: { bgcolor: combineRgb(90, 90, 90), color: combineRgb(255, 255, 255) },
			options: [{ type: 'dropdown', id: 'tile', label: 'Tile', default: 1, choices: tileChoices() }],
			callback: (fb) => {
				const t = tiles()
				return fb.options.tile <= t.length && !t[fb.options.tile - 1]
			},
		},
		layout_active: {
			type: 'boolean',
			name: 'Layout is active',
			defaultStyle: ON,
			options: [
				{ type: 'dropdown', id: 'name', label: 'Layout', default: layouts[0]?.id ?? '2x2', choices: layouts },
			],
			callback: (fb) => !!self.state && self.state.layout === fb.options.name,
		},
		preset_active: {
			type: 'boolean',
			name: 'Preset matches what is on screen',
			defaultStyle: ON,
			options: [
				{
					type: 'dropdown',
					id: 'name',
					label: 'Preset',
					default: presets[0]?.id ?? '',
					choices: presets,
					
				},
			],
			callback: (fb) => {
				const s = self.state
				const p = s && s.preset_defs && s.preset_defs[fb.options.name]
				if (!p) return false
				const pt = p.tiles || []
				return p.layout === s.layout && s.tiles.every((t, i) => (pt[i] ?? null) === t)
			},
		},
	}
}

module.exports = { getFeedbacks }
