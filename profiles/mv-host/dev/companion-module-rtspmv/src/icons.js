// Draws layout diagrams as small PNGs (white lines, transparent background) for button
// images, so the button's bgcolor (and feedback color) shows through. No dependencies.
const zlib = require('zlib')

const CRC_TABLE = (() => {
	const t = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		t[n] = c >>> 0
	}
	return t
})()

function crc32(buf) {
	let c = 0xffffffff
	for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
	const len = Buffer.alloc(4)
	len.writeUInt32BE(data.length)
	const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(crc32(td))
	return Buffer.concat([len, td, crc])
}

function encodePng(w, h, rgba) {
	const raw = Buffer.alloc((w * 4 + 1) * h)
	for (let y = 0; y < h; y++) {
		raw[y * (w * 4 + 1)] = 0 // filter: none
		rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
	}
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(w, 0)
	ihdr.writeUInt32BE(h, 4)
	ihdr[8] = 8 // bit depth
	ihdr[9] = 6 // RGBA
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0)),
	])
}

/**
 * @param {{cols:number, rows:number, tiles:number[][]}} layout  tiles = [row, col, rowspan, colspan], 1-based
 * @returns {string} base64 PNG
 */
function layoutPng(layout, size = 72) {
	const W = size,
		H = size
	const px = Buffer.alloc(W * H * 4) // transparent
	const line = Math.max(2, Math.round(size / 36)) // 2px at 72
	// 16:9 frame, centered
	const fw = Math.round(size * 0.86)
	const fh = Math.round((fw * 9) / 16)
	const x0 = Math.round((W - fw) / 2)
	const y0 = Math.round((H - fh) / 2)
	const xs = (c) => x0 + Math.round(((c - 1) * (fw - line)) / layout.cols) // left edge of column c
	const ys = (r) => y0 + Math.round(((r - 1) * (fh - line)) / layout.rows)

	const fill = (x, y, w, h) => {
		for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy++)
			for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx++) {
				const i = (yy * W + xx) * 4
				px[i] = px[i + 1] = px[i + 2] = 255
				px[i + 3] = 255
			}
	}

	for (const [r, c, rs, cs] of layout.tiles) {
		const l = xs(c),
			t = ys(r)
		const rgt = xs(c + cs),
			btm = ys(r + rs)
		fill(l, t, rgt - l + line, line) // top
		fill(l, btm, rgt - l + line, line) // bottom
		fill(l, t, line, btm - t + line) // left
		fill(rgt, t, line, btm - t + line) // right
	}
	return encodePng(W, H, px).toString('base64')
}

module.exports = { layoutPng }
