import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.ts',
  use: {
    baseURL:'http://localhost:4173',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
  },
  webServer: {
    command: 'npm run dev -- --port 4173 --strictPort',
    url:'http://localhost:4173',
    env: {VITE_SUPABASE_URL:'https://lifegreat-test.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY:'test-publishable-key'},
    reuseExistingServer:false,
  },
})
