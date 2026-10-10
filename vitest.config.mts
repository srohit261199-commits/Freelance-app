import { defineConfig } from 'vitest/config';

// Day and month boundaries are local time; pin the tests to the timezone the app is used in.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node', env: { TZ: 'Asia/Kolkata' } } });
