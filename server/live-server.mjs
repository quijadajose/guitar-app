import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8787;
const HOST = '0.0.0.0';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const snapshotPath = path.join(root, 'server', 'live-latest.json');

const state = {
  updatedAt: 0,
  tag: 'ruido',
  rms: 0,
  freq: null,
  note: null,
  cents: null,
  wave: [],
  history: []
};

const clients = new Set();

function publish() {
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) res.write(payload);
  fs.writeFile(snapshotPath, JSON.stringify(state), () => {});
}

function dashboard() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Micrófono en vivo</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #0d0e10; color: #fff; }
    main { max-width: 880px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 22px; }
    .stats { display: flex; gap: 16px; flex-wrap: wrap; margin: 16px 0; }
    .stats div { background: #171a1f; border-radius: 12px; padding: 12px 16px; min-width: 120px; }
    .stats strong { display: block; font-size: 28px; }
    #phone-status.connected { color: #2ee59a; }
    canvas { width: 100%; height: 160px; background: #111; border-radius: 12px; }
    .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 12px 0; }
    .toolbar label { font-size: 14px; }
    .toolbar input { width: 72px; background: #171a1f; color: #fff; border: 1px solid #333; border-radius: 8px; padding: 8px; }
    .toolbar button { border: none; border-radius: 999px; padding: 8px 14px; font: inherit; font-weight: 700; background: #2ee59a; color: #04140e; cursor: pointer; }
    #log { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px 16px; }
    #log pre { margin: 0; font-size: 12px; line-height: 1.45; color: #c9d0d6; white-space: pre-wrap; }
    #log .t-time { color: #7eb6ff; }
    #log .t-tag { color: #f0c14a; }
    #log .t-rms { color: #3ee0c5; }
    #log .t-hz { color: #c9a0ff; }
    #log .t-note { color: #2ee59a; }
    @media (max-width: 900px) { #log { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    a { color: #2ee59a; }
  </style>
</head>
<body>
  <main>
    <h1>Micrófono del afinador</h1>
    <p id="phone-status">Teléfono desconectado</p>
    <p>Afinador en el teléfono: <a id="phone-link" href="/guitar-app/#tuner">/guitar-app/#tuner</a></p>
    <div class="stats">
      <div>marca<strong id="tag">—</strong></div>
      <div>rms<strong id="rms">—</strong></div>
      <div>Hz<strong id="hz">—</strong></div>
      <div>nota<strong id="note">—</strong></div>
    </div>
    <canvas id="wave" width="880" height="160"></canvas>
    <div class="toolbar">
      <label>Últimos <input id="seconds" type="number" min="1" max="120" value="10"> segundos</label>
      <button type="button" id="copy">Copiar</button>
      <button type="button" id="download">Descargar</button>
      <button type="button" id="clear">Limpiar</button>
    </div>
    <div id="log"></div>
  </main>
  <script>
    const phoneLink = document.getElementById('phone-link');
    phoneLink.href = location.origin + '/guitar-app/#tuner';
    phoneLink.textContent = phoneLink.href;
    const canvas = document.getElementById('wave');
    const ctx = canvas.getContext('2d');
    let latest = { history: [] };
    function windowText() {
      const seconds = Math.max(1, Number(document.getElementById('seconds').value) || 10);
      const from = Date.now() - seconds * 1000;
      return (latest.history || [])
        .filter((row) => row && row.t >= from)
        .map((row) => row.line)
        .join('\\n');
    }
    function paintLine(line) {
      const row = document.createElement('div');
      const match = line.match(/^(\\S+)\\s+(\\S+)\\s+rms=(\\S+)\\s+hz=(\\S+)(?:\\s+(\\S+))?/);
      const add = (className, text) => {
        const span = document.createElement('span');
        span.className = className;
        span.textContent = text;
        row.appendChild(span);
      };
      if (!match) {
        row.textContent = line;
        return row;
      }
      add('t-time', match[1]);
      row.appendChild(document.createTextNode(' '));
      add('t-tag', match[2]);
      row.appendChild(document.createTextNode(' '));
      add('t-rms', 'rms=' + match[3]);
      row.appendChild(document.createTextNode(' '));
      add('t-hz', 'hz=' + match[4]);
      if (match[5]) {
        row.appendChild(document.createTextNode(' '));
        add('t-note', match[5]);
      }
      return row;
    }
    function renderLog() {
      const lines = windowText().split('\\n').filter(Boolean);
      const columns = window.innerWidth < 900 ? 2 : 4;
      const perColumn = Math.max(1, Math.ceil(lines.length / columns));
      const log = document.getElementById('log');
      log.replaceChildren();
      for (let column = 0; column < columns; column++) {
        const block = document.createElement('pre');
        for (const line of lines.slice(column * perColumn, (column + 1) * perColumn)) {
          block.appendChild(paintLine(line));
        }
        log.appendChild(block);
      }
    }
    document.getElementById('seconds').addEventListener('input', renderLog);
    document.getElementById('copy').addEventListener('click', () => {
      navigator.clipboard.writeText(windowText());
    });
    document.getElementById('clear').addEventListener('click', () => {
      fetch('/api/clear', { method: 'POST' });
    });
    document.getElementById('download').addEventListener('click', () => {
      const blob = new Blob([windowText()], { type: 'text/plain' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'afinador-ultimos-segundos.txt';
      link.click();
      URL.revokeObjectURL(link.href);
    });
    const events = new EventSource('/api/events');
    events.onmessage = (event) => {
      const data = JSON.parse(event.data);
      latest = data;
      const status = document.getElementById('phone-status');
      const connected = data.updatedAt && Date.now() - data.updatedAt < 2000;
      status.textContent = connected ? 'Teléfono conectado' : 'Teléfono desconectado';
      status.classList.toggle('connected', connected);
      document.getElementById('tag').textContent = data.tag || '—';
      document.getElementById('rms').textContent = Number(data.rms || 0).toFixed(4);
      document.getElementById('hz').textContent = data.freq ? Number(data.freq).toFixed(1) : '—';
      document.getElementById('note').textContent = data.note ? data.note + ' ' + (data.cents ?? '') : '—';
      renderLog();
      const wave = data.wave || [];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#2ee59a';
      ctx.beginPath();
      wave.forEach((v, i) => {
        const x = (i / Math.max(1, wave.length - 1)) * canvas.width;
        const y = canvas.height / 2 - (v / 0.45) * (canvas.height / 2);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
  </script>
</body>
</html>`;
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (req.method === 'POST' && url.pathname === '/api/frame') {
    const body = JSON.parse(await readBody(req) || '{}');
    state.updatedAt = Date.now();
    state.tag = body.tag || state.tag;
    state.rms = body.rms ?? 0;
    state.freq = body.freq ?? null;
    state.note = body.note ?? null;
    state.cents = body.cents ?? null;
    state.wave = Array.isArray(body.wave) ? body.wave.slice(0, 256) : [];
    const line = `${new Date().toISOString().slice(11, 19)} ${state.tag} rms=${Number(state.rms).toFixed(4)} hz=${state.freq ?? '—'} ${state.note ?? ''}`;
    state.history.push({ t: state.updatedAt, line });
    const keepAfter = state.updatedAt - 120000;
    while (state.history.length > 0 && state.history[0].t < keepAfter) state.history.shift();
    publish();
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/clear') {
    state.history = [];
    publish();
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboard());
    return;
  }

  const rel = url.pathname.startsWith('/guitar-app')
    ? url.pathname.slice('/guitar-app'.length)
    : url.pathname;
  const filePath = path.normalize(path.join(dist, rel === '/' ? '/index.html' : rel));
  if (!filePath.startsWith(dist) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('No está el build. Corré npm run build.');
    return;
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`dashboard http://192.168.0.10:${PORT}/`);
  console.log(`afinador   http://192.168.0.10:${PORT}/guitar-app/#tuner`);
});
