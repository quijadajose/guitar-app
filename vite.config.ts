import { defineConfig, loadEnv, type Plugin } from 'vite';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Origen (scheme://host[:port]) de una URL, o null si no es http(s). */
function originOf(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function wsOriginOf(origin: string | null): string | null {
  if (!origin) return null;
  return origin.replace(/^http(s?):/, 'ws$1:');
}

function buildCsp(env: Record<string, string>, forMeta: boolean): string {
  const supabase = originOf(env.VITE_SUPABASE_URL);
  const server = originOf(env.VITE_SERVER_URL);
  // Antes connect-src era solo 'self': bloqueaba Supabase y el servidor de salas.
  const connect = ["'self'", supabase, wsOriginOf(supabase), server, wsOriginOf(server)]
    .filter((item): item is string => Boolean(item));
  const directives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    `connect-src ${[...new Set(connect)].join(' ')}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ];
  // frame-ancestors no funciona dentro de <meta>; solo como cabecera.
  if (!forMeta) directives.push("frame-ancestors 'none'");
  return directives.join('; ');
}

/**
 * GitHub Pages ignora el archivo _headers, así que la CSP también va en un <meta>
 * del index.html. Para hosts que sí leen _headers (Netlify, Cloudflare Pages)
 * se genera con los mismos orígenes.
 */
function securityHeadersPlugin(env: Record<string, string>): Plugin {
  let outDir = 'dist';
  return {
    name: 'guitar-security-headers',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        // En dev Vite inyecta scripts inline (HMR); la CSP estricta solo va en el build.
        if (ctx.server) return html;
        const meta = `<meta http-equiv="Content-Security-Policy" content="${buildCsp(env, true)}">`;
        return html.replace('<meta charset="UTF-8">', `<meta charset="UTF-8">\n  ${meta}`);
      }
    },
    closeBundle() {
      const headers = [
        '/*',
        `  Content-Security-Policy: ${buildCsp(env, false)}`,
        '  Permissions-Policy: camera=(), geolocation=(), microphone=(self)',
        '  X-Content-Type-Options: nosniff',
        '  Referrer-Policy: strict-origin-when-cross-origin',
        '  X-Frame-Options: DENY',
        ''
      ].join('\n');
      try {
        writeFileSync(resolve(outDir, '_headers'), headers);
      } catch {
        // sin carpeta de salida (por ejemplo en tests): nada que escribir
      }
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (mode === 'production' && env.VITE_SERVER_URL && !env.VITE_SERVER_URL.startsWith('https://')) {
    throw new Error('VITE_SERVER_URL debe ser https:// en producción (si no, el WebSocket viaja sin cifrar).');
  }
  return {
    base: '/guitar-app/',
    plugins: [securityHeadersPlugin(env)],
    preview: {
      headers: {
        'Content-Security-Policy': buildCsp(env, false),
        'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self)',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Frame-Options': 'DENY'
      }
    },
    worker: {
      format: 'es'
    }
  };
});
