const { InstanceBase, runEntrypoint, InstanceStatus, Regex } = require('@companion-module/base')
const WebSocket = require('ws')
const PARAMS = require('./params')
const { buildActions } = require('./actions')
const { buildFeedbacks, feedbackIdFor, EXTRA_FEEDBACKS, HEALTH_FEEDBACKS } = require('./feedbacks')
const { buildPresets } = require('./presets')
const { pathHealth, zeroTargets, ipFromInt, alarmText } = require('./status')

// Path Select register — every 'path' scoped oid applies to whichever path was
// written here last (confirmed from the card's own menu tree).
const PATH_SELECT_OID = 4864
const GET_CHUNK = 20 // oids per "get" request
const GET_TIMEOUT_MS = 1000
const PATHS = [0, 1, 2, 3]

const BY_KEY = Object.fromEntries(PARAMS.map((p) => [p.key, p]))

// oid -> { param, path } (path is null for 'path'/'card' scoped params, 0-3 for 'perpath')
const OID_MAP = new Map()
for (const p of PARAMS) {
	if (p.oids) p.oids.forEach((oid, i) => OID_MAP.set(oid, { param: p, path: i }))
	else OID_MAP.set(p.oid, { param: p, path: null })
}

const readable = (p) => p.type !== 'trigger'
// Read via path select + get (resync); never polled, because polling them would
// have to flip the card's shared path register in the background.
const PATH_READ_OIDS = PARAMS.filter((p) => p.scope === 'path' && readable(p)).map((p) => p.oid)
// Read by the background poll — none of these need a path select.
const CARD_READ_OIDS = PARAMS.filter((p) => p.scope !== 'path' && readable(p)).flatMap((p) => p.oids || [p.oid])

const FORMAT_CHOICES = BY_KEY.scaler_output_format.choices.filter((c) => c.id !== 0)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function chunk(arr, n) {
	const out = []
	for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
	return out
}

class Cobalt9905Instance extends InstanceBase {
	async init(config) {
		this.config = config
		this.ws = null
		this.msgId = 1
		this.reconnectTimer = null
		this.pollTimer = null
		this.polling = false

		// Values as the card reports them (icon fields stored as their display text).
		// state.path[0..3][key] holds 'path' and 'perpath' params; state.card[key] card-wide ones.
		// state.color holds the web UI's status colour hint for icon fields (green/yellow/red).
		this.state = { path: [{}, {}, {}, {}], card: {}, color: { path: [{}, {}, {}, {}], card: {} } }
		this.health = [null, null, null, null]
		this.activePath = null
		this.pendingRequests = new Map() // request id -> resolve
		// Sequence numbers so a GET reply can't overwrite a value we wrote after
		// that GET was sent (otherwise a button lights, then goes dark until the
		// next poll).
		this.seq = 0
		this.lastWrite = new Map() // oid -> seq of last write
		// Every operation that selects a path runs through this queue, so a
		// select→(await read)→write sequence can never be interleaved with
		// another one that selects a different path in between.
		this.queue = Promise.resolve()

		this.initVariables()
		this.setActionDefinitions(buildActions(this))
		this.setFeedbackDefinitions(buildFeedbacks(this))
		this.setPresetDefinitions(buildPresets())
		this.publishShowFormat()
		this.initWebSocket()
	}

	async configUpdated(config) {
		const reconnect = config.host !== this.config?.host || String(config.slot) !== String(this.config?.slot)
		const repoll = Number(config.poll_interval) !== Number(this.config?.poll_interval)
		this.config = config
		this.publishShowFormat()
		this.updateDerived(true)
		if (reconnect) this.initWebSocket()
		else if (repoll && this.isOpen()) this.startPolling()
	}

