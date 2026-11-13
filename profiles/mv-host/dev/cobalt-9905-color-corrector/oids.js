// OID table for Cobalt 9905-MPx — Color Correction Proc & Color Correction tabs
// Source: Cobalt's own model definition (models_9905MPX.txt, from OGCP-9000 panel config)
// and live-verified WebSocket traffic against a real 9905-MPx card (2026-09).
// All oids below are confirmed, not guessed.

module.exports = {
	// Path selection — must be sent before any path-scoped oid below to select
	// which of the 4 signal paths on the card subsequent writes apply to.
	PATH_SELECT: 4864, // choice 0-3 = Path 1-4

	// --- Color Proc sub-tab ---
	VIDEO_PROC_ENABLE: 6145, // choice 1=Enable, 0=Disable
	PROC_RESET_TO_UNITY: 6146, // choice 0=Confirm, 1=Applying (write 1 to trigger)
	LUMA_GAIN: 6147, // float 0.0-200.0, step 0.1, default 100.0
	LUMA_LIFT: 6148, // float -100.0-100.0, step 0.1, default 0.0
	COLOR_GAIN: 6149, // float 0.0-200.0, step 0.1, default 100.0
	COLOR_PHASE: 6150, // float -360.0-360.0, step 0.1, default 0.0
	GANG_LUMA_COLOR_GAIN: 6151, // choice 0=Off, 1=On

	// --- Color Correction sub-tab ---
	COLOR_CORRECTOR_ENABLE: 6152, // choice 1=Enable, 0=Disable
	CC_RESET_TO_UNITY: 6153, // choice 0=Confirm, 1=Applying (write 1 to trigger)
	RED_BLACK: 6154, // float -100.0-100.0 %, default 0.0
	GREEN_BLACK: 6155, // float -100.0-100.0 %, default 0.0
	BLUE_BLACK: 6156, // float -100.0-100.0 %, default 0.0
	RED_GAIN: 6157, // float 0.0-200.0 %, default 100.0
	GREEN_GAIN: 6158, // float 0.0-200.0 %, default 100.0
	BLUE_GAIN: 6159, // float 0.0-200.0 %, default 100.0
	RED_GAMMA: 6160, // float 0.125-8.0, default 1.0
	GREEN_GAMMA: 6161, // float 0.125-8.0, default 1.0
	BLUE_GAMMA: 6162, // float 0.125-8.0, default 1.0
	GANG_BLACK_OFFSET: 6163, // choice 0=Off, 1=On
	GANG_WHITE_GAIN: 6164, // choice 0=Off, 1=On
	GANG_GAMMA: 6165, // choice 0=Off, 1=On
	BLACK_HARD_CLIP: 6166, // float -6.8-50.0, default -6.8
	WHITE_HARD_CLIP: 6167, // float 50.0-109, default 109.1
	WHITE_SOFT_CLIP: 6168, // float 50.0-109, default 109.1
	CHROMA_SATURATION_CLIP: 6169, // float 50.0-160.0, default 160.0
}
