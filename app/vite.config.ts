import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [
    react(),
    ...(process.env.NODE_ENV === 'development' ? [inspectAttr()] : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // The Pera/Algorand and charting stacks are large and rarely change.
    // Splitting them keeps the app chunk cacheable and under the size warning.
    rollupOptions: {
      output: {
        manualChunks: {
          algorand: ['@perawallet/connect', 'algosdk'],
          charts: ['recharts'],
          animation: ['gsap', '@gsap/react'],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        secure: false,
      },
      // So http://localhost:5173/health mirrors the deployed setup.
      '/health': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
