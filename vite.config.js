import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  server: {
    proxy: {
      // In local dev, forward /api/* to the Express backend on port 4000
      // This mirrors the Vercel routing: /api/(.*) → pages/api/$1.js
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false
      }
    }
  },
  plugins: [
    {
      name: 'copy-static-assets',
      closeBundle() {
        // Helper to recursively copy directories
        function copyFolderRecursiveSync(source, target) {
          if (!fs.existsSync(source)) return;
          if (!fs.existsSync(target)) {
            fs.mkdirSync(target, { recursive: true });
          }

          const files = fs.readdirSync(source);
          files.forEach(file => {
            const curSource = path.join(source, file);
            const curTarget = path.join(target, file);
            if (fs.lstatSync(curSource).isDirectory()) {
              copyFolderRecursiveSync(curSource, curTarget);
            } else {
              fs.copyFileSync(curSource, curTarget);
              console.log(`[CineStream Build] Copied: ${path.relative(__dirname, curSource)} -> ${path.relative(__dirname, curTarget)}`);
            }
          });
        }

        // Copy entire js folder
        copyFolderRecursiveSync(path.resolve(__dirname, 'js'), path.resolve(__dirname, 'dist/js'));

        // Copy entire pages folder (HTML and JS controllers)
        copyFolderRecursiveSync(path.resolve(__dirname, 'pages'), path.resolve(__dirname, 'dist/pages'));

        // Copy public/ folder (APK files, static assets) to dist/ root
        copyFolderRecursiveSync(path.resolve(__dirname, 'public'), path.resolve(__dirname, 'dist'));

        // ── Copy OneSignalSDKWorker.js to dist root (must be served from root scope) ──
        const swSrc = path.resolve(__dirname, 'OneSignalSDKWorker.js');
        const swDst = path.resolve(__dirname, 'dist/OneSignalSDKWorker.js');
        if (fs.existsSync(swSrc)) {
          fs.copyFileSync(swSrc, swDst);
          console.log('[CineStream Build] Copied: OneSignalSDKWorker.js -> dist/OneSignalSDKWorker.js');
        }
      }
    }
  ]
});
