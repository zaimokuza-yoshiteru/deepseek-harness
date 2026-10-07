import { describe, expect, it } from 'vitest'
import { AtlassianHttp } from '../../src/host/http.ts'

describe('AtlassianHttp.request', () => {
  it('does not leave a deadline behind when ClientRequest creation throws synchronously', async () => {
    const client = new AtlassianHttp()
    await expect(client.request('http://127.0.0.1:1', 'bad\r\nheader: value', 'GET', '/', { timeoutMs: 10 }))
      .rejects.toMatchObject({ code: 'ERR_INVALID_CHAR' })

    // The old deadline fired after the rejected Promise and threw a TDZ
    // ReferenceError from its callback. Keep the test worker alive beyond it.
    await new Promise(resolve => setTimeout(resolve, 30))
  })
})
