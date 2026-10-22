import { build } from 'vite';
await build({ configFile:false, build:{ ssr:'server/main.ts', target:'node22', outDir:'dist-server',
  rollupOptions:{output:{entryFileNames:'server.mjs'}} } });
