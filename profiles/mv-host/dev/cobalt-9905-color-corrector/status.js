// Status-wall logic: compact format strings and per-path health.
// Pure functions over the module's state, so they are easy to test.

// "1920x1080p 59.94 A BT.2020" -> "1080p59.94"; "1280x720p 59.94" -> "720p59.94"; "525i 59.94" -> "525i59.94"
function shortFormat(str) {
	if (typeof str !== 'string') return ''
	const m = str.match(/(?:\d+x)?(\d+)(psf|p|i)\s+([\d.]+)/)
	return m ? `${m[1]}${m[2]}${m[3]}` : str.trim()
}

// Transfer function from an input status string ("... BT.2020 HLG ...").
function oetfOf(str) {
	if (typeof str !== 'string') return ''
	if (/\bHLG\b/.test(str)) return 'HLG'
	if (/\bPQ\b|2084/.test(str)) return 'PQ'
	if (/\bSDR\b/.test(str)) return 'SDR'
	return ''
}

const isNum = (v) => typeof v === 'number' && !Number.isNaN(v)
const near = (a, b) => Math.abs(a - b) < 1e-6

// Settings that "ZERO" puts back, and the value it puts them back to.
function zeroTargets(zeroFrameDelay) {
	return {
		luma_gain: 100,
		luma_lift: 0,
		color_gain: 100,
		color_phase: 0,
		red_black: 0,
		green_black: 0,
		blue_black: 0,
		red_gain: 100,
		green_gain: 100,
		blue_gain: 100,
		red_gamma: 1,
		green_gamma: 1,
		blue_gamma: 1,
		lut_processing: 0,
		source_oetf: 0,
		source_colorimetry: 0,
		fs_output_mode: 0,
		fs_frame_delay: zeroFrameDelay,
	}
}

/**
 * Health of one path.
 *   s      = state.path[path]           (values)
 *   colors = state.color.path[path]     (web-UI hint colors for icon fields)
 *   card   = state.card                 (card-wide values, for SDI IN strings)
 */
function pathHealth(s, colors, card, opts) {
	const { showFormat = -1, zeroFrameDelay = 0 } = opts || {}
	const srcColor = colors.source_status
	const lockColor = colors.lock_status
	const alarm = s.fs_alarm
	const known = srcColor !== undefined

	const noInput = known && srcColor !== 'green'
	const unlocked = lockColor !== undefined && lockColor !== 'green'
	const alarmError = isNum(alarm) && (alarm & 0b10) !== 0 // bit 1: rate mismatch (error)
	const formatWrong =
		showFormat >= 0 &&
		((isNum(s.scaler_enable) && s.scaler_enable !== 1) ||
			(isNum(s.scaler_output_format) && s.scaler_output_format !== showFormat))

	const notZeroKeys = []
	for (const [key, target] of Object.entries(zeroTargets(zeroFrameDelay))) {
		if (isNum(s[key]) && !near(s[key], target)) notZeroKeys.push(key)
	}

	const problem = noInput || unlocked || alarmError || formatWrong
	let text = 'OK'
	if (!known) text = '…'
	else if (noInput) text = 'NO INPUT'
	else if (unlocked) text = 'UNLOCKED'
	else if (alarmError) text = 'RATE ERR'
	else if (formatWrong) text = 'WRONG FMT'
	else if (notZeroKeys.length) text = 'NOT ZERO'

	// Compact input description: format from the path's Source Status, OETF from the
	// SDI input it is routed from (Source Select 0..4 -> SDI IN 1..5).
	let input = ''
	if (known) {
		if (noInput) input = 'NO INPUT'
		else {
			const sdi = isNum(s.source) ? card[`sdi_in_${s.source + 1}_info`] : undefined
			input = [shortFormat(s.source_status), oetfOf(sdi) || oetfOf(s.source_status)].filter(Boolean).join(' ')
		}
	}

	return {
		known,
		ok: known && !problem && notZeroKeys.length === 0,
		inputOk: known && !problem,
		problem,
		notZero: notZeroKeys.length > 0,
		notZeroKeys,
		text,
		input,
		output: shortFormat(s.output_format),
	}
}

function ipFromInt(n) {
	if (typeof n !== 'number') return n
	const u = n >>> 0
	return [u >>> 24, (u >>> 16) & 255, (u >>> 8) & 255, u & 255].join('.')
}

function alarmText(param, value) {
	if (!isNum(value)) return value
	const set = (param.alarms || []).filter((a) => a.bit > 0 && value & (1 << a.bit)).map((a) => a.label)
	return set.length ? set.join(', ') : 'OK'
}

module.exports = { shortFormat, oetfOf, pathHealth, zeroTargets, ipFromInt, alarmText }
