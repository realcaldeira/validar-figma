import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { figmaValidatorPlugin } from './server/plugin.ts';

export default defineConfig({
  plugins: [react(), figmaValidatorPlugin()],
  server: { port: 5199, strictPort: true },
});
