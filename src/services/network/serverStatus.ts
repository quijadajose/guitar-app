const PROBE_MS = 6000;

export function multiplayerOrigin(): string {
  const envUrl = import.meta.env.VITE_SERVER_URL;
  if (envUrl) {
    return envUrl.replace(/\/+$/, '');
  }
  const host = window.location.hostname || 'localhost';
  return `http://${host}:3001`;
}

export function multiplayerWsUrl(): string {
  const origin = multiplayerOrigin();
  const url = new URL(origin);
  const proto = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${url.host}/ws`;
}


/** True only when GET /health answers. If the process is down, callers hide every API feature. */
export async function probeMultiplayerServer(): Promise<boolean> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PROBE_MS);
  try {
    const res = await fetch(`${multiplayerOrigin()}/health`, {
      cache: 'no-store',
      signal: controller.signal
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}
