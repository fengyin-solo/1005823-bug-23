import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 纯前端项目，无单测框架：用 esbuild 处理 TS 与 @/ 别名后交给 node --test。
// 运行方式（仓库根 frontend/ 下）：
//   node --experimental-strip-types --experimental-vm-modules  # Node>=22.6 可直接 node --test 本文件
// Node 20 可先经 esbuild 转译：见同目录 run-tests.mjs。

// 用 esbuild 把 @/ 别名与 TS 编译成可在 node 里直接 import 的 ESM 包。
const bundleDir = mkdtempSync(join(tmpdir(), 'floodwarn-test-'))
const bundleFile = join(bundleDir, 'bundle.mjs')

const STORAGE: Record<string, string> = {}
class FakeLocalStorage {
  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(STORAGE, key) ? STORAGE[key] : null
  }
  setItem(key: string, value: string): void {
    STORAGE[key] = String(value)
  }
  removeItem(key: string): void {
    delete STORAGE[key]
  }
  clear(): void {
    for (const key of Object.keys(STORAGE)) delete STORAGE[key]
  }
}
;(globalThis as { window?: unknown }).window = { localStorage: new FakeLocalStorage() }

await build({
  entryPoints: ['src/data/floodwarn.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundleFile,
  alias: { '@': join(process.cwd(), 'src') },
  logLevel: 'silent',
})

const mod = await import(pathToFileURL(bundleFile).href)
const {
  __resetStoreCache,
  createDraft,
  updateDraft,
  submitDraft,
  publishWarning,
  liftWarning,
  listWarnings,
  getWarning,
  listTodos,
  supplementBasis,
  FloodWarnError,
  WarningNotFoundError,
} = mod

function draft(over: Record<string, unknown> = {}) {
  return {
    预警编号: 'YJ-TEST-1',
    预警级别: '黄色',
    影响区域: ['城西片'],
    预警依据: '',
    拟稿人: '张三',
    计划开始: '2026-10-10 08:00',
    计划结束: '2026-10-11 08:00',
    ...over,
  }
}

beforeEach(() => {
  STORAGE['drainage-pump:entries'] = JSON.stringify({ floodwarn: [] })
  __resetStoreCache()
})

test('完整流转：拟稿→提交→发布（锁定快照）→解除后快照仍可查且不随后续改动', () => {
  const created = createDraft(draft({ 预警依据: '气象台黄色预警' }))
  assert.equal(created.status, '待拟稿')
  const submitted = submitDraft(created.id)
  assert.equal(submitted.status, '待发布')
  const published = publishWarning(submitted.id)
  assert.equal(published.status, '已发布')
  const firstPublishTime = published.publishedAt
  assert.ok(published.snapshot, '发布时必须生成快照')
  assert.deepEqual(published.snapshot['影响区域'], ['城西片'])
  assert.equal(published.snapshot['预警级别'], '黄色')

  // 解除
  const lifted = liftWarning(published.id, '雨带移出，退水正常，无伤亡')
  assert.equal(lifted.status, '已解除')
  assert.ok(lifted.liftedAt)

  // 解除后再查：列表、详情拿到的都是发布时那份快照
  const inList = listWarnings().find((r: { id: number }) => r.id === published.id)
  const detail = getWarning(published.id)
  for (const record of [inList, detail]) {
    assert.equal(record.status, '已解除')
    assert.deepEqual(record.areaList, ['城西片'])
    assert.equal(record.level, '黄色')
    assert.equal(record.publishedAt, firstPublishTime)
    assert.ok(record.snapshot, '解除后发布快照仍在')
  }
})

test('预警依据没填不许发布：退回并指出缺「预警依据」这一格', () => {
  const created = createDraft(draft({ 预警依据: '   ' }))
  submitDraft(created.id)
  assert.throws(
    () => publishWarning(created.id),
    (error: unknown) => {
      assert.ok(error instanceof FloodWarnError)
      assert.match(error.message, /发布被退回/)
      assert.match(error.fields['预警依据'], /预警依据为空/)
      return true
    },
  )
  // 补齐后在待拟稿阶段更新依据，再提交、发布即可成功（见下一条用例）
})

test('待发布状态不能再改拟稿（只能顺着状态走）', () => {
  const created = createDraft(draft({ 预警依据: '依据' }))
  submitDraft(created.id)
  assert.throws(() => updateDraft(created.id, draft({ 预警依据: 'x' })), /不能执行「修改拟稿」/)
})

test('补齐依据的正确路径：待拟稿阶段补依据，提交后可发布', () => {
  const created = createDraft(draft())
  updateDraft(created.id, draft({ 预警依据: '6小时雨量50mm' }))
  submitDraft(created.id)
  const published = publishWarning(created.id)
  assert.equal(published.status, '已发布')
  assert.match(published.snapshot['预警依据'], /6小时雨量/)
})

test('依据为空被发布退回后，可在待发布阶段补依据，状态不变且随后能发布', () => {
  const created = createDraft(draft({ 预警依据: '' }))
  submitDraft(created.id)
  assert.throws(() => publishWarning(created.id), /发布被退回/)
  // 空依据补充同样被退回，并指出缺「预警依据」格
  assert.throws(
    () => supplementBasis(created.id, '  '),
    (error: unknown) => error instanceof FloodWarnError && /预警依据必填/.test(error.fields['预警依据']),
  )
  const supplemented = supplementBasis(created.id, '调度令 2026-031：启动三级响应')
  assert.equal(supplemented.status, '待发布')
  assert.match(supplemented.basis, /调度令/)
  const published = publishWarning(created.id)
  assert.equal(published.status, '已发布')
  assert.match(published.snapshot['预警依据'], /调度令/)
})

test('非待发布状态不能补依据（不允许跨状态操作）', () => {
  const created = createDraft(draft({ 预警依据: '' }))
  assert.throws(() => supplementBasis(created.id, '依据'), /还不能|不能执行/)
})

test('影响区域为空可以登记/提交/发布，详情按空数据展示而非空白', () => {
  const created = createDraft(draft({ 影响区域: [], 预警依据: '全域雨情通报' }))
  submitDraft(created.id)
  const published = publishWarning(created.id)
  assert.deepEqual(published.areaList, [])
  assert.deepEqual(published.snapshot['影响区域'], [])
  const detail = getWarning(created.id)
  assert.deepEqual(detail.areaList, [])
  assert.deepEqual(detail.snapshot['影响区域'], [])
})

test('同一预警编号重复登记只允许一条：第二次被字段级错误退回', () => {
  createDraft(draft())
  assert.throws(
    () => createDraft(draft({ 影响区域: ['老城片'], 计划开始: '2026-11-01 08:00', 计划结束: '2026-11-02 08:00' })),
    (error: unknown) => {
      assert.ok(error instanceof FloodWarnError)
      assert.match(error.fields['预警编号'], /已存在/)
      return true
    },
  )
})

test('同一片区同一时段已有待发布预警：再拟稿提示重复并指出片区与单号', () => {
  const a = createDraft(draft({ 预警编号: 'YJ-A', 影响区域: ['临江片', '临港片'], 预警依据: '依据' }))
  submitDraft(a.id) // A 进入待发布
  assert.throws(
    () => createDraft(draft({ 预警编号: 'YJ-B', 影响区域: ['临江片'], 预警依据: '依据' })),
    (error: unknown) => {
      assert.ok(error instanceof FloodWarnError)
      assert.match(error.fields['影响区域'], /临江片/)
      assert.match(error.fields['影响区域'], /YJ-A/)
      assert.match(error.fields['影响区域'], /待发布/)
      return true
    },
  )
})

test('同一片区但时段不重叠：允许拟稿', () => {
  const a = createDraft(draft({ 预警编号: 'YJ-A', 影响区域: ['临江片'] }))
  submitDraft(a.id)
  const b = createDraft(
    draft({ 预警编号: 'YJ-B', 影响区域: ['临江片'], 计划开始: '2026-12-01 08:00', 计划结束: '2026-12-02 08:00' }),
  )
  assert.equal(b.status, '待拟稿')
})

test('已解除的单子不再挡住同片区新预警', () => {
  const a = createDraft(draft({ 预警编号: 'YJ-A', 影响区域: ['高铁片'], 预警依据: '依据' }))
  submitDraft(a.id)
  publishWarning(a.id)
  liftWarning(a.id, '解除')
  const b = createDraft(draft({ 预警编号: 'YJ-B', 影响区域: ['高铁片'], 预警依据: '新依据' }))
  assert.equal(b.code, 'YJ-B')
})

test('状态机：不允许跳级（待拟稿不能直接发布/解除；已解除不能再解除）', () => {
  const created = createDraft(draft({ 预警依据: '依据' }))
  assert.throws(() => publishWarning(created.id), /还不能「发布预警」/)
  assert.throws(() => liftWarning(created.id, 'x'), /还不能|不能执行/)

  submitDraft(created.id)
  publishWarning(created.id)
  liftWarning(created.id, '办结')
  assert.throws(() => liftWarning(created.id, '再来一次'), /不能执行「解除预警」/)
  assert.throws(() => submitDraft(created.id), /不能执行/)
})

test('解除结论为空不许解除', () => {
  const created = createDraft(draft({ 预警依据: '依据' }))
  submitDraft(created.id)
  publishWarning(created.id)
  assert.throws(
    () => liftWarning(created.id, '   '),
    (error: unknown) => {
      assert.ok(error instanceof FloodWarnError)
      assert.match(error.fields['解除结论'], /必填/)
      return true
    },
  )
})

test('待办清单：按节点/级别/时间排序，解除后该条消失并重排', () => {
  // 先建几条互不撞期、不同片区的单子（同为待拟稿时按级别权重排序）
  const red = createDraft(draft({ 预警编号: 'YJ-RED', 预警级别: '红色', 影响区域: ['湿地片'], 预警依据: 'r', 计划开始: '2026-10-10 09:00' }))
  const yellow = createDraft(draft({ 预警编号: 'YJ-YEL', 预警级别: '黄色', 影响区域: ['南站片'], 预警依据: 'y', 计划开始: '2026-10-10 07:00' }))
  const blue = createDraft(draft({ 预警编号: 'YJ-BLU', 预警级别: '蓝色', 影响区域: ['高新片'], 预警依据: 'b', 计划开始: '2026-10-10 06:00' }))
  void red; void yellow; void blue

  // 待拟稿组内：红 > 黄 > 蓝（同级才比计划开始时间）
  let todos = listTodos()
  assert.deepEqual(todos.map((t: { code: string }) => t.code), ['YJ-RED', 'YJ-YEL', 'YJ-BLU'])

  // 把 BLU 推到待发布：待发布动作排在待拟稿之前
  submitDraft(blue.id)
  todos = listTodos()
  assert.deepEqual(todos.map((t: { code: string }) => t.code), ['YJ-BLU', 'YJ-RED', 'YJ-YEL'])
  assert.equal(todos[0].todoKind, 'publish')

  // 待发布组里即便级别低也排在待拟稿红色前面
  publishWarning(blue.id)
  todos = listTodos()
  assert.equal(todos[0].code, 'YJ-BLU')
  assert.equal(todos[0].todoKind, 'lift')

  // 解除 BLU：待办里消失，剩余两条回到拟稿组按级别排序
  liftWarning(blue.id, '雨停')
  todos = listTodos()
  assert.deepEqual(todos.map((t: { code: string }) => t.code), ['YJ-RED', 'YJ-YEL'])
  assert.ok(!listTodos().some((t: { id: number }) => t.id === blue.id))
})

test('同节点同级别的待办按计划开始时间升序排序', () => {
  createDraft(draft({ 预警编号: 'YJ-1', 预警级别: '黄色', 影响区域: ['高新片'], 计划开始: '2026-10-10 09:00' }))
  createDraft(draft({ 预警编号: 'YJ-2', 预警级别: '黄色', 影响区域: ['湿地片'], 计划开始: '2026-10-10 06:00' }))
  const codes = listTodos().map((t: { code: string }) => t.code)
  assert.deepEqual(codes, ['YJ-2', 'YJ-1'])
})

test('同节点同级别的待办按级别权重（红>橙>黄>蓝）排序', () => {
  createDraft(draft({ 预警编号: 'YJ-1', 预警级别: '蓝色', 影响区域: ['高新片'], 计划开始: '2026-10-10 06:00' }))
  createDraft(draft({ 预警编号: 'YJ-2', 预警级别: '红色', 影响区域: ['湿地片'], 计划开始: '2026-10-10 09:00' }))
  const codes = listTodos().map((t: { code: string }) => t.code)
  assert.deepEqual(codes, ['YJ-2', 'YJ-1'])
})

test('查不到的单子抛 NOT FOUND，与读取失败区分', () => {
  assert.throws(
    () => getWarning(999),
    (error: unknown) => error instanceof WarningNotFoundError && error.code === 'WARNING_NOT_FOUND',
  )
})

test('快照损坏时给出失败错误而不是假装空白', () => {
  const broken = {
    id: 1,
    status: '已解除',
    pending: false,
    abnormal: false,
    预警编号: 'YJ-X',
    预警级别: '橙色',
    影响区域: JSON.stringify(['城西片']),
    预警依据: 'x',
    拟稿人: '张三',
    计划开始: '2026-10-10 08:00',
    计划结束: '2026-10-11 08:00',
    发布时间: '2026-10-10 07:30',
    解除时间: '2026-10-11 09:00',
    解除结论: 'ok',
    预警状态: '已解除',
    发布快照: '{not-json',
  }
  STORAGE['drainage-pump:entries'] = JSON.stringify({ floodwarn: [broken] })
  __resetStoreCache()
  assert.throws(() => getWarning(1), /发布快照读不出来/)
  assert.throws(() => listWarnings(), /发布快照读不出来/)
})

test('存量旧格式数据（逗号分隔片区、无快照）可正常解析不误伤', () => {
  const legacy = {
    id: 7,
    status: '待拟稿',
    pending: true,
    abnormal: false,
    预警编号: 'FLOO-0007',
    预警级别: '防涝预警发布样例7',
    影响区域: '城西片,老城片、南站片',
    预警依据: '旧数据',
    拟稿人: '旧',
    发布时间: '',
    解除时间: '',
  }
  STORAGE['drainage-pump:entries'] = JSON.stringify({ floodwarn: [legacy] })
  __resetStoreCache()
  const record = getWarning(7)
  assert.deepEqual(record.areaList, ['城西片', '老城片', '南站片'])
  assert.equal(record.snapshot, null)
})

// 防止临时目录残留：最后清理（esbuild 输出文件已在 bundleDir 内）
test('环境自检：存储初始为空时列表返回空数组', () => {
  STORAGE['drainage-pump:entries'] = JSON.stringify({ floodwarn: [] })
  __resetStoreCache()
  assert.deepEqual(listWarnings(), [])
  assert.deepEqual(listTodos(), [])
})

// bundle 目录在进程退出时兜底清理
process.on('exit', () => {
  try {
    rmSync(bundleDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
})
