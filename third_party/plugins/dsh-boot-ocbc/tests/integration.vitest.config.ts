import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export default {
  root: dirname(dirname(fileURLToPath(import.meta.url))),
  test: {
    include: ['tests/panel-loader.spec.ts'],
    environment: 'node',
  },
}
