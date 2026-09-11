import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['core/**/*.ts', 'contracts/**/*.ts', 'scripts/**/*.ts'],
      exclude: ['scripts/roadmap-cli.ts'],
      reporter: ['text', 'lcov'],
      // Thresholds are switched on in P1-T13 once core/ exists (CODING-STANDARDS.md §10.1).
    },
  },
});
