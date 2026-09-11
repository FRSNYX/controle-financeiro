import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),

    VitePWA({
      // Atualiza sozinho: não é preciso reinstalar o app quando publicamos
      // uma correção.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icones/apple-touch-icon.png'],

      manifest: {
        name: 'Controle Financeiro',
        short_name: 'Finanças',
        description:
          'Receitas, despesas, cartões, investimentos, metas e patrimônio — tudo em um lugar.',
        lang: 'pt-BR',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f172a',
        theme_color: '#4f46e5',
        categories: ['finance', 'productivity'],
        icons: [
          { src: '/icones/icone-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icones/icone-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icones/icone-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icones/icone-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Atalhos ao segurar o ícone na tela inicial.
        shortcuts: [
          { name: 'Nova despesa', url: '/despesas' },
          { name: 'Nova receita', url: '/receitas' },
          { name: 'Minha vida financeira', url: '/vida-financeira' },
        ],
      },

      workbox: {
        // Guarda a interface para o app abrir instantâneo, inclusive sem rede.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,

        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],

        // As respostas da API NÃO são guardadas, de propósito.
        // Num sistema financeiro, mostrar um saldo velho sem avisar é pior que
        // mostrar "não foi possível carregar": a pessoa decidiria com número
        // errado achando que está atualizado.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
        ],

        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },

      devOptions: { enabled: false },
    }),
  ],

  server: {
    port: 5173,
    // O frontend chama /api/... e o Vite encaminha para o backend em dev.
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Recharts é pesado e só aparece em telas com gráfico: separá-lo deixa
        // o login e o primeiro carregamento bem mais leves.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
});
