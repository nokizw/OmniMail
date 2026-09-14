import { expect, type Page, type Route, test } from '@playwright/test'
import { user } from './omnimail-fixtures'

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function setup(page: Page, role = 'super_admin', ready = false) {
  const state = { ready, migrated: 0, posts: 0, reads: 0, delay: 0, fail: false }
  const status = () => ({
    globalKeyConfigured: state.ready, globalKeyReady: state.ready,
    keyId: state.ready ? '0123456789abcdef0123456789abcdef' : null,
    total: 20, migrated: state.migrated, pending: 20 - state.migrated,
    providers: [{ provider: 'Gmail', total: 20, migrated: state.migrated, pending: 20 - state.migrated, legacyKeyReady: true }],
  })
  await page.addInitScript(() => {
    localStorage.setItem('omnimail.deployment-guide.v1', 'seen')
    localStorage.setItem('omnimail-locale', 'zh-CN')
  })
  await page.route('**://*/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/config') return json(route, {
      appName: 'OmniMail', setupComplete: true, replyEnabled: false,
      registrationEnabled: false, registrationAvailable: false, mailRefreshInterval: 30,
      remoteImagesEnabled: false, superAdminEmail: user.email,
    })
    if (path === '/api/session') return json(route, { user: { ...user, role } })
    if (path === '/api/mailboxes') return json(route, { mailboxes: [{ address: 'inbox@example.com', domain: 'example.com', isActive: true, isDefault: true }] })
    if (path === '/api/domains') return json(route, { domains: [] })
    if (path === '/api/drafts') return json(route, { drafts: [], limit: 5 })
    if (path === '/api/messages') return json(route, {
      unchanged: false, version: 1, messages: [], counts: { unread: 0, starred: 0, sent: 0, trash: 0 },
      page: { hasMore: false, nextCursor: null, limit: 30 },
    })
    if (path === '/api/admin/mail-credentials/migration') {
      if (route.request().method() === 'GET') { state.reads++; return json(route, status()) }
      state.posts++
      expect(route.request().postDataJSON()).toMatchObject({ confirm: true, keyId: '0123456789abcdef0123456789abcdef' })
      if (state.delay) await new Promise((resolve) => setTimeout(resolve, state.delay))
      if (!state.fail) state.migrated = Math.min(20, state.migrated + 10)
      return json(route, {
        cursor: state.migrated < 20 && !state.fail ? { field: 3, afterId: 'batch-1' } : null,
        scanned: 10, migrated: state.fail ? 0 : 10, failed: state.fail ? 10 : 0, conflicts: 0, status: status(),
      })
    }
    return json(route, {}, 404)
  })
  return state
}

async function enterMigration(page: Page) {
  const introduction = page.getByRole('dialog', { name: '建议切换到全局密钥' })
  await expect(introduction).toBeVisible()
  await expect(introduction.getByRole('progressbar')).toHaveCount(0)
  await introduction.getByRole('button', { name: '开始设置', exact: true }).click()
  return page.getByRole('dialog', { name: '统一邮箱加密密钥' })
}

test('主管理员首页引导配置后主动迁移，完成前不会自动写入', async ({ page }) => {
  const state = await setup(page)
  await page.goto('/')
  const dialog = await enterMigration(page)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '开始 / 继续迁移' })).toBeDisabled()
  await expect(dialog.getByText('MAIL_CREDENTIALS_KEY', { exact: true })).toBeVisible()
  expect(state.posts).toBe(0)
  state.ready = true
  await dialog.getByRole('button', { name: '重新检查配置' }).click()
  await expect(dialog.getByText('全局密钥已就绪')).toBeVisible()
  expect(state.posts).toBe(0)
  await dialog.getByRole('button', { name: '开始 / 继续迁移' }).click()
  await expect(dialog.getByText('迁移完成', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('progressbar')).toHaveAttribute('value', '20')
  expect(state.posts).toBe(2)
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: '设置与迁移' })).toHaveCount(0)
})

