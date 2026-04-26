import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const chunkGroups: Record<string, string[]> = {
  react: ['react', 'react-dom', 'react-router-dom'],
  charts: ['recharts'],
  pdf: ['react-pdf', 'pdfjs-dist', 'mammoth'],
  ui: ['@radix-ui/react-dialog', '@radix-ui/react-label', '@radix-ui/react-select', '@radix-ui/react-slot', 'lucide-react'],
  http: ['axios', 'zustand'],
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/preview': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/files': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          for (const [chunkName, packages] of Object.entries(chunkGroups)) {
            if (packages.some((pkg) => id.includes(`/node_modules/${pkg}/`) || id.includes(`\\node_modules\\${pkg}\\`))) {
              return chunkName;
            }
          }
          return undefined;
        },
      },
      onwarn(warning, warn) {
        if (warning.code === 'EVAL' && warning.id?.includes('pdfjs-dist/build/pdf.js')) return;
        warn(warning);
      },
    },
  },
})
