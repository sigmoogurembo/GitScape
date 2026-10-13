import { defineConfig } from 'vite';

export default defineConfig({
  resolve: { dedupe: ['three'] },
  optimizeDeps: { include: ['three', 'three/addons/controls/OrbitControls.js', 'three/addons/utils/BufferGeometryUtils.js'] },
  build: { rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
});
