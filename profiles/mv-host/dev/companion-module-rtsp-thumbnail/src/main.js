import { spawn } from 'node:child_process'
import { InstanceBase, InstanceStatus } from '@companion-module/base'
import { buildArgs, clampInt, resolveFfmpeg } from './ffmpeg.js'
import { PamSplitter } from './pam.js'
import { renderTile } from './tile.js'
import { encodeTile } from './png.js'

export const UpgradeScripts = []

export default class RtspThumbnailInstance extends InstanceBase {
	config = {}
	#proc = null
	#restartTimer = null
	#watchdog = null
	#destroyed = false
	#frame = null // latest decoded frame {width,height,data}
	#tileCache = new Map() // layout key -> png64, for the current frame
	#lastFrameAt = 0
	#frameCount = 0
	#streamUp = false
	#lastError = ''
	#lastLogged = ''
	#lastRenderError = ''
	#splitter = new PamSplitter((f) => this.#onFrame(f))

	async init(config) {
		this.config = config
		this.#defineFeedbacks()
		this.#defineVariables()
		this.#start()
		this.#watchdog = setInterval(() => this.#tick(), 1000) // stall detection + measured fps
	}

	async destroy() {
		this.#destroyed = true
		clearInterval(this.#watchdog)
		this.#stop()
	}

	async configUpdated(config) {
		this.config = config
		this.#stop()
		this.#frame = null
		this.#tileCache.clear()
		this.checkFeedbacks('thumbnail', 'stream_down')
		this.#start()
	}

	getConfigFields() {
		return [
			{
				type: 'textinput',
				id: 'url',
				label: 'Stream URL',
				width: 12,
				default: '',
				description: 'Use the camera sub stream (low res) where possible. Any URL ffmpeg can open works.',
			},
			{
				type: 'dropdown',
				id: 'transport',
				label: 'RTSP transport',
				width: 4,
				default: 'tcp',
				choices: [
					{ id: 'tcp', label: 'TCP (recommended)' },
					{ id: 'udp', label: 'UDP' },
				],
			},
			{
				type: 'number',
				id: 'fps',
				label: 'Thumbnail FPS',
				width: 4,
				default: 5,
				min: 1,
				max: 30,
				clampValues: true,
			},
			{
				type: 'number',
				id: 'decodeWidth',
				label: 'Working resolution (width px)',
				width: 4,
				default: 640,
				min: 160,
				max: 1920,
				clampValues: true,
				description: 'Every layout is cut from this. Raise it for large grids (needs a stream that big).',
			},
			{
				type: 'number',
				id: 'size',
				label: 'Key render size (px)',
				width: 4,
				default: 144,
				min: 32,
				max: 720,
				clampValues: true,
			},
			{
				type: 'number',
				id: 'stallTimeout',
				label: 'Restart if no frames for (s)',
				width: 4,
				default: 8,
				min: 2,
				max: 120,
				clampValues: true,
			},
			{
				type: 'number',
				id: 'retryDelay',
				label: 'Reconnect delay (s)',
				width: 4,
				default: 3,
				min: 1,
				max: 60,
				clampValues: true,
			},
			{
				type: 'textinput',
				id: 'ffmpegPath',
				label: 'ffmpeg path (optional)',
				width: 6,
				default: '',
				description: 'Leave blank to use the bundled ffmpeg, or ffmpeg on PATH. e.g. C:\\ffmpeg\\bin\\ffmpeg.exe',
			},
			{
				type: 'textinput',
				id: 'extraInputArgs',
				label: 'Extra ffmpeg input args (advanced)',
				width: 6,
				default: '',
			},
		]
	}

	// ---- ffmpeg lifecycle --------------------------------------------------

	#start() {
		if (this.#destroyed || this.#proc) return
		clearTimeout(this.#restartTimer)
		this.#restartTimer = null

		const url = (this.config.url || '').trim()
		if (!url) {
			this.updateStatus(InstanceStatus.BadConfig, 'No stream URL')
			return
		}

		const bin = resolveFfmpeg(this.config.ffmpegPath)
		const args = buildArgs(this.config)
		this.log('debug', `spawn ${bin} ${args.join(' ')}`)

		this.updateStatus(InstanceStatus.Connecting)
		this.#splitter.reset()
		this.#lastFrameAt = Date.now() // grace period for first frame
		this.#lastError = ''

		let proc
		try {
			proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
		} catch (e) {
			this.updateStatus(InstanceStatus.UnknownError, `Failed to start ffmpeg: ${e.message}`)
			this.#scheduleRestart()
			return
		}
		this.#proc = proc

		proc.stdout.on('data', (chunk) => this.#splitter.push(chunk))
		proc.stderr.on('data', (d) => {
			const line = d.toString().trim().split(/\r?\n/).pop()
			if (line) this.#lastError = line.slice(0, 200)
		})
		const onDead = (code) => {
			if (this.#proc !== proc) return
			this.#proc = null
			if (this.#destroyed) return
			this.#setStreamUp(false)
			const msg = this.#lastError || `ffmpeg exited (${code})`
			if (msg !== this.#lastLogged) this.log('warn', msg) // don't spam the log every retry
			this.#lastLogged = msg
			this.updateStatus(InstanceStatus.ConnectionFailure, msg)
			this.#scheduleRestart()
		}
		proc.on('error', (e) => {
			this.#lastError = e.code === 'ENOENT' ? `ffmpeg not found (${bin})` : e.message
			onDead(null)
		})
		proc.on('close', onDead)
	}

	#stop() {
		clearTimeout(this.#restartTimer)
		this.#restartTimer = null
		const proc = this.#proc
		this.#proc = null
		if (proc) {
			proc.stdout.removeAllListeners()
			proc.kill('SIGKILL')
		}
		this.#setStreamUp(false)
	}

	#scheduleRestart() {
		if (this.#destroyed || this.#restartTimer) return
		const delay = (Number(this.config.retryDelay) || 3) * 1000
		this.#restartTimer = setTimeout(() => {
			this.#restartTimer = null
			this.#start()
		}, delay)
	}

	#tick() {
		this.setVariableValues({ fps: this.#frameCount })
		this.#frameCount = 0

		if (!this.#proc) return
		const stall = (Number(this.config.stallTimeout) || 8) * 1000
		if (Date.now() - this.#lastFrameAt > stall) {
			this.#lastError = this.#lastError || 'No frames received (stalled)'
			this.#proc.kill('SIGKILL') // 'close' handler schedules the restart
		}
	}

	#onFrame(frame) {
		this.#frame = frame
		this.#tileCache.clear()
		this.#lastFrameAt = Date.now()
		this.#frameCount++
		if (!this.#streamUp) {
			this.updateStatus(InstanceStatus.Ok)
			this.log('info', `Stream up (${frame.width}x${frame.height})`)
			this.#lastLogged = ''
			this.#setStreamUp(true)
			this.setVariableValues({ resolution: `${frame.width}x${frame.height}` })
		}
		this.checkFeedbacks('thumbnail')
	}

	#setStreamUp(up) {
		if (this.#streamUp === up) return
		this.#streamUp = up
		this.setVariableValues({ status: up ? 'live' : 'down' })
		this.checkFeedbacks('stream_down', 'thumbnail')
	}

	// ---- tiles -------------------------------------------------------------

	/**
	 * Resolve a feedback's layout. Feedbacks saved by v0.1/v0.2 lack the layout
	 * options, so fall back to the old connection-level grid/framing settings.
	 */
	#layout(o) {
		const c = this.config
		const pick = (v, legacy) => (v === undefined || v === null || v === '' ? legacy : v)
		const legacyFraming = c.aspect === 'full' ? 'fit' : 'fill'
		const size = clampInt(c.size, 32, 720, 144)
		return {
			cols: clampInt(pick(o.cols, c.cols), 1, 8, 1),
			rows: clampInt(pick(o.rows, c.rows), 1, 8, 1),
			col: clampInt(o.col, 1, 8, 1),
			row: clampInt(o.row, 1, 8, 1),
			gapPct: clampInt(pick(o.gap, c.gap), 0, 100, 0),
			framing: pick(o.framing, legacyFraming) === 'fit' ? 'fit' : 'fill',
			th: size,
			tw: o.shape === 'wide' ? size * 2 : size,
		}
	}

	#getTile(L) {
		if (!this.#frame) return null
		if (L.col > L.cols || L.row > L.rows) return null
		const key = `${L.cols}x${L.rows}:${L.col},${L.row}:${L.gapPct}:${L.framing}:${L.tw}x${L.th}`
		let png64 = this.#tileCache.get(key)
		if (!png64) {
			const rgb = renderTile(this.#frame, L)
			png64 = encodeTile(rgb, L.tw, 0, 0, L.tw, L.th).toString('base64')
			this.#tileCache.set(key, png64)
		}
		return png64
	}

	// ---- Companion definitions ---------------------------------------------

	#defineFeedbacks() {
		const num = (id, label, def, min, max, extra = {}) => ({
			type: 'number',
			id,
			label,
			default: def,
			min,
			max,
			clampValues: true,
			...extra,
		})

		this.setFeedbackDefinitions({
			thumbnail: {
				type: 'advanced',
				name: 'Live thumbnail (button background)',
				description:
					'Draws the stream on this button. For a multi-key image, set the grid size and this button’s column/row. Leave 1×1 for a single key.',
				affectedProperties: ['png64'],
				options: [
					{
						type: 'dropdown',
						id: 'shape',
						label: 'Key shape',
						default: 'square',
						choices: [
							{ id: 'square', label: 'Square (normal keys)' },
							{ id: 'wide', label: 'Wide 2:1 (Stream Deck + / + XL strip)' },
						],
					},
					num('cols', 'Grid columns', 1, 1, 8),
					num('rows', 'Grid rows', 1, 1, 8),
					num('col', 'This button: column', 1, 1, 8),
					num('row', 'This button: row', 1, 1, 8),
					num('gap', 'Gap between keys (% of key)', 0, 0, 100, {
						description: 'Picture hidden under the physical gap so the image lines up. Tune by eye.',
					}),
					{
						type: 'dropdown',
						id: 'framing',
						label: 'Framing',
						default: 'fill',
						choices: [
							{ id: 'fill', label: 'Fill (crop to grid shape)' },
							{ id: 'fit', label: 'Fit (whole frame, black bars)' },
						],
					},
					{
						type: 'dropdown',
						id: 'whenDown',
						label: 'When stream is down',
						default: 'keep',
						choices: [
							{ id: 'keep', label: 'Keep last frame' },
							{ id: 'clear', label: 'Clear image' },
						],
					},
				],
				callback: (fb) => {
					if (!this.#streamUp && fb.options.whenDown === 'clear') return {}
					try {
						const png64 = this.#getTile(this.#layout(fb.options))
						return png64 ? { png64 } : {}
					} catch (e) {
						const msg = `Tile render failed: ${e.message}`
						if (msg !== this.#lastRenderError) this.log('error', msg)
						this.#lastRenderError = msg
						return {}
					}
				},
			},
			stream_down: {
				type: 'boolean',
				name: 'Stream is down',
				defaultStyle: { bgcolor: 0x990000, color: 0xffffff },
				options: [],
				callback: () => !this.#streamUp,
			},
		})
	}

	#defineVariables() {
		this.setVariableDefinitions({
			status: { name: 'Stream status (live/down)' },
			fps: { name: 'Measured thumbnail FPS' },
			resolution: { name: 'Working resolution' },
		})
		this.setVariableValues({ status: 'down', fps: 0, resolution: '' })
	}
}
