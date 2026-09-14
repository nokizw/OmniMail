import { expect, test } from '@playwright/test'

test('启动时明确展示数据库日额度不足，并阻止立即重试反复请求', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('omnimail-locale', 'zh-CN'))
  let requests = 0
  await page.route('**://*/api/**', async (route) => {
    requests++
    await route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Retry-After': '60' }, body: JSON.stringify({
      code: 'd1_daily_limit', retryAfterSeconds: 60, resetAt: Date.now() + 3600000,
      error: 'D1 每日读写额度已用完，请等待额度恢复或由管理员升级套餐。',
    }) })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '暂时无法连接邮箱' })).toBeVisible()
  await expect(page.getByText(/数据库今日读写额度已用完/)).toBeVisible()
  const before = requests
  await page.getByRole('button', { name: '重新连接' }).click()
  await expect(page.getByText(/数据库今日读写额度已用完/)).toBeVisible()
  expect(requests).toBe(before)
})
