import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** Config path > bundled ffmpeg-static > ffmpeg on PATH */
export function resolveFfmpeg(configPath) {
	const p = (configPath || '').trim().replace(/^"(.*)"$/, '$1')
	if (p) return p
	try {
		const bundled = require('ffmpeg-static')
		if (bundled) return bundled
	} catch {
		// optional dependency not installed
	}
	return 'ffmpeg'
}

export function buildArgs(cfg) {
	const url = cfg.url.trim()
	const fps = clampInt(cfg.fps, 1, 30, 5)
	const width = clampInt(cfg.decodeWidth, 160, 1920, 640)

	const args = ['-hide_banner', '-loglevel', 'error', '-nostdin']

	if (/^rtsps?:\/\//i.test(url)) {
		args.push('-rtsp_transport', cfg.transport === 'udp' ? 'udp' : 'tcp')
	}

	args.push('-fflags', 'nobuffer', '-flags', 'low_delay', '-an', '-sn', '-dn')
	if (cfg.extraInputArgs) args.push(...splitArgs(cfg.extraInputArgs))
	args.push('-i', url)

	// Decode once at a working resolution, keeping the source aspect.
	// Never upscale past the source. Tiles are cut and resampled in the module.
	args.push('-vf', `fps=${fps},scale='min(${width},iw)':-2,setsar=1`)
	args.push('-pix_fmt', 'rgb24', '-c:v', 'pam', '-f', 'image2pipe', 'pipe:1')
	return args
}

export function clampInt(v, min, max, def) {
	const n = Math.round(Number(v))
	if (!Number.isFinite(n)) return def
	return Math.min(max, Math.max(min, n))
}

function splitArgs(str) {
	return (String(str).match(/"[^"]*"|\S+/g) || []).map((s) => s.replace(/^"(.*)"$/, '$1'))
}
