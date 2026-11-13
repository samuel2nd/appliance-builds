const { combineRgb } = require('@companion-module/base')
const { layoutPng } = require('./icons')

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const GREEN = combineRgb(0, 153, 51)
const BLUE = combineRgb(0, 70, 140)

// API 2.x preset (type 'simple'; no 'category' - grouping lives in the structure)
function button(name, text, down, feedbacks = [], bg = BLACK) {
	return {
		type: 'simple',
		name,
		style: { text, size: 'auto', color: WHITE, bgcolor: bg },
		steps: [{ down, up: [] }],
		feedbacks,
	}
}

const onFb = (feedbackId, options) => ({ feedbackId, options, style: { bgcolor: GREEN, color: WHITE } })

/** @returns {{structure: object[], presets: Record<string, object>}} */
function getPresets(self) {
	const s = self.state
	const presets = {}
	const structure = []
	if (!s) return { structure, presets }

	const L = s.layouts[s.layout]
	const nTiles = L ? L.tiles.length : s.tiles.length
	const v = (name) => `$(${self.label}:${name})`

	// Router panel: destinations, sources, TAKE
	const AMBER = combineRgb(255, 191, 0)
	const destIds = []
	for (let t = 1; t <= nTiles; t++) {
		const id = `rp_dest_${t}`
		presets[id] = button(
			`Destination tile ${t}`,
			`DEST ${t}\\n${v(`tile_${t}`)}`,
			[{ actionId: 'select_dest', options: { tile: t } }],
			[{ feedbackId: 'dest_selected', options: { tile: t }, style: { bgcolor: AMBER, color: BLACK } }],
			BLUE
		)
		destIds.push(id)
	}
	const srcIds = []
	for (const c of s.cameras) {
		const id = `rp_src_${c.id}`
		presets[id] = button(
			`Source ${c.name}`,
			c.name,
			[{ actionId: 'select_source', options: { cam: c.id } }],
			[
				onFb('source_on_dest', { cam: c.id }),
				{ feedbackId: 'source_preselected', options: { cam: c.id }, style: { bgcolor: AMBER, color: BLACK } },
			]
		)
		srcIds.push(id)
	}
	presets.rp_take = button('TAKE', 'TAKE', [{ actionId: 'take', options: {} }], [
		{ feedbackId: 'take_armed', options: {}, style: { bgcolor: combineRgb(204, 0, 0), color: WHITE } },
	])
	presets.rp_status = button('Selected destination status', `DEST $(${self.label}:dest)\\n${v('dest_source')}`, [])
	structure.push({
		id: 'sec_router',
		name: 'Router panel',
		description: 'Pick a destination tile, then a source camera. Turn on "require TAKE" in the connection to preselect + TAKE.',
		definitions: [
			{ id: 'grp_rp_dest', type: 'simple', name: 'Destinations', presets: destIds },
			{ id: 'grp_rp_src', type: 'simple', name: 'Sources', presets: srcIds },
			{ id: 'grp_rp_take', type: 'simple', name: 'Take & status', presets: ['rp_take', 'rp_status'] },
		],
	})

	// Recovery: reconnect per tile (red when NO SIGNAL), restart all
	const RED = combineRgb(204, 0, 0)
	const recIds = []
	for (let t = 1; t <= nTiles; t++) {
		const id = `rec_tile_${t}`
		presets[id] = button(
			`Reconnect tile ${t}`,
			`RECON ${t}\\n${v(`tile_${t}`)}`,
			[{ actionId: 'reconnect', options: { tile: t } }],
			[{ feedbackId: 'tile_no_signal', options: { tile: t }, style: { bgcolor: RED, color: WHITE } }]
		)
		recIds.push(id)
	}
	presets.rec_down = button(
		'Reconnect all NO SIGNAL tiles',
		`RECON\\nDEAD\\n${v('signal')}`,
		[{ actionId: 'reconnect_down', options: {} }],
		[
			{ feedbackId: 'any_no_signal', options: {}, style: { bgcolor: RED, color: WHITE } },
			{ feedbackId: 'signal_unknown', options: {}, style: { bgcolor: combineRgb(90, 90, 90), color: WHITE } },
		]
	)
	presets.rec_restart = button(
		'Restart streams (all)',
		'RESTART\\nSTREAMS',
		[{ actionId: 'restart_streams', options: {} }],
		[{ feedbackId: 'any_no_signal', options: {}, style: { bgcolor: RED, color: WHITE } }],
		combineRgb(70, 0, 0)
	)
	recIds.push('rec_down', 'rec_restart')
	structure.push({
		id: 'sec_recovery',
		name: 'Recovery',
		description: 'Buttons turn red when the MV on the box shows NO SIGNAL. Reconnect one tile, all dead tiles, or restart all streams.',
		definitions: recIds,
	})

	// Routing: one group per tile of the current layout
	const routeGroups = []
	for (let t = 1; t <= nTiles; t++) {
		const ids = []
		for (const c of s.cameras) {
			const id = `route_${t}_${c.id}`
			presets[id] = button(
				`${c.name} → tile ${t}`,
				`T${t}\\n${c.name}`,
				[{ actionId: 'route', options: { tile: t, cam: c.id } }],
				[onFb('cam_on_tile', { tile: t, cam: c.id })]
			)
			ids.push(id)
		}
		const nextId = `next_${t}`
		presets[nextId] = button(
			`Next camera on tile ${t}`,
			`T${t} NEXT\\n${v(`tile_${t}`)}`,
			[{ actionId: 'route_next', options: { tile: t, dir: 1 } }],
			[],
			BLUE
		)
		ids.push(nextId)
		routeGroups.push({ id: `grp_tile_${t}`, type: 'simple', name: `Tile ${t}`, presets: ids })
	}
	structure.push({
		id: 'sec_routing',
		name: 'Routing',
		description: `Camera to tile, for the current layout (${L ? L.label : s.layout})`,
		definitions: routeGroups,
	})

	// Layouts
	const layoutIds = []
	for (const [id, lay] of Object.entries(s.layouts)) {
		const pid = `layout_${id}`
		presets[pid] = button(`Layout ${lay.label}`, '', [{ actionId: 'layout', options: { name: id } }], [
			onFb('layout_active', { name: id }),
		])
		// draw the layout itself on the button: white lines over the button color
		presets[pid].style.png64 = layoutPng(lay)
		presets[pid].style.pngalignment = 'center:center'
		layoutIds.push(pid)
	}
	structure.push({ id: 'sec_layouts', name: 'Layouts', definitions: layoutIds })

	// Saved presets
	const presetIds = []
	for (const name of s.presets) {
		const pid = `preset_${name}`
		presets[pid] = button(`Recall ${name}`, name, [{ actionId: 'preset_recall', options: { name } }], [
			onFb('preset_active', { name }),
		])
		presetIds.push(pid)
	}
	presets.preset_save = button(
		'Save current as preset',
		'SAVE\\nPRESET',
		[{ actionId: 'preset_save', options: { name: 'show' } }],
		[],
		BLUE
	)
	presetIds.push('preset_save')
	structure.push({ id: 'sec_presets', name: 'Presets', definitions: presetIds })

	// Status displays
	const statusIds = []
	for (let t = 1; t <= nTiles; t++) {
		const pid = `show_${t}`
		presets[pid] = button(`Tile ${t} name`, `T${t}\\n${v(`tile_${t}`)}`, [], [
			{ feedbackId: 'tile_empty', options: { tile: t }, style: { bgcolor: combineRgb(90, 90, 90), color: WHITE } },
		])
		statusIds.push(pid)
	}
	presets.show_layout = button('Current layout', `LAYOUT\\n${v('layout_label')}`, [])
	presets.swap_12 = button('Swap tiles 1 and 2', 'SWAP\\n1 ⇄ 2', [{ actionId: 'swap', options: { a: 1, b: 2 } }])
	statusIds.push('show_layout', 'swap_12')
	structure.push({ id: 'sec_status', name: 'Status & utility', definitions: statusIds })

	return { structure, presets }
}

module.exports = { getPresets }
