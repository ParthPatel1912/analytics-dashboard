import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
const path = 'packages/sdk-js/dist/browser/index.global.js';
const bytes = gzipSync(readFileSync(path)).length;
console.log(`Browser SDK IIFE: ${bytes} bytes gzip (${(bytes / 1024).toFixed(2)} KiB). Target: < 5 KiB.`);
if (bytes >= 5120) process.exitCode = 1;
