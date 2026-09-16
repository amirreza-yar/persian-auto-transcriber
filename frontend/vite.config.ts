import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import { VitePWA } from "vite-plugin-pwa"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const backendOrigin =
    env.VITE_BACKEND_ORIGIN || "http://192.168.0.150:8000"

  return {
    plugins: [
      react(),
      tailwindcss(),

      VitePWA({
        registerType: "autoUpdate",

        includeAssets: [
          "favicon.svg",
          "apple-touch-icon.svg",
        ],

        manifest: {
          id: "/",

          name: "Persian STT",
          short_name: "Persian STT",
          description: "Local Persian audio transcription and cleanup",

          lang: "en",
          dir: "ltr",

          theme_color: "#e77538",
          background_color: "#181719",

          display: "standalone",
          start_url: "/",
          scope: "/",

          icons: [
            {
              src: "/pwa-192x192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/pwa-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/pwa-maskable-192x192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "maskable",
            },
            {
              src: "/pwa-maskable-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],

          screenshots: [
            {
              src: "/screenshots/home-mobile.png",
              sizes: "1080x2400",
              type: "image/png",
              form_factor: "narrow",
              label: "Persian STT home screen",
            },
            {
              src: "/screenshots/home-desktop.png",
              sizes: "1440x900",
              type: "image/png",
              form_factor: "wide",
              label: "Persian STT desktop interface",
            },
          ],
        },

        workbox: {
          cleanupOutdatedCaches: true,

          clientsClaim: true,
          skipWaiting: true,

          navigateFallback: "/index.html",

          navigateFallbackDenylist: [
            /^\/api\//,
          ],

          globPatterns: [
            "**/*.{js,css,html,ico,png,svg,woff,woff2}",
          ],
        },

        devOptions: {
          enabled: false,
        },
      }),
    ],

    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },

    server: {
      host: true,

      proxy: {
        "/api": {
          target: backendOrigin,
          changeOrigin: true,
        },
      },
    },
  }
})