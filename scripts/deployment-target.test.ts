import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { cloudflareReader, deploymentEnvironment, readDeploymentConfig, resolveDeploymentTarget, writeDeploymentTarget } from './deployment-target.mjs'

const accountId = 'a'.repeat(32)
const boundId = '11111111-1111-4111-8111-111111111111'
const wrongId = '22222222-2222-4222-8222-222222222222'
const settings = { bindings: [{ name: 'DB', type: 'd1', id: boundId }] }
const directories: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function config(binding: object = { binding: 'DB' }) {
  const rawConfig = { name: 'omni-mail', account_id: accountId, d1_databases: [binding] }
  return { rawConfig, config: rawConfig, configPath: join(tmpdir(), 'wrangler.jsonc') }
}
const environment = {}

describe('部署数据库目标解析', () => {
  it('两种库名并存时只使用现有 DB ID，完全不按推导库名查询', async () => {
    const get = vi.fn(async () => settings)
    const result = await resolveDeploymentTarget({}, { get, environment, read: async () => config({ binding: 'DB', database_name: 'omni-mail-db' }) })
    expect(result.databaseId).toBe(boundId)
    expect(result.workerName).toBe('omni-mail')
    expect(get).toHaveBeenCalledExactlyOnceWith(`/accounts/${accountId}/workers/scripts/omni-mail/settings`)
  })

  it('构建系统覆盖名称时查实际 Worker，不改用户源配置', async () => {
    const loaded = config()
    const get = vi.fn(async () => settings)
    const target = await resolveDeploymentTarget({}, { get, read: async () => loaded, environment: { WRANGLER_CI_OVERRIDE_NAME: 'omnimail' } })
    expect(get).toHaveBeenCalledWith(`/accounts/${accountId}/workers/scripts/omnimail/settings`)
    expect(target.workerName).toBe('omnimail')
    expect(loaded.rawConfig.name).toBe('omni-mail')
  })

  it('明确配置 ID 与线上绑定冲突时停止，避免静默切库', async () => {
    await expect(resolveDeploymentTarget({}, { environment, get: async () => settings,
      read: async () => config({ binding: 'DB', database_id: wrongId }),
    })).rejects.toThrow('database_id 与线上 DB 绑定不一致')
  })

  it.each([{}, { bindings: [] }, { bindings: [{ name: 'DB', type: 'kv_namespace', id: boundId }] }, { bindings: [{ name: 'DB', type: 'd1', id: 'invalid' }] }])(
    '已有 Worker 绑定无效不能当成首次部署：%j', async (remote) => {
      await expect(resolveDeploymentTarget({}, { environment, read: async () => config(), get: async () => remote })).rejects.toThrow()
    },
  )

  it('Worker 确认不存在且未指定数据库，才返回首次创建状态', async () => {
    expect(await resolveDeploymentTarget({}, { environment, read: async () => config(), get: async () => null }))
      .toMatchObject({ workerExists: false, databaseId: undefined })
  })

  it('首次创建使用固定名称 omni-mail-db，已有同名库时不能自动复用', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'omnimail-new-db-test-')); directories.push(directory)
    const loaded = config()
    loaded.configPath = join(directory, 'wrangler.jsonc')
    const get = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ uuid: wrongId })
    await expect(resolveDeploymentTarget({}, { environment, read: async () => loaded, get })).rejects.toThrow('已存在 omni-mail-db')
    const target = await resolveDeploymentTarget({}, { environment, read: async () => loaded, get: async () => null })
    const file = writeDeploymentTarget(target)
    try {
      expect(JSON.parse(readFileSync(file.path, 'utf8')).d1_databases).toEqual([{ binding: 'DB', database_name: 'omni-mail-db' }])
    } finally { file.dispose() }
  })

  it('首次部署显式指定已有数据库时先验证 ID', async () => {
    const get = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ uuid: boundId })
    const target = await resolveDeploymentTarget({}, { environment, read: async () => config({ binding: 'DB', database_name: 'existing-db' }), get })
    expect(get).toHaveBeenLastCalledWith(`/accounts/${accountId}/d1/database/existing-db`)
    expect(target.databaseId).toBe(boundId)
  })

  it('多账户不会猜测默认目标', async () => {
    const loaded = config(); delete loaded.config.account_id
    await expect(resolveDeploymentTarget({}, { environment, read: async () => loaded, get: async () => [{ id: accountId }, { id: 'b'.repeat(32) }] }))
      .rejects.toThrow('无法唯一确定')
  })

  it('临时配置与源文件同目录，保留环境、相对资源路径及其他绑定', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'omnimail-target-test-')); directories.push(directory)
    const path = join(directory, 'wrangler.jsonc')
    const original = '{"name":"omni-mail","main":"src/index.ts","compatibility_date":"2026-07-27","d1_databases":[{"binding":"DB"}],"assets":{"directory":"dist"},"env":{"staging":{"d1_databases":[{"binding":"DB","database_name":"wrong-name","migrations_dir":"migrations"}],"vars":{"PUBLIC_FLAG":"on"}}}}'
    writeFileSync(path, original)
    const target = await resolveDeploymentTarget({ config: path, env: 'staging' }, {
      environment: { CLOUDFLARE_ACCOUNT_ID: accountId }, get: async () => settings,
    })
    expect(target.workerName).toBe('omni-mail-staging')
    const file = writeDeploymentTarget(target)
    try {
      expect(dirname(file.path)).toBe(directory)
      const effective = await readDeploymentConfig({ config: file.path, env: 'staging' })
      expect(effective.config.name).toBe('omni-mail-staging')
      expect(effective.config.main).toBe(join(directory, 'src/index.ts'))
      expect(effective.config.d1_databases).toEqual([{ binding: 'DB', database_id: boundId, migrations_dir: 'migrations' }])
      expect(effective.config.vars).toEqual({ PUBLIC_FLAG: 'on' })
      expect(readFileSync(path, 'utf8')).toBe(original)
    } finally { file.dispose() }
    expect(existsSync(file.path)).toBe(false)
  })

  it('环境文件后者优先、进程环境优先，拒绝不明确的目标插值', () => {
    const directory = mkdtempSync(join(tmpdir(), 'omnimail-env-test-')); directories.push(directory)
    const one = join(directory, 'one.env'), two = join(directory, 'two.env')
    writeFileSync(one, 'WRANGLER_CI_OVERRIDE_NAME=one\n')
    writeFileSync(two, 'WRANGLER_CI_OVERRIDE_NAME=two\n')
    const values = { 'env-file': [one, two] }
    expect(deploymentEnvironment(values, {}).WRANGLER_CI_OVERRIDE_NAME).toBe('two')
    expect(deploymentEnvironment(values, { WRANGLER_CI_OVERRIDE_NAME: 'three' }).WRANGLER_CI_OVERRIDE_NAME).toBe('three')
    expect(() => deploymentEnvironment(values, { WRANGLER_CI_OVERRIDE_NAME: '${WORKER}' })).toThrow('插值')
  })
})

