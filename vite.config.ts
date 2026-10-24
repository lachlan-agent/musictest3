import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths: the built app works from any mount point — a
  // subdirectory, a LAN box, GitHub Pages — without rebuilding.
  base: './',
  server: { port: 5180, open: false },
  build: {
    target: 'es2020',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Vendor libraries change rarely; splitting them keeps app-code updates
        // from invalidating the big cached chunks.
        manualChunks: {
          vexflow: ['vexflow'],
          codemirror: [
            'codemirror',
            '@codemirror/view',
            '@codemirror/state',
            '@codemirror/language',
            '@codemirror/lint',
            '@codemirror/commands',
            '@replit/codemirror-vim',
          ],
        },
      },
    },
  },
});
