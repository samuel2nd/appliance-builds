// Cuts one key's tile out of a virtual multi-key canvas laid over the source frame.
//
// Canvas: cols×rows keys of `size` px, with `gap` px of hidden picture between keys
// (covers the physical gap on the surface so the image lines up).
// fill = scale source to cover the canvas (crop); fit = scale to fit (black bars).

/**
 * @param {{width:number,height:number,data:Buffer}} frame RGB24 source
 * @param {{cols,rows,col,row,tw,th,gapPct,framing}} L layout (tw×th = one key)
 * @returns {Buffer} RGB24, tw×th
 */
export function renderTile(frame, L) {
	const { width: sw, height: sh, data: src } = frame
	const TW = L.tw
	const TH = L.th
	const g = Math.round((TH * L.gapPct) / 100) // gap as % of key height, same on both axes
	const cw = L.cols * TW + (L.cols - 1) * g
	const ch = L.rows * TH + (L.rows - 1) * g

	const k = L.framing === 'fit' ? Math.min(cw / sw, ch / sh) : Math.max(cw / sw, ch / sh)
	const offX = (cw - sw * k) / 2
	const offY = (ch - sh * k) / 2
	const tileX = (L.col - 1) * (TW + g)
	const tileY = (L.row - 1) * (TH + g)

	const out = Buffer.alloc(TW * TH * 3)
	const inv = 1 / k

	if (k < 1) {
		// Downscale: area average over each output pixel's footprint
		for (let j = 0; j < TH; j++) {
			const v0 = (tileY + j - offY) * inv
			const y0 = Math.max(0, Math.floor(v0))
			const y1 = Math.min(sh, Math.max(y0 + 1, Math.floor(v0 + inv)))
			for (let i = 0; i < TW; i++) {
				const u0 = (tileX + i - offX) * inv
				if (v0 + inv <= 0 || v0 >= sh || u0 + inv <= 0 || u0 >= sw) continue // outside source: black
				const x0 = Math.max(0, Math.floor(u0))
				const x1 = Math.min(sw, Math.max(x0 + 1, Math.floor(u0 + inv)))
				let r = 0,
					gg = 0,
					b = 0,
					n = 0
				for (let y = y0; y < y1; y++) {
					let p = (y * sw + x0) * 3
					for (let x = x0; x < x1; x++, p += 3) {
						r += src[p]
						gg += src[p + 1]
						b += src[p + 2]
						n++
					}
				}
				const o = (j * TW + i) * 3
				out[o] = r / n
				out[o + 1] = gg / n
				out[o + 2] = b / n
			}
		}
	} else {
		// Upscale: bilinear
		for (let j = 0; j < TH; j++) {
			const v = (tileY + j + 0.5 - offY) * inv - 0.5
			if (v < -0.5 || v > sh - 0.5) continue
			const yA = Math.max(0, Math.min(sh - 1, Math.floor(v)))
			const yB = Math.min(sh - 1, yA + 1)
			const fy = Math.min(1, Math.max(0, v - yA))
			for (let i = 0; i < TW; i++) {
				const u = (tileX + i + 0.5 - offX) * inv - 0.5
				if (u < -0.5 || u > sw - 0.5) continue
				const xA = Math.max(0, Math.min(sw - 1, Math.floor(u)))
				const xB = Math.min(sw - 1, xA + 1)
				const fx = Math.min(1, Math.max(0, u - xA))
				const pAA = (yA * sw + xA) * 3
				const pAB = (yA * sw + xB) * 3
				const pBA = (yB * sw + xA) * 3
				const pBB = (yB * sw + xB) * 3
				const o = (j * TW + i) * 3
				for (let c = 0; c < 3; c++) {
					const top = src[pAA + c] + (src[pAB + c] - src[pAA + c]) * fx
					const bot = src[pBA + c] + (src[pBB + c] - src[pBA + c]) * fx
					out[o + c] = top + (bot - top) * fy
				}
			}
		}
	}
	return out
}