describe('Cloudflare 只读目标查询', () => {
  const run = vi.fn(async () => JSON.stringify({ type: 'oauth', token: 'test-token-do-not-log' }))
  const retry = (operation: () => Promise<unknown>) => operation()
  it.each([401, 403, 404, 500])('HTTP %i 不能冒充首次部署', async (status) => {
    const get = await cloudflareReader({ profile: 'test' }, { run, retry,
      fetcher: async () => Response.json({ success: false, errors: [{ code: 10000, message: 'test-secret-must-not-appear' }] }, { status }),
    })
    await expect(get('/accounts/test/workers/scripts/test/settings')).rejects.toThrow(`HTTP ${status}`)
    await expect(get('/accounts/test/workers/scripts/test/settings')).rejects.not.toThrow('test-secret-must-not-appear')
    expect(run).toHaveBeenCalledWith(['auth', 'token', '--json', '--profile', 'test'], { capture: true, sensitive: true })
  })
  it('仅明确 10007 Worker 不存在返回首次创建信号', async () => {
    const get = await cloudflareReader({}, { run, retry,
      fetcher: async () => Response.json({ success: false, errors: [{ code: 10007 }] }, { status: 404 }),
    })
    await expect(get('/accounts/test/workers/scripts/test/settings')).resolves.toBeNull()
  })
  it('只接受数据库详情的明确 7404 未找到，普通 404 仍报错', async () => {
    const get = await cloudflareReader({}, { run, retry,
      fetcher: async () => Response.json({ success: false, errors: [{ code: 7404 }] }, { status: 404 }),
    })
    await expect(get(`/accounts/${accountId}/d1/database/omni-mail-db`)).resolves.toBeNull()
    await expect(get(`/accounts/${accountId}/workers/scripts/omni-mail/settings`)).rejects.toThrow('HTTP 404')
  })
})
