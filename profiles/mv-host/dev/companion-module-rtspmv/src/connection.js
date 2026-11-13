// Live connection to an RTSPmv server: Server-Sent Events from /api/events
// with automatic reconnect and a stall watchdog (server pings every 15 s).

const STALL_MS = 40000

class RtspmvConnection {
	/**
	 * @param {object} o
	 * @param {string} o.baseUrl   e.g. http://<rtspmv-host>:8090
	 * @param {(state:object)=>void} o.onState
	 * @param {(ok:boolean, msg?:string)=>void} o.onStatus
	 * @param {(level:string, msg:string)=>void} o.log
	 */
	constructor({ baseUrl, onState, onStatus, log }) {
		this.baseUrl = baseUrl
		this.onState = onState
		this.onStatus = onStatus
		this.log = log
		this.stopped = false
		this.abort = null
		this.retryTimer = null
		this.stallTimer = null
		this.delay = 1000
		this.wasUp = null
	}

	start() {
		this.stopped = false
		this.run()
	}

	stop() {
		this.stopped = true
		clearTimeout(this.retryTimer)
		clearTimeout(this.stallTimer)
		if (this.abort) this.abort.abort()
		this.abort = null
	}

	setStatus(ok, msg) {
		if (ok !== this.wasUp) {
			this.log(ok ? 'info' : 'warn', ok ? `Connected to ${this.baseUrl}` : `Disconnected: ${msg}`)
		}
		this.wasUp = ok
		this.onStatus(ok, msg)
	}

	kickStall() {
		clearTimeout(this.stallTimer)
		this.stallTimer = setTimeout(() => {
			if (this.abort) this.abort.abort(new Error('no data from server'))
		}, STALL_MS)
	}

	async run() {
		if (this.stopped) return
		this.abort = new AbortController()
		let reason = 'connection closed'
		try {
			const res = await fetch(`${this.baseUrl}/api/events`, {
				signal: this.abort.signal,
				headers: { Accept: 'text/event-stream' },
			})
			if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
			this.delay = 1000
			this.kickStall()
			const decoder = new TextDecoder()
			let buf = ''
			for await (const chunk of res.body) {
				this.kickStall()
				buf += decoder.decode(chunk, { stream: true })
				let idx
				while ((idx = buf.indexOf('\n\n')) >= 0) {
					const event = buf.slice(0, idx)
					buf = buf.slice(idx + 2)
					const data = event
						.split('\n')
						.filter((l) => l.startsWith('data:'))
						.map((l) => l.slice(5).trimStart())
						.join('\n')
					if (!data) continue
					try {
						const state = JSON.parse(data)
						this.setStatus(true)
						this.onState(state)
					} catch (e) {
						this.log('debug', `Bad event: ${e.message}`)
					}
				}
			}
		} catch (e) {
			reason = (e && (e.cause?.code || e.message)) || String(e)
		} finally {
			clearTimeout(this.stallTimer)
		}
		if (this.stopped) return
		this.setStatus(false, reason)
		this.retryTimer = setTimeout(() => this.run(), this.delay)
		this.delay = Math.min(this.delay * 2, 10000)
	}

	/** Send an API command; resolves with the new state or throws with the server's error text. */
	async command(cmd, params = {}) {
		const qs = new URLSearchParams()
		for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
		const url = `${this.baseUrl}/api/${cmd}${qs.toString() ? '?' + qs : ''}`
		const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
		let body = null
		try {
			body = await res.json()
		} catch {
			/* non-JSON */
		}
		if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`)
		return body
	}
}

module.exports = { RtspmvConnection }
