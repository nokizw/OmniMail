import { getLocale, t } from '../i18n'

export interface ServiceBackoff { until: number; resetAt: number }
let current: ServiceBackoff | undefined

export function serviceBackoff(now = Date.now()): ServiceBackoff | undefined {
  if (current && current.until <= now) current = undefined
  return current
}

export function recordServiceBackoff(data: unknown, now = Date.now()): ServiceBackoff | undefined {
  if (!data || typeof data !== 'object') return undefined
  const value = data as Record<string, unknown>
  if (value.code !== 'd1_daily_limit') return undefined
  const seconds = typeof value.retryAfterSeconds === 'number' && Number.isFinite(value.retryAfterSeconds)
    ? Math.min(300, Math.max(1, Math.ceil(value.retryAfterSeconds))) : 30
  const resetAt = typeof value.resetAt === 'number' && Number.isFinite(value.resetAt)
    && value.resetAt > now && value.resetAt <= now + 2 * 86_400_000
    ? value.resetAt : Math.floor(now / 86_400_000) * 86_400_000 + 86_400_000
  current = { until: now + seconds * 1000, resetAt }
  return current
}

export function serviceBackoffMessage(backoff: ServiceBackoff): string {
  return t('数据库今日读写额度已用完。预计 {time} 恢复；自动请求已退避，请稍后重试或联系管理员。', {
    time: new Date(backoff.resetAt).toLocaleString(getLocale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
  })
}
