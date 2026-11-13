// Shared helpers: load go2rtc's <video-stream> element and build players.
export async function loadPlayer() {
  for (let attempt = 0; ; attempt++) {
    if (customElements.get('video-stream')) return true;
    try {
      await import(`/g2/video-stream.js?t=${Date.now()}`);
      if (customElements.get('video-stream')) return true;
    } catch (e) { /* go2rtc not up yet */ }
    await new Promise(r => setTimeout(r, Math.min(2000 * (attempt + 1), 10000)));
  }
}

export function wsUrl(state, id) {
  // Streams go through RTSPmv's own port (/stream); go2rtc stays local to the box.
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/stream?src=${encodeURIComponent(id)}`;
}

export function makePlayer(state, id) {
  const p = document.createElement('video-stream');
  // Firefox: MSE first. Its WebRTC H.264 needs the OpenH264 plugin (often
  // missing in a fresh profile) and decodes in software; MSE uses VA-API.
  p.mode = /firefox/i.test(navigator.userAgent) ? 'mse,webrtc,hls' : 'webrtc,mse,hls';
  p.background = false;       // stop decoding when the tile is hidden
  p.visibilityCheck = false;  // keep playing when the browser window isn't focused
  p.src = wsUrl(state, id);
  return p;
}

export function videoOf(player) {
  return player && (player.video || player.querySelector('video'));
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function areaOf(t) {
  return `${t[0]} / ${t[1]} / span ${t[2]} / span ${t[3]}`;
}