	async destroy() {
		this.stopPolling()
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
		this.reconnectTimer = null
		this.closeSocket()
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'Connection',
				value:
					'Connects directly to one 9905-MPx card via its WebSocket control endpoint (ws://<frame-ip>/rosetta_api/slots/<slot>). Use one connection per card/slot.',
			},
			{ type: 'textinput', id: 'host', label: 'Frame IP Address', width: 6, default: '', regex: Regex.IP },
			{
				type: 'textinput',
				id: 'slot',
				label: 'Card Slot Number',
				tooltip: 'The physical frame slot number this 9905-MPx card occupies (e.g. 2, 4, 10...)',
				width: 6,
				default: '2',
				regex: Regex.NUMBER,
			},
			{
				type: 'number',
				id: 'poll_interval',
				label: 'Status poll interval (seconds, 0 = off)',
				tooltip:
					'How often card-wide and per-path status (input status, lock, alarms, routing, HDMI) is refreshed. Path-select settings (Color, LUT, Frame Sync, Scaler) refresh when a path is resynced.',
				width: 6,
				default: 5,
				min: 0,
				max: 300,
			},
			{
				type: 'dropdown',
				id: 'show_format',
				label: 'Show format (status wall flags paths not set to it)',
				tooltip: 'Set automatically by the "Set show format" action.',
				width: 6,
				default: -1,
				choices: [{ id: -1, label: 'Off — no format check' }, ...FORMAT_CHOICES],
			},
			{
				type: 'number',
				id: 'zero_frame_delay',
				label: 'Frame delay that counts as "zero" (frames)',
				tooltip: 'What the Zero action sets Frame Delay to, and what the status wall treats as normal.',
				width: 6,
				default: 0,
				min: 0,
				max: 20,
			},
			{
				type: 'number',
				id: 'settle_ms',
				label: 'Settle time after resets / preset load (ms)',
				tooltip: 'Pause after Proc/CC Reset before selecting the next path, and before re-reading after a preset load.',
				width: 6,
				default: 150,
				min: 0,
				max: 5000,
			},
		]
	}

	// ---------------------------------------------------------------- params

	param(key) {
		return BY_KEY[key]
	}

	getValue(param, path) {
		return param.scope === 'card' ? this.state.card[param.key] : this.state.path[path]?.[param.key]
	}

	getColor(key, path) {
		const p = BY_KEY[key]
		return p.scope === 'card' ? this.state.color.card[key] : this.state.color.path[path]?.[key]
	}

	get showFormat() {
		const v = Number(this.config?.show_format ?? -1)
		return Number.isNaN(v) ? -1 : v
	}

	get zeroFrameDelay() {
		return Number(this.config?.zero_frame_delay ?? 0)
	}

	get settleMs() {
		return Number(this.config?.settle_ms ?? 150)
	}

	// ------------------------------------------------------------- variables

	varId(param, path) {
		return param.scope === 'card' ? param.key : `path${path + 1}_${param.key}`
	}

	initVariables() {
		const defs = [
			{ variableId: 'active_path', name: 'Currently selected path on card' },
			{ variableId: 'raw_last_oid', name: 'Raw read: last oid read' },
			{ variableId: 'raw_last_value', name: 'Raw read: last value read' },
			{ variableId: 'show_format', name: 'Status wall: show format' },
		]
		for (const p of PARAMS) {
			if (!readable(p)) continue
			if (p.scope === 'card') {
				defs.push({ variableId: p.key, name: `${p.category}: ${p.name}` })
			} else {
				for (const path of PATHS) {
					defs.push({ variableId: `path${path + 1}_${p.key}`, name: `Path ${path + 1} — ${p.category}: ${p.name}` })
				}
			}
		}
		for (const path of PATHS) {
			const n = path + 1
			defs.push(
				{ variableId: `path${n}_input_short`, name: `Path ${n} — Wall: input (e.g. 1080i59.94 SDR)` },
				{ variableId: `path${n}_output_short`, name: `Path ${n} — Wall: output format (e.g. 1080p59.94)` },
				{ variableId: `path${n}_health`, name: `Path ${n} — Wall: health (OK / NO INPUT / WRONG FMT / NOT ZERO…)` },
			)
		}
		this.setVariableDefinitions(defs)
	}

	displayValue(param, value) {
		if (param.type === 'choice') {
			const c = param.choices.find((c) => c.id === value)
			return c ? c.label : String(value)
		}
		if (param.type === 'alarm') return alarmText(param, value)
		if (param.format === 'ip') return ipFromInt(value)
		if (param.type === 'float' && typeof value === 'number') return Number(value.toFixed(4))
		return value
	}

	normalize(param, value) {
		if (
			['choice', 'int', 'float', 'trigger', 'alarm'].includes(param.type) &&
			typeof value === 'string' &&
			value.trim() !== ''
		) {
			const n = Number(value)
			if (!Number.isNaN(n)) return n
		}
		return value
	}

	// ---------------------------------------------------- state + batching
	//
	// Every value (from the card or written optimistically) goes through
	// storeValue() into a batch; commit() pushes variables, recomputes the
	// status-wall values and re-checks only the feedbacks that could change.

	newBatch() {
		return { vars: {}, fbs: new Set() }
	}

	storeValue(param, path, value, batch) {
		let color
		if (value && typeof value === 'object' && !Array.isArray(value) && 'display' in value) {
			color = value.hints?.['background-color']
			value = value.display
		}
		value = this.normalize(param, value)
		if (param.scope === 'card') {
			this.state.card[param.key] = value
			if (color !== undefined) this.state.color.card[param.key] = color
		} else {
			this.state.path[path][param.key] = value
			if (color !== undefined) this.state.color.path[path][param.key] = color
		}
		batch.vars[this.varId(param, path)] = this.displayValue(param, value)
		const fb = feedbackIdFor(param)
		if (fb) batch.fbs.add(fb)
		for (const extra of EXTRA_FEEDBACKS[param.key] || []) batch.fbs.add(extra)
		if (param.key === 'video_proc_enable') batch.fbs.add('video_proc_enabled')
		if (param.key === 'color_corrector_enable') batch.fbs.add('color_corrector_enabled')
	}

	commit(batch) {
		if (Object.keys(batch.vars).length) this.setVariableValues(batch.vars)
		this.updateDerived(false, batch.fbs)
		if (batch.fbs.size) this.checkFeedbacks(...batch.fbs)
	}

	/** Recompute the status-wall variables; add health feedbacks to `fbs` if anything changed. */
	updateDerived(force, fbs) {
		const vars = {}
		let changed = false
		for (const path of PATHS) {
			const h = pathHealth(this.state.path[path], this.state.color.path[path], this.state.card, {
				showFormat: this.showFormat,
				zeroFrameDelay: this.zeroFrameDelay,
			})
			const prev = this.health[path]
			if (force || !prev || JSON.stringify(prev) !== JSON.stringify(h)) {
				changed = true
				const n = path + 1
				vars[`path${n}_input_short`] = h.input
				vars[`path${n}_output_short`] = h.output
				vars[`path${n}_health`] = h.text
			}
			this.health[path] = h
		}
		if (Object.keys(vars).length) this.setVariableValues(vars)
		if (changed) {
			if (fbs) HEALTH_FEEDBACKS.forEach((id) => fbs.add(id))
			else this.checkFeedbacks(...HEALTH_FEEDBACKS)
		}
	}

	publishShowFormat() {
		const c = FORMAT_CHOICES.find((c) => c.id === this.showFormat)
		this.setVariableValues({ show_format: c ? c.label : 'Off' })
	}

	/**
	 * Apply an array of {oid, value} from the card. `pathForPathScoped` is the
	 * path that path-scoped oids belong to (the path we selected before the
	 * read); null means "don't trust path-scoped values in this batch".
	 */
	applyParams(list, pathForPathScoped) {
		const batch = this.newBatch()
		for (const r of list || []) {
			if (!r || typeof r.oid !== 'number' || r.value === undefined) continue
			// A GET reply older than our last write to this oid would undo it.
			if (r._sentAt !== undefined && this.lastWrite.get(r.oid) > r._sentAt) continue
			const hit = OID_MAP.get(r.oid)
			if (!hit || !readable(hit.param)) continue
			const { param } = hit
			let path = hit.path
			if (param.scope === 'path') {
				if (pathForPathScoped === null || pathForPathScoped === undefined) continue
				path = pathForPathScoped
			}
			this.storeValue(param, path, r.value, batch)
		}
		this.commit(batch)
	}

	/** Optimistically record values we just wrote: [[key, path, value], ...] */
	recordWrites(list) {
		const batch = this.newBatch()
		for (const [key, path, value] of list) {
			const p = BY_KEY[key]
			if (p.type !== 'trigger') this.storeValue(p, path, value, batch)
		}
		this.commit(batch)
	}

	// ------------------------------------------------------------- websocket

	closeSocket() {
		if (this.ws) {
			this.ws.removeAllListeners()
			this.ws.on('error', () => {})
			try {
				this.ws.terminate()
			} catch (e) {
				// ignore
			}
			this.ws = null
		}
		for (const resolve of this.pendingRequests.values()) resolve([])
		this.pendingRequests.clear()
	}

	initWebSocket() {
		this.stopPolling()
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
		this.reconnectTimer = null
		this.closeSocket()

		const slotRaw = this.config?.slot
		if (!this.config?.host || slotRaw === undefined || slotRaw === null || String(slotRaw).trim() === '') {
			this.updateStatus(InstanceStatus.BadConfig, 'Missing frame IP or slot number')
			return
		}

		this.updateStatus(InstanceStatus.Connecting)
		const url = `ws://${this.config.host}/rosetta_api/slots/${this.config.slot}`
		this.log('debug', `Connecting to ${url}`)

		try {
			this.ws = new WebSocket(url)
		} catch (e) {
			this.updateStatus(InstanceStatus.ConnectionFailure, e.message)
			this.scheduleReconnect()
			return
		}

		this.ws.on('open', () => {
			this.updateStatus(InstanceStatus.Ok)
			this.log('info', `Connected to ${url}`)
			this.activePath = null
			this.startPolling()
			// Prime every path's settings so feedbacks are right from the start.
			this.resyncAll().catch(() => {})
		})
		this.ws.on('message', (data) => this.handleMessage(data))
		this.ws.on('close', () => {
			if (this.ws) {
				this.updateStatus(InstanceStatus.Disconnected)
				this.stopPolling()
				for (const resolve of this.pendingRequests.values()) resolve([])
				this.pendingRequests.clear()
				this.scheduleReconnect()
			}
		})
		this.ws.on('error', (err) => {
			this.updateStatus(InstanceStatus.ConnectionFailure, err.message)
		})
	}

	scheduleReconnect() {
		if (this.reconnectTimer) return
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null
			this.initWebSocket()
		}, 5000)
	}

	isOpen() {
		return this.ws && this.ws.readyState === WebSocket.OPEN
	}

	/**
	 * Pulls the {oid, value} array out of a message regardless of which key
	 * holds it ("parameters" for pushes/writes; GET responses may differ).
	 */
	extractParamArray(msg) {
		if (Array.isArray(msg.parameters)) return msg.parameters
		// (a write ack's "changed":[{oid}] carries no values, so it is skipped here)
		for (const val of Object.values(msg)) {
			if (
				Array.isArray(val) &&
				val.length > 0 &&
				val[0] &&
				typeof val[0] === 'object' &&
				'oid' in val[0] &&
				'value' in val[0]
			)
				return val
		}
		return null
	}

	handleMessage(data) {
		let msg
		try {
			msg = JSON.parse(data.toString())
		} catch (e) {
			this.log('debug', `Received non-JSON message: ${data}`)
			return
		}
		const paramArray = this.extractParamArray(msg)

		// Responses to our own GETs go straight back to the caller, which knows
		// which path they belong to.
		if (typeof msg.id === 'number' && this.pendingRequests.has(msg.id)) {
			const resolve = this.pendingRequests.get(msg.id)
			this.pendingRequests.delete(msg.id)
			resolve(paramArray || [])
			return
		}
		// Unsolicited telemetry: card-wide/per-path-oid values are always safe;
		// path-scoped ones are attributed to the path we last selected.
		if (paramArray) this.applyParams(paramArray, this.activePath)
	}

	sendParam(oid, value) {
		if (!this.isOpen()) {
			this.log('warn', `Not connected — dropped write to oid ${oid}`)
			return false
		}
		this.ws.send(JSON.stringify({ parameters: [{ oid, value }], method: 'post', id: this.msgId++ }))
		this.lastWrite.set(oid, ++this.seq)
		return true
	}

	requestValues(oids) {
		if (!this.isOpen()) return Promise.resolve([])
		const id = this.msgId++
		const sentAt = ++this.seq
		return new Promise((done) => {
			// Stamp each value with when its request went out; applyParams() drops it if
			// that oid was written after this point (checked at apply time, because a
			// poll applies its chunks only once they have all arrived).
			const resolve = (list) =>
				done((list || []).map((r) => (r && typeof r === 'object' ? { ...r, _sentAt: sentAt } : r)))
			this.pendingRequests.set(id, resolve)
			this.ws.send(JSON.stringify({ oids, method: 'get', id }))
			setTimeout(() => {
				if (this.pendingRequests.has(id)) {
					this.log('warn', `get id=${id} timed out (oids ${oids[0]}…)`)
					this.pendingRequests.delete(id)
					resolve([])
				}
			}, GET_TIMEOUT_MS)
		})
	}

	async requestMany(oids) {
		const out = []
		for (const c of chunk(oids, GET_CHUNK)) out.push(...(await this.requestValues(c)))
		return out
	}

	// ----------------------------------------------------- path select queue

	exclusive(fn) {
		const run = this.queue.then(fn)
		this.queue = run.catch((e) => this.log('error', `queued operation failed: ${e?.message || e}`))
		return run
	}

	selectPath(path) {
		this.sendParam(PATH_SELECT_OID, path)
		this.activePath = path
		this.setVariableValues({ active_path: path + 1 })
	}

	oidFor(param, path) {
		return param.scope === 'perpath' ? param.oids[path] : param.oid
	}

	/** Paths option from an action: -1 = all four. */
	pathsFrom(opt) {
		const n = Number(opt)
		return n >= 0 && n <= 3 ? [n] : PATHS
	}

	// --------------------------------------------------------------- writes

	/** Absolute write of one param (path ignored for card-wide params). */
	writeParam(key, path, value) {
		const param = BY_KEY[key]
		if (!param || param.readonly) return Promise.resolve()
		const doWrite = () => {
			if (this.sendParam(this.oidFor(param, path), value)) this.recordWrites([[key, path, value]])
		}
		if (param.scope === 'path') {
			return this.exclusive(() => {
				this.selectPath(path)
				doWrite()
			})
		}
		doWrite()
		return Promise.resolve()
	}

	/** Several writes on one path, in order, without anything in between. */
	writeSequence(path, pairs) {
		return this.exclusive(() => {
			let selected = false
			const done = []
			for (const [key, value] of pairs) {
				const param = BY_KEY[key]
				if (param.scope === 'path' && !selected) {
					this.selectPath(path)
					selected = true
				}
				if (!this.sendParam(this.oidFor(param, path), value)) break
				done.push([key, path, value])
			}
			this.recordWrites(done)
		})
	}

	/** Read the live value of one param (selecting its path if needed — caller holds the queue). */
	async readLive(param, path) {
		const oid = this.oidFor(param, path)
		const res = await this.requestValues([oid])
		const hit = res.find((r) => r.oid === oid)
		if (hit && hit.value !== undefined) {
			this.applyParams([hit], path)
			return this.getValue(param, path)
		}
		return this.getValue(param, path)
	}

	/** Relative change for float/int params, from the card's live value. */
	adjustParam(key, path, delta) {
		const param = BY_KEY[key]
		if (!param) return Promise.resolve()
		const run = async () => {
			if (param.scope === 'path') this.selectPath(path)
			const current = await this.readLive(param, path)
			const base = typeof current === 'number' ? current : param.default
			let next = Math.min(param.max, Math.max(param.min, base + delta))
			const decimals = Math.max(0, Math.ceil(-Math.log10(param.step || 1)))
			next = Number(next.toFixed(Math.min(decimals + 1, 6)))
			if (param.type === 'int') next = Math.round(next)
			if (this.sendParam(this.oidFor(param, path), next)) this.recordWrites([[key, path, next]])
		}
		return param.scope === 'path' ? this.exclusive(run) : run()
	}

	/** Step a choice param to the next/previous choice (in the card's menu order). */
	stepChoice(key, path, direction, wrap) {
		const param = BY_KEY[key]
		if (!param || param.type !== 'choice') return Promise.resolve()
		const run = async () => {
			if (param.scope === 'path') this.selectPath(path)
			const current = await this.readLive(param, path)
			const ids = param.choices.map((c) => c.id)
			let i = ids.indexOf(current)
			if (i < 0) i = direction > 0 ? -1 : ids.length
			let n = i + direction
			if (n >= ids.length) n = wrap ? 0 : ids.length - 1
			if (n < 0) n = wrap ? ids.length - 1 : 0
			if (ids[n] === current) return
			if (this.sendParam(this.oidFor(param, path), ids[n])) this.recordWrites([[key, path, ids[n]]])
		}
		return param.scope === 'path' ? this.exclusive(run) : run()
	}

	// ------------------------------------------------- whole-card macros

	/**
	 * Show format: Scaler on + Requested Output Format, and (optionally) the
	 * frame sync Format on Loss of Input / Format on Startup, on each path.
	 */
	setShowFormat(format, paths, fallbacks) {
		const fmt = Number(format)
		this.config = { ...this.config, show_format: fmt }
		this.saveConfig(this.config)
		this.publishShowFormat()
		return this.exclusive(async () => {
			const done = []
			for (const path of paths) {
				this.selectPath(path)
				const writes = [
					['scaler_enable', 1],
					['scaler_output_format', fmt],
				]
				if (fallbacks) writes.push(['fs_format_on_loss', fmt], ['fs_format_on_startup', fmt])
				for (const [key, value] of writes) {
					if (!this.sendParam(BY_KEY[key].oid, value)) return this.recordWrites(done)
					done.push([key, path, value])
				}
			}
			this.recordWrites(done)
			// Output Format is reported by the card once the scaler has switched.
			await sleep(this.settleMs)
			for (const path of paths) await this._resync(path)
		})
	}

	/** Put paths back to zero: Proc/CC unity, LUT bypass, HDR tags Auto, frame sync defaults. */
	zeroPaths(paths, opts) {
		const { procCc = true, lut = true, hdr = true, framesync = true } = opts || {}
		const fd = this.zeroFrameDelay
		return this.exclusive(async () => {
			const done = []
			for (const path of paths) {
				this.selectPath(path)
				if (procCc) {
					// Triggers: give the card time to finish on THIS path before the
					// next path select.
					this.sendParam(BY_KEY.proc_reset_to_unity.oid, 1)
					await sleep(this.settleMs)
					this.sendParam(BY_KEY.cc_reset_to_unity.oid, 1)
					await sleep(this.settleMs)
				}
				if (lut && this.sendParam(BY_KEY.lut_processing.oid, 0)) done.push(['lut_processing', path, 0])
				if (framesync) {
					if (this.sendParam(BY_KEY.fs_output_mode.oid, 0)) done.push(['fs_output_mode', path, 0])
					if (this.sendParam(BY_KEY.fs_frame_delay.oid, fd)) done.push(['fs_frame_delay', path, fd])
				}
				if (hdr) {
					for (const key of ['source_oetf', 'source_colorimetry']) {
						if (this.sendParam(BY_KEY[key].oids[path], 0)) done.push([key, path, 0])
					}
				}
			}
			this.recordWrites(done)
			for (const path of paths) await this._resync(path)
		})
	}

	/** Recall a card preset (all layers it was saved with), then re-read everything. */
	recallPreset(preset) {
		return this.exclusive(async () => {
			if (!this.sendParam(BY_KEY.preset_select.oid, preset)) return
			this.sendParam(BY_KEY.preset_load.oid, 1)
			this.recordWrites([['preset_select', 0, preset]])
			await sleep(Math.max(1000, this.settleMs * 4))
			for (const path of PATHS) await this._resync(path)
		}).then(() => this.pollStatus())
	}

	// ----------------------------------------------------------------- reads

	/** Caller must hold the queue. */
	async _resync(path) {
		if (!this.isOpen()) return
		this.selectPath(path)
		const res = await this.requestMany(PATH_READ_OIDS)
		this.applyParams(res, path)
	}

	/** Select a path and refresh every path-scoped value for it. */
	resyncPath(path) {
		return this.exclusive(() => this._resync(path))
	}

	resyncAll() {
		return this.exclusive(async () => {
			for (const path of PATHS) await this._resync(path)
		})
	}

	async pollStatus() {
		if (this.polling || !this.isOpen()) return
		this.polling = true
		try {
			const res = await this.requestMany(CARD_READ_OIDS)
			this.applyParams(res, null)
		} finally {
			this.polling = false
		}
	}

	startPolling() {
		this.stopPolling()
		this.pollStatus().catch(() => {})
		const secs = Number(this.config?.poll_interval ?? 5)
		if (secs > 0) this.pollTimer = setInterval(() => this.pollStatus().catch(() => {}), secs * 1000)
	}

	stopPolling() {
		if (this.pollTimer) clearInterval(this.pollTimer)
		this.pollTimer = null
	}

	// ------------------------------------------------------------ raw access

	rawWrite(oid, value, path) {
		const v = typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)) ? Number(value) : value
		if (path >= 0) {
			return this.exclusive(() => {
				this.selectPath(path)
				this.sendParam(oid, v)
			})
		}
		this.sendParam(oid, v)
		return Promise.resolve()
	}

	rawRead(oid, path) {
		const run = async () => {
			if (path >= 0) this.selectPath(path)
			const res = await this.requestValues([oid])
			const hit = res.find((r) => r.oid === oid)
			const value = hit ? hit.value : '(no response)'
			this.log('info', `raw read oid ${oid}${path >= 0 ? ` (path ${path + 1})` : ''}: ${JSON.stringify(hit ?? res)}`)
			this.setVariableValues({
				raw_last_oid: oid,
				raw_last_value: typeof value === 'object' ? JSON.stringify(value) : value,
			})
		}
		return path >= 0 ? this.exclusive(run) : run()
	}
}

module.exports = {
	Cobalt9905Instance,
	PARAMS,
	BY_KEY,
	PATH_READ_OIDS,
	CARD_READ_OIDS,
	PATH_SELECT_OID,
	FORMAT_CHOICES,
	zeroTargets,
}

// The test harness sets COMPANION_MODULE_ENTRY=test to load the class without starting IPC.
if (process.env.COMPANION_MODULE_ENTRY !== 'test') {
	runEntrypoint(Cobalt9905Instance, [])
}
