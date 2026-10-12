import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/moabom/',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
