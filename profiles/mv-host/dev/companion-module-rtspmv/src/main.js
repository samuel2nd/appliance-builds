const { InstanceBase, InstanceStatus } = require('@companion-module/base')
const { RtspmvConnection } = require('./connection')
const { getActions, MAX_TILES } = require('./actions')
const { getFeedbacks } = require('./feedbacks')
const { getPresets } = require('./presets')

class RtspmvInstance extends InstanceBase {
	async init(config) {
		this.config = config
		this.state = null
		this.shape = null
		this.conn = null
		this.selDest = 1 // router panel: selected destination tile
		this.preSource = null // router panel: preselected source (TAKE mode)
		this.defineAll()
		this.connect()
	}

	// ---- router panel (destination → source, optional TAKE)
	takeMode() {
		return !!this.config.take_mode
	}
	routerChanged() {
		this.updateVariables()
		this.checkFeedbacks('dest_selected', 'source_on_dest', 'source_preselected', 'take_armed')
	}
	selectDest(tile) {
		this.selDest = Number(tile) || 1
		this.preSource = null
		this.routerChanged()
	}
	async selectSource(cam, run) {
		if (this.takeMode()) {
			this.preSource = this.preSource === cam ? null : cam // press again to cancel
			this.routerChanged()
		} else {
			await run('route', { tile: this.selDest, cam })
		}
	}
	async take(run) {
		if (!this.preSource) return
		const cam = this.preSource
		this.preSource = null
		await run('route', { tile: this.selDest, cam })
		this.routerChanged()
	}

	async destroy() {
		if (this.conn) this.conn.stop()
	}

	async configUpdated(config) {
		this.config = config
		if (this.conn) this.conn.stop()
		this.state = null
		this.shape = null
		this.defineAll()
		this.connect()
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: '',
				value:
					'Address of the computer running RTSPmv. Its firewall must allow the web port (8090 by default).',
			},
			{ type: 'textinput', id: 'host', label: 'Host / IP', width: 8, default: '' },
			{ type: 'number', id: 'port', label: 'Port', width: 4, default: 8090, min: 1, max: 65535 },
			{
				type: 'checkbox',
				id: 'take_mode',
				label: 'Router panel: require TAKE (source buttons preselect, TAKE executes)',
				width: 12,
				default: false,
			},
		]
	}

	connect() {
		const host = (this.config.host || '').trim()
		if (!host) {
			this.updateStatus(InstanceStatus.BadConfig, 'Set the RTSPmv host')
			return
		}
		this.updateStatus(InstanceStatus.Connecting)
		this.conn = new RtspmvConnection({
			baseUrl: `http://${host}:${this.config.port || 8090}`,
			onState: (s) => this.applyState(s),
			onStatus: (ok, msg) =>
				this.updateStatus(ok ? InstanceStatus.Ok : InstanceStatus.ConnectionFailure, ok ? undefined : msg),
			log: (level, msg) => this.log(level, msg),
		})
		this.conn.start()
	}

	// ---- choices built from live state
	cameraChoices() {
		return (this.state?.cameras || []).map((c) => ({ id: c.id, label: `${c.name} (${c.id})` }))
	}
	layoutChoices() {
		return Object.entries(this.state?.layouts || {}).map(([id, l]) => ({ id, label: l.label }))
	}
	presetChoices() {
		return (this.state?.presets || []).map((p) => ({ id: p, label: p }))
	}

	applyState(s) {
		if (!s || !Array.isArray(s.tiles)) return
		this.state = s
		// Redefine actions/feedbacks/presets only when their shape changes
		const L = s.layouts?.[s.layout]
		const shape = JSON.stringify({
			cams: s.cameras.map((c) => [c.id, c.name]),
			layouts: Object.keys(s.layouts || {}),
			presets: s.presets,
			n: L ? L.tiles.length : s.tiles.length,
		})
		if (shape !== this.shape) {
			this.shape = shape
			this.defineAll()
		}
		// keep the selected destination valid if the layout shrank
		const n = L ? L.tiles.length : s.tiles.length
		if (this.selDest > n) this.selDest = 1
		if (this.preSource && !s.cameras.some((c) => c.id === this.preSource)) this.preSource = null
		this.updateVariables()
		this.checkAllFeedbacks()
	}

	defineAll() {
		this.setActionDefinitions(getActions(this))
		this.setFeedbackDefinitions(getFeedbacks(this))
		const { structure, presets } = getPresets(this)
		this.setPresetDefinitions(structure, presets)
		const vars = {
			layout: { name: 'Current layout ID' },
			layout_label: { name: 'Current layout name' },
			tile_count: { name: 'Tiles in current layout' },
			dest: { name: 'Router panel: selected destination tile number' },
			dest_source: { name: 'Router panel: camera on the selected destination' },
			preselect: { name: 'Router panel: preselected source (TAKE mode)' },
			signal: { name: 'Signal: OK / n NO SIGNAL / UNKNOWN' },
			no_signal_count: { name: 'Signal: number of NO SIGNAL tiles' },
			no_signal_tiles: { name: 'Signal: NO SIGNAL tile numbers (e.g. 2,5)' },
		}
		for (let t = 1; t <= MAX_TILES; t++) {
			vars[`tile_${t}`] = { name: `Tile ${t} camera name` }
			vars[`tile_${t}_id`] = { name: `Tile ${t} camera ID` }
		}
		this.setVariableDefinitions(vars)
	}

	updateVariables() {
		const s = this.state
		if (!s) return
		const names = Object.fromEntries(s.cameras.map((c) => [c.id, c.name]))
		const downTiles = s.tiles.map((t, i) => (t && (s.down || []).includes(t) ? i + 1 : 0)).filter(Boolean)
		const vals = {
			layout: s.layout,
			layout_label: s.layouts?.[s.layout]?.label ?? s.layout,
			tile_count: s.tiles.length,
			dest: this.selDest,
			dest_source: names[s.tiles[this.selDest - 1]] || '',
			preselect: this.preSource ? names[this.preSource] || this.preSource : '',
			signal: !s.health_live ? 'UNKNOWN' : downTiles.length ? `${downTiles.length} NO SIGNAL` : 'OK',
			no_signal_count: downTiles.length,
			no_signal_tiles: downTiles.join(','),
		}
		for (let t = 1; t <= MAX_TILES; t++) {
			const id = s.tiles[t - 1] || ''
			vals[`tile_${t}`] = id ? names[id] || id : ''
			vals[`tile_${t}_id`] = id
		}
		this.setVariableValues(vals)
	}
}

// API 2.x entrypoint: export the class (runEntrypoint was removed)
module.exports = RtspmvInstance
module.exports.UpgradeScripts = []
