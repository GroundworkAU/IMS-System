import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Surface which commit is deployed, so it is always clear whether the browser
// is running the latest build. Vercel provides the commit sha at build time.
const commit = (process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7)

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD__: JSON.stringify(commit),
  },
})
