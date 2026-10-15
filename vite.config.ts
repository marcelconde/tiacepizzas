import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Identifica cada publicação. O aplicativo do motoboy compara com /versao.json para recarregar quando muda.
const versao = process.env.GITHUB_SHA?.slice(0, 12) || new Date().toISOString()

export default defineConfig({
  define: { __VERSAO__: JSON.stringify(versao) },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'versao',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'versao.json', source: JSON.stringify({ versao }) })
      },
    },
  ],
  build: { chunkSizeWarningLimit: 900 },
})
