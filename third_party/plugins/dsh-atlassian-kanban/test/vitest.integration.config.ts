import { defineConfig } from 'vitest/config'
import { remoteTransform } from './remote-transform.ts'

export default defineConfig({
  plugins: [remoteTransform()],
  test: {
    include: ['test/integration/**/*.test.ts'],
    maxWorkers: 2,
  },
})
