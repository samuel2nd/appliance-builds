// Splits ffmpeg's image2pipe PAM output into frames. Each PAM frame carries its
// own WIDTH/HEIGHT/DEPTH header, so source resolution never has to be guessed.

const END = Buffer.from('ENDHDR\n', 'latin1')
const MAX_HEADER = 256

export class PamSplitter {
	#chunks = []
	#bytes = 0
	#onFrame

	constructor(onFrame) {
		this.#onFrame = onFrame
	}

	reset() {
		this.#chunks = []
		this.#bytes = 0
	}

	push(chunk) {
		this.#chunks.push(chunk)
		this.#bytes += chunk.length

		let buf = null
		let latest = null
		for (;;) {
			if (!buf) buf = this.#chunks.length === 1 ? this.#chunks[0] : Buffer.concat(this.#chunks, this.#bytes)

			const hdrEnd = buf.indexOf(END)
			if (hdrEnd === -1) {
				if (buf.length > MAX_HEADER && buf.indexOf('P7') !== 0) buf = buf.subarray(buf.length - MAX_HEADER) // garbage
				break
			}
			const hdr = parseHeader(buf.toString('latin1', 0, hdrEnd))
			const start = hdrEnd + END.length
			if (!hdr) {
				buf = buf.subarray(start) // unreadable header, skip it
				continue
			}
			const size = hdr.width * hdr.height * hdr.depth
			if (buf.length < start + size) break

			latest = { ...hdr, data: buf.subarray(start, start + size) }
			buf = buf.subarray(start + size)
		}

		this.#chunks = buf && buf.length ? [Buffer.from(buf)] : []
		this.#bytes = buf ? buf.length : 0
		if (latest) this.#onFrame({ ...latest, data: Buffer.from(latest.data) }) // only the newest frame matters
	}
}

function parseHeader(text) {
	const m = (k) => Number((text.match(new RegExp(`${k}\\s+(\\d+)`)) || [])[1])
	const width = m('WIDTH')
	const height = m('HEIGHT')
	const depth = m('DEPTH')
	if (!text.startsWith('P7') || !width || !height || depth !== 3) return null
	return { width, height, depth }
}
