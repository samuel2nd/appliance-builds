import zlib from 'node:zlib'

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// Own CRC32: zlib.crc32 only exists in Node >= 22.2, and Companion's bundled runtime may be older
const CRC_TABLE = new Int32Array(256)
for (let n = 0; n < 256; n++) {
	let c = n
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
	CRC_TABLE[n] = c
}
function crc32(buf) {
	let c = -1
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
	return (c ^ -1) >>> 0
}

function chunk(type, data) {
	const len = Buffer.alloc(4)
	len.writeUInt32BE(data.length)
	const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(crc32(td))
	return Buffer.concat([len, td, crc])
}

/**
 * Encode a w×h region of an RGB24 frame as PNG.
 * @param {Buffer} frame  full frame, frameW*frameH*3 bytes
 */
export function encodeTile(frame, frameW, x, y, w, h) {
	const stride = w * 3
	const raw = Buffer.alloc((stride + 1) * h)
	for (let row = 0; row < h; row++) {
		const src = ((y + row) * frameW + x) * 3
		const dst = row * (stride + 1)
		raw[dst] = 0 // filter: none
		frame.copy(raw, dst + 1, src, src + stride)
	}
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(w, 0)
	ihdr.writeUInt32BE(h, 4)
	ihdr[8] = 8 // bit depth
	ihdr[9] = 2 // colour type RGB
	return Buffer.concat([
		SIG,
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(raw, { level: 1 })),
		chunk('IEND', Buffer.alloc(0)),
	])
}