test('关闭页面停止后续批次，重新打开恢复真实进度', async ({ page }) => {
  const state = await setup(page, 'super_admin', true)
  state.delay = 800
  await page.goto('/')
  const dialog = await enterMigration(page)
  await dialog.getByRole('button', { name: '开始 / 继续迁移' }).click()
  await expect.poll(() => state.posts).toBe(1)
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect.poll(() => state.migrated).toBe(10)
  await page.getByRole('button', { name: '设置与迁移' }).click()
  await expect(dialog.getByRole('progressbar')).toHaveAttribute('value', '10')
  expect(state.posts).toBe(1)
  await dialog.getByRole('button', { name: '开始 / 继续迁移' }).click()
  await expect(dialog.getByText('迁移完成', { exact: true })).toBeVisible()
})

test('窄屏显示失败与重试，键盘可关闭，不误报完成', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' })
  const state = await setup(page, 'super_admin', true)
  state.fail = true
  await page.goto('/')
  const dialog = await enterMigration(page)
  await dialog.getByRole('button', { name: '开始 / 继续迁移' }).click()
  await expect(dialog.getByRole('alert')).toContainText('仍有凭据未迁移')
  await expect(dialog.getByText('迁移完成', { exact: true })).toHaveCount(0)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/mail-credentials-mobile.png', fullPage: true })
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  state.fail = false
  await page.getByRole('button', { name: '设置与迁移' }).click()
  await dialog.getByRole('button', { name: '开始 / 继续迁移' }).click()
  await expect(dialog.getByText('迁移完成', { exact: true })).toBeVisible()
})

test('暂停后刷新页面仍可继续，不自动发起迁移', async ({ page }) => {
  const state = await setup(page, 'super_admin', true)
  state.delay = 800
  await page.goto('/')
  const dialog = await enterMigration(page)
  await dialog.getByRole('button', { name: '开始 / 继续迁移' }).click()
  await expect.poll(() => state.posts).toBe(1)
  await dialog.getByRole('button', { name: '暂停迁移' }).click()
  await expect(dialog.getByText('已暂停。当前批次已结束，可随时继续。')).toBeVisible()
  expect(state.migrated).toBe(10)
  expect(state.posts).toBe(1)
  await page.reload()
  await expect(dialog.getByRole('progressbar')).toHaveAttribute('value', '10')
  expect(state.posts).toBe(1)
  await dialog.getByRole('button', { name: '开始 / 继续迁移' }).click()
  await expect(dialog.getByText('迁移完成', { exact: true })).toBeVisible()
})

for (const role of ['user', 'admin']) {
  test(`${role} 不显示或请求主管理员密钥迁移状态`, async ({ page }) => {
    const state = await setup(page, role)
    await page.goto('/')
    await expect(page.locator('.reader-pane')).toBeVisible()
    expect(state.reads).toBe(0)
    await expect(page.getByRole('dialog', { name: '统一邮箱加密密钥' })).toHaveCount(0)
  })
}

test('升级说明可稍后处理，并在窄屏下从入口继续设置', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const state = await setup(page)
  await page.goto('/')
  const introduction = page.getByRole('dialog', { name: '建议切换到全局密钥' })
  await expect(introduction).toBeVisible()
  await expect(introduction.getByText('只需维护一份密钥', { exact: true })).toBeVisible()
  await expect(introduction.getByText('MAIL_CREDENTIALS_KEY', { exact: true })).toHaveCount(0)
  expect(await introduction.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/mail-key-introduction-mobile.png', fullPage: true })
  await introduction.getByRole('button', { name: '稍后处理' }).click()
  await expect(introduction).not.toBeVisible()
  expect(state.posts).toBe(0)
  await page.getByRole('button', { name: '设置与迁移' }).click()
  const migration = await enterMigration(page)
  await expect(migration.getByText('MAIL_CREDENTIALS_KEY', { exact: true })).toBeVisible()
  expect(state.posts).toBe(0)
})
