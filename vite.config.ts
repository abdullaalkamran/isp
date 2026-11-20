import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: {
    rolldownOptions: {
      output: {
        // Vendor libraries in their own long-cacheable chunks so app code changes do not invalidate them
        codeSplitting: {
          groups: [
            { name: 'vendor-charts', test: /node_modules[\\/](recharts|d3-|victory-vendor|decimal\.js-light|recharts-scale)/, priority: 30 },
            { name: 'vendor-supabase', test: /node_modules[\\/]@supabase/, priority: 25 },
            { name: 'vendor-i18n', test: /node_modules[\\/](i18next|react-i18next)/, priority: 20 },
            { name: 'vendor-forms', test: /node_modules[\\/](react-hook-form|@hookform|zod)/, priority: 20 },
            { name: 'vendor-radix', test: /node_modules[\\/]@radix-ui/, priority: 20 },
            { name: 'vendor-query', test: /node_modules[\\/]@tanstack/, priority: 20 },
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/, priority: 15 },
          ],
        },
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
