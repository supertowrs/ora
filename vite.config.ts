import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (command === 'build' && !(process.env.VITE_CONVEX_URL || env.VITE_CONVEX_URL)) {
    throw new Error('Falta VITE_CONVEX_URL en este entorno. No se publicará una web sin backend.');
  }
  return {
    plugins: [react()],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    build: { target: 'es2022' },
  };
});
