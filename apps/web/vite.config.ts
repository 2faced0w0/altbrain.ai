import { defineConfig, loadEnv } from 'vite';
export default defineConfig(({mode})=>({ server: { proxy: { '/api': loadEnv(mode,'.','WORKTRACKER_').WORKTRACKER_API || 'http://127.0.0.1:8000' } }, preview: { host: '127.0.0.1', port: 5173 } }));
