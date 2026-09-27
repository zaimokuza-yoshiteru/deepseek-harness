import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export default {
  root: dirname(dirname(fileURLToPath(import.meta.url))),
  test: {
    include: ['tests/boot.spec.ts', 'tests/host.spec.ts', 'tests/package.spec.ts'],
    environment: 'node',
  },
}
