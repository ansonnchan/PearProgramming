import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const proxyTarget = env.VITE_DEV_PROXY_TARGET?.trim();
  const proxyOrigin = env.VITE_DEV_PROXY_ORIGIN?.trim();

  return {
    define: {
      global: 'globalThis'
    },
    plugins: [react()],
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts'
    },
    server: {
      port: 5174,
      proxy: proxyTarget ? {
        '/api': devProxy(proxyTarget, proxyOrigin),
        '/healthz': devProxy(proxyTarget, proxyOrigin),
        '/ws': devProxy(proxyTarget, proxyOrigin, true)
      } : undefined
    }
  };
});

function devProxy(target: string, origin: string | undefined, websocket = false): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    secure: true,
    ws: websocket,
    configure(proxy) {
      const applyOrigin = (request: { setHeader: (name: string, value: string) => void }) => {
        if (origin) {
          request.setHeader('origin', origin);
        }
      };
      proxy.on('proxyReq', applyOrigin);
      proxy.on('proxyReqWs', applyOrigin);
      proxy.on('proxyRes', (response) => {
        const cookies = response.headers['set-cookie'];
        if (cookies) {
          response.headers['set-cookie'] = cookies.map(normalizeLocalCookie);
        }
      });
    }
  };
}

function normalizeLocalCookie(cookie: string) {
  return cookie
    .replace(/;\s*Secure/gi, '')
    .replace(/SameSite=None/gi, 'SameSite=Lax');
}
