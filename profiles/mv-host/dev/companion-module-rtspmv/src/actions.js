const MAX_TILES = 16

const tileChoices = (n = MAX_TILES) => Array.from({ length: n }, (_, i) => ({ id: i + 1, label: `Tile ${i + 1}` }))

function getActions(self) {
	const cams = self.cameraChoices()
	const layouts = self.layoutChoices()
	const presets = self.presetChoices()
	const camDefault = cams[0]?.id ?? 'cam1'

	const run = async (cmd, params) => {
		try {
			const state = await self.conn.command(cmd, params)
			if (state && state.tiles) self.applyState(state)
		} catch (e) {
			self.log('error', `${cmd} failed: ${e.message}`)
		}
	}

	return {
		// ---- router panel
		select_dest: {
			name: 'Router: select destination (tile)',
			options: [{ type: 'dropdown', id: 'tile', label: 'Tile', default: 1, choices: tileChoices() }],
			callback: (a) => self.selectDest(a.options.tile),
		},
		select_source: {
			name: 'Router: source to selected destination',
			description: 'Routes immediately, or preselects when "require TAKE" is on.',
			options: [{ type: 'dropdown', id: 'cam', label: 'Camera', default: camDefault, choices: cams }],
			callback: (a) => self.selectSource(a.options.cam, run),
		},
		take: {
			name: 'Router: TAKE',
			options: [],
			callback: () => self.take(run),
		},
		// ---- recovery
		reconnect: {
			name: 'Recovery: reconnect tile',
			description: 'The MV drops and re-pulls just this tile\'s camera.',
			options: [{ type: 'dropdown', id: 'tile', label: 'Tile', default: 1, choices: tileChoices() }],
			callback: (a) => run('reconnect', { tile: a.options.tile }),
		},
		reconnect_down: {
			name: 'Recovery: reconnect all NO SIGNAL tiles',
			options: [],
			callback: async () => {
				for (const cam of self.state?.down || []) await run('reconnect', { cam })
			},
		},
		restart_streams: {
			name: 'Recovery: restart streams',
			description: 'Restarts the stream engine (re-pulls every camera) and reloads the MV. Video blips for a few seconds.',
			options: [],
			callback: () => run('restart', {}),
		},
		// ---- direct routing
		route: {
			name: 'Route camera to tile',
			description: 'If the camera is already on another tile, the two swap.',
			options: [
				{ type: 'dropdown', id: 'tile', label: 'Tile', default: 1, choices: tileChoices() },
				{ type: 'dropdown', id: 'cam', label: 'Camera', default: camDefault, choices: cams },
			],
			callback: (a) => run('route', { tile: a.options.tile, cam: a.options.cam }),
		},
		route_next: {
			name: 'Next / previous camera on tile',
			options: [
				{ type: 'dropdown', id: 'tile', label: 'Tile', default: 1, choices: tileChoices() },
				{
					type: 'dropdown',
					id: 'dir',
					label: 'Direction',
					default: 1,
					choices: [
						{ id: 1, label: 'Next' },
						{ id: -1, label: 'Previous' },
					],
				},
			],
			callback: (a) => {
				const s = self.state
				if (!s || !s.cameras.length) return
				const ids = s.cameras.map((c) => c.id)
				const cur = s.tiles[a.options.tile - 1]
				const i = cur ? ids.indexOf(cur) : -1
				const next = ids[(i + Number(a.options.dir) + ids.length) % ids.length]
				return run('route', { tile: a.options.tile, cam: next })
			},
		},
		swap: {
			name: 'Swap two tiles',
			options: [
				{ type: 'dropdown', id: 'a', label: 'Tile A', default: 1, choices: tileChoices() },
				{ type: 'dropdown', id: 'b', label: 'Tile B', default: 2, choices: tileChoices() },
			],
			callback: (a) => run('swap', { a: a.options.a, b: a.options.b }),
		},
		clear: {
			name: 'Clear tile',
			options: [{ type: 'dropdown', id: 'tile', label: 'Tile', default: 1, choices: tileChoices() }],
			callback: (a) => run('clear', { tile: a.options.tile }),
		},
		layout: {
			name: 'Set layout',
			options: [
				{ type: 'dropdown', id: 'name', label: 'Layout', default: layouts[0]?.id ?? '2x2', choices: layouts },
			],
			callback: (a) => run('layout', { name: a.options.name }),
		},
		preset_recall: {
			name: 'Recall preset',
			options: [
				{
					type: 'dropdown',
					id: 'name',
					label: 'Preset',
					default: presets[0]?.id ?? '',
					choices: presets,
					
				},
			],
			callback: (a) => run('preset', { name: a.options.name }),
		},
		preset_save: {
			name: 'Save current as preset',
			options: [{ type: 'textinput', id: 'name', label: 'Preset name', default: 'show', useVariables: true }],
			callback: async (a) => {
				// API 2.x: Companion parses variables in useVariables fields before the callback
				const name = String(a.options.name ?? '').trim()
				if (!name) return self.log('error', 'Preset name is empty')
				return run('preset/save', { name })
			},
		},
	}
}

module.exports = { getActions, tileChoices, MAX_TILES }
