import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordServiceBackoff, serviceBackoff, serviceBackoffMessage } from './service-backoff'

afterEach(() => { serviceBackoff(Number.MAX_SAFE_INTEGER); vi.useRealTimers() })

describe('数据库额度提示与退避', () => {
  it('只识别明确错误码，限制重试时间并在到期后允许请求', () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-13T07:00:00Z')
    expect(recordServiceBackoff({ error: 'normal failure' })).toBeUndefined()
    const state = recordServiceBackoff({ code: 'd1_daily_limit', retryAfterSeconds: 999999, resetAt: -1 })!
    expect(state.until).toBe(Date.now() + 300_000)
    expect(state.resetAt).toBe(Date.parse('2026-09-14T00:00:00Z'))
    expect(serviceBackoffMessage(state)).toContain('额度')
    vi.advanceTimersByTime(300_000)
    expect(serviceBackoff()).toBeUndefined()
  })
})
