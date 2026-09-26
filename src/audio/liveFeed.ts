export interface LiveFrame {
  tag: string;
  rms: number;
  freq: number | null;
  note: string | null;
  cents: number | null;
  wave: number[];
}

let lastSent = 0;
let relayAvailable = true;

/** Off until the live/multiplayer server is deployed. Single-player does not need it. */
const LIVE_RELAY = false;

/** Sends tuner frames to the local live server (port 8787). */
export function publishLiveFrame(frame: LiveFrame): void {
  if (!LIVE_RELAY || !relayAvailable || location.hostname.endsWith('github.io')) return;
  const now = performance.now();
  if (now - lastSent < 120) return;
  lastSent = now;
  fetch('/api/frame', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(frame)
  }).then(response => {
    if (!response.ok) relayAvailable = false;
  }).catch(() => {
    relayAvailable = false;
  });
}
