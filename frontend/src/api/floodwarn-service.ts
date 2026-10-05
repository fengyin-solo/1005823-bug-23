import { listRows, nextId, parseAreas, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  FloodwarnSnapshot,
  FloodwarnTodo,
  FloodwarnView,
} from '@/data/types'

// 防涝预警单专属业务：发布快照、逐级状态机、编号/片区去重、待办重排都在这里收口。
const KEY = 'floodwarn'
const STATUS_DRAFT = '待拟稿'
const STATUS_PENDING = '待发布'
const STATUS_PUBLISHED = '已发布'
const STATUS_LIFTED = '已解除'
const STATUS_ORDER = [STATUS_DRAFT, STATUS_PENDING, STATUS_PUBLISHED, STATUS_LIFTED]

const LEVELS = ['一级（红色）', '二级（橙色）', '三级（黄色）', '四级（蓝色）']

export function warningLevels(): string[] {
  return [...LEVELS]
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 把 datetime-local 的「T」与文本时间的空格统一，保证两种写法能直接按字符串先后比较。 */
function normalizeTime(value: string): string {
  return String(value ?? '').trim().replace('T', ' ')
}

export function nowText(): string {
  const date = new Date()
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

function areaText(areas: string[]): string {
  return areas.length ? areas.join('、') : ''
}

/** 列表行转读模型：已发布单一律读发布快照，列表与详情读的是同一份，不会对不上。 */
export function toView(row: EntryRow): FloodwarnView {
  const snapshot = (row.发布快照 as FloodwarnSnapshot | undefined) ?? null
  const liveAreas = parseAreas(row.影响区域)
  const status = String(row.status)
  const frozen = status === STATUS_PUBLISHED || status === STATUS_LIFTED
  return {
    id: Number(row.id),
    预警编号: String(row.预警编号 ?? '').trim(),
    预警级别: frozen && snapshot ? snapshot.预警级别 : String(row.预警级别 ?? '').trim(),
    影响区域: frozen && snapshot ? [...snapshot.影响区域] : liveAreas,
    影响区域文本: frozen && snapshot ? areaText(snapshot.影响区域) : areaText(liveAreas),
    预警依据: frozen && snapshot ? snapshot.预警依据 : String(row.预警依据 ?? '').trim(),
    拟稿人: String(row.拟稿人 ?? '').trim(),
    开始时间: normalizeTime(String(row.开始时间 ?? '')).trim(),
    结束时间: normalizeTime(String(row.结束时间 ?? '')).trim(),
    发布时间: snapshot ? snapshot.发布时间 : '',
    解除时间: snapshot ? snapshot.解除时间 : '',
    status,
    pending: Boolean(row.pending),
    abnormal: Boolean(row.abnormal),
    快照: snapshot,
    行: row,
  }
}

export function listFloodwarn(
  filters: Record<string, string> = {},
): { items: FloodwarnView[]; total: number } {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  const keywordOf = (field: string) =>
    pairs.find(([name]) => name === field)?.[1].trim() ?? ''
  const items = listRows(KEY)
    .map(toView)
    .filter((view) => {
      const code = keywordOf('预警编号')
      if (code && !view.预警编号.includes(code)) {
        return false
      }
      const level = keywordOf('预警级别')
      if (level && !view.预警级别.includes(level)) {
        return false
      }
      const area = keywordOf('影响区域')
      if (area && !view.影响区域.some((item) => item.includes(area)) && !view.影响区域文本.includes(area)) {
        return false
      }
      return true
    })
  return { items, total: items.length }
}

/** 详情读取：找不到返回 null（界面按「没有记录」说明），存储损坏时抛错（界面按失败提示）。 */
export function getFloodwarn(id: number): FloodwarnView | null {
  const row = listRows(KEY).find((item) => Number(item.id) === Number(id))
  return row ? toView(row) : null
}

type DraftInput = {
  预警编号: string
  预警级别: string
  影响区域: string[]
  预警依据: string
  拟稿人: string
  开始时间: string
  结束时间: string
}

function findConflicts(rows: EntryRow[], input: DraftInput, selfId?: number) {
  const wanted = new Set(input.影响区域.map((area) => area.trim()).filter(Boolean))
  const conflicts: { 编号: string; 状态: string; 片区: string[] }[] = []
  if (!wanted.size || !input.开始时间 || !input.结束时间) {
    return conflicts
  }
  const wantedStart = normalizeTime(input.开始时间)
  const wantedEnd = normalizeTime(input.结束时间)
  for (const row of rows) {
    if (selfId !== undefined && Number(row.id) === Number(selfId)) {
      continue
    }
    const status = String(row.status)
    // 只有「挂着」的预警（待发布、已发布）才会和新拟稿撞单；已解除的不再占位。
    if (status !== STATUS_PENDING && status !== STATUS_PUBLISHED) {
      continue
    }
    const start = normalizeTime(String(row.开始时间 ?? ''))
    const end = normalizeTime(String(row.结束时间 ?? ''))
    if (!start || !end || wantedStart >= end || start >= wantedEnd) {
      continue
    }
    const areas = parseAreas(row.影响区域)
    const overlap = areas.filter((area) => wanted.has(area))
    if (overlap.length) {
      conflicts.push({ 编号: String(row.预警编号 ?? ''), 状态: status, 片区: overlap })
    }
  }
  return conflicts
}

function reject(message: string): ActionResult {
  return { ok: false, message }
}

function validateDraft(rows: EntryRow[], input: DraftInput, selfId?: number): ActionResult | null {
  if (!input.预警编号) {
    return reject('拟稿被退回：「预警编号」这一格为空，请填写预警编号后再提交。')
  }
  if (!input.预警级别) {
    return reject('拟稿被退回：「预警级别」这一格为空，请选择预警级别后再提交。')
  }
  if (!input.开始时间 || !input.结束时间) {
    const missing = [!input.开始时间 && '「预警开始时间」', !input.结束时间 && '「预警结束时间」']
      .filter(Boolean)
      .join('、')
    return reject(`拟稿被退回：${missing}为空，请补全预警时段后再提交。`)
  }
  if (normalizeTime(input.开始时间) >= normalizeTime(input.结束时间)) {
    return reject('拟稿被退回：预警时段不正确，开始时间需早于结束时间。')
  }
  // 同一预警编号重复发布只留一条：任何状态下编号都不能重复。
  const duplicated = rows.find(
    (row) => String(row.预警编号 ?? '').trim() === input.预警编号 &&
      (selfId === undefined || Number(row.id) !== Number(selfId)),
  )
  if (duplicated) {
    return reject(
      `预警编号「${input.预警编号}」已有一张预警单（当前状态「${String(duplicated.status)}」），同一预警编号重复发布只保留一条。`,
    )
  }
  const conflicts = findConflicts(rows, input, selfId)
  if (conflicts.length) {
    const first = conflicts[0]
    return reject(
      `片区「${first.片区.join('、')}」在同一时段已有${first.状态}预警单（编号 ${first.编号}），两条预警不能同时挂着，请调整影响片区或预警时段。`,
    )
  }
  return null
}

export function createDraft(input: DraftInput): ActionResult & { id?: number } {
  const rows = listRows(KEY)
  const normalized: DraftInput = {
    ...input,
    预警编号: input.预警编号.trim(),
    预警级别: input.预警级别.trim(),
    预警依据: input.预警依据.trim(),
    拟稿人: input.拟稿人.trim(),
    影响区域: parseAreas(input.影响区域),
  }
  const invalid = validateDraft(rows, normalized)
  if (invalid) {
    return invalid
  }
  const id = nextId(KEY)
  const row: EntryRow = {
    id,
    status: STATUS_DRAFT,
    pending: true,
    abnormal: false,
    预警编号: normalized.预警编号,
    预警级别: normalized.预警级别,
    影响区域: areaText(normalized.影响区域),
    预警依据: normalized.预警依据,
    拟稿人: normalized.拟稿人,
    开始时间: normalizeTime(normalized.开始时间),
    结束时间: normalizeTime(normalized.结束时间),
    发布时间: '',
    解除时间: '',
  }
  saveRows(KEY, [...rows, row])
  return { ok: true, message: `预警单 ${normalized.预警编号} 已拟稿，当前状态「${STATUS_DRAFT}」`, id }
}

/** 发布前的单据仍可改稿；发布之后只读，要改只能看发布时冻结的那份。 */
export function updateDraft(id: number, patch: Partial<DraftInput>): ActionResult {
  const rows = listRows(KEY)
  const index = rows.findIndex((row) => Number(row.id) === Number(id))
  if (index < 0) {
    return reject(`没有找到编号为 ${id} 的预警单`)
  }
  const current = rows[index]
  const status = String(current.status)
  if (status !== STATUS_DRAFT && status !== STATUS_PENDING) {
    return reject(`预警单已${status === STATUS_PUBLISHED ? '发布' : '办结'}，发布快照不能修改`)
  }
  const merged: DraftInput = {
    预警编号: String(current.预警编号 ?? ''),
    预警级别: String(current.预警级别 ?? ''),
    影响区域: parseAreas(current.影响区域),
    预警依据: String(current.预警依据 ?? ''),
    拟稿人: String(current.拟稿人 ?? ''),
    开始时间: String(current.开始时间 ?? ''),
    结束时间: String(current.结束时间 ?? ''),
    ...('影响区域' in patch ? { 影响区域: parseAreas(patch.影响区域 ?? []) } : {}),
    ...Object.fromEntries(
      Object.entries(patch)
        .filter(([key]) => key !== '影响区域')
        .map(([key, value]) => [key, String(value ?? '').trim()]),
    ),
  }
  const invalid = validateDraft(listRows(KEY), merged, id)
  if (invalid) {
    return invalid
  }
  const updated: EntryRow = {
    ...current,
    预警级别: merged.预警级别,
    影响区域: areaText(merged.影响区域),
    预警依据: merged.预警依据,
    拟稿人: merged.拟稿人,
    开始时间: normalizeTime(merged.开始时间),
    结束时间: normalizeTime(merged.结束时间),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(KEY, next)
  return { ok: true, message: `预警单 ${merged.预警编号} 的拟稿内容已更新` }
}

function transitionGuard(status: string, expected: string, action: string, target: string): ActionResult | null {
  if (status === target) {
    return reject(`预警单已经是「${target}」，不用重复操作`)
  }
  if (status !== expected) {
    return reject(
      `预警单当前为「${status}」，不能直接${action}；状态只能按「${STATUS_ORDER.join('→')}」逐级流转，不允许跳级。`,
    )
  }
  return null
}

export function submitDraft(id: number): ActionResult {
  const rows = listRows(KEY)
  const index = rows.findIndex((row) => Number(row.id) === Number(id))
  if (index < 0) {
    return reject(`没有找到编号为 ${id} 的预警单`)
  }
  const status = String(rows[index].status)
  const blocked = transitionGuard(status, STATUS_DRAFT, '提交拟稿', STATUS_PENDING)
  if (blocked) {
    return blocked
  }
  const updated: EntryRow = { ...rows[index], status: STATUS_PENDING, pending: true }
  const next = [...rows]
  next[index] = updated
  saveRows(KEY, next)
  return { ok: true, message: `预警单已提交拟稿，当前状态「${STATUS_PENDING}」` }
}

export function publishWarning(id: number): ActionResult {
  const rows = listRows(KEY)
  const index = rows.findIndex((row) => Number(row.id) === Number(id))
  if (index < 0) {
    return reject(`没有找到编号为 ${id} 的预警单`)
  }
  const current = rows[index]
  const status = String(current.status)
  const blocked = transitionGuard(status, STATUS_PENDING, '发布预警', STATUS_PUBLISHED)
  if (blocked) {
    return blocked
  }
  // 预警依据没填的单子不许发布，退回时说明原因并指出缺哪一格。
  if (!String(current.预警依据 ?? '').trim()) {
    return reject('发布被退回：「预警依据」这一格为空，请补填预警依据后再发布。')
  }
  if (!String(current.预警级别 ?? '').trim()) {
    return reject('发布被退回：「预警级别」这一格为空，请选择预警级别后再发布。')
  }
  // 底子在这一刻冻结：影响区域与预警级别存成同一份快照，之后改单或解除都不带动它。
  const snapshot: FloodwarnSnapshot = {
    预警级别: String(current.预警级别).trim(),
    影响区域: parseAreas(current.影响区域),
    预警依据: String(current.预警依据).trim(),
    发布时间: nowText(),
    解除时间: '',
    是否历史补录: false,
  }
  const updated: EntryRow = {
    ...current,
    status: STATUS_PUBLISHED,
    pending: true,
    发布时间: snapshot.发布时间,
    解除时间: '',
    发布快照: snapshot,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(KEY, next)
  return {
    ok: true,
    message: `预警单 ${snapshot.预警级别} 已发布，影响区域与级别已存为发布快照`,
  }
}

export function liftWarning(id: number): ActionResult {
  const rows = listRows(KEY)
  const index = rows.findIndex((row) => Number(row.id) === Number(id))
  if (index < 0) {
    return reject(`没有找到编号为 ${id} 的预警单`)
  }
  const current = rows[index]
  const status = String(current.status)
  const blocked = transitionGuard(status, STATUS_PUBLISHED, '解除预警', STATUS_LIFTED)
  if (blocked) {
    return blocked
  }
  const previous = (current.发布快照 as FloodwarnSnapshot | undefined) ?? null
  if (!previous) {
    // 正常不会发生：发布时一定落了快照。给明确失败提示而不是空白。
    return reject('解除失败：找不到这张预警单的发布快照，影响区域与级别无据可查，请联系管理员核对数据')
  }
  const liftedAt = nowText()
  // 快照仍是发布时同一份，只补上解除结论；级别、区域、依据、发布时间一律不动。
  const snapshot: FloodwarnSnapshot = { ...previous, 解除时间: liftedAt }
  const updated: EntryRow = {
    ...current,
    status: STATUS_LIFTED,
    pending: false,
    解除时间: liftedAt,
    发布快照: snapshot,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(KEY, next)
  return { ok: true, message: `预警单已解除，待办已移除；发布时的影响区域与级别快照保留可查` }
}

/** 行内可执行动作：只给「下一级」一个出口，界面上就不会出现跳级操作。 */
export function availableActions(view: FloodwarnView): { action: string; label: string }[] {
  switch (view.status) {
    case STATUS_DRAFT:
      return [{ action: 'submit', label: '提交拟稿' }]
    case STATUS_PENDING:
      return [{ action: 'publish', label: '发布预警' }]
    case STATUS_PUBLISHED:
      return [{ action: 'lift', label: '解除预警' }]
    default:
      return []
  }
}

/** 待办清单：待发布先办，已发布等解除次之，拟稿中最后；解除即出清单，自动重排。 */
export function listTodos(): FloodwarnTodo[] {
  const rank: Record<string, number> = {
    [STATUS_PENDING]: 0,
    [STATUS_PUBLISHED]: 1,
    [STATUS_DRAFT]: 2,
  }
  return listRows(KEY)
    .map(toView)
    .filter((view) => view.status !== STATUS_LIFTED)
    .map((view) => {
      if (view.status === STATUS_PENDING) {
        return {
          view,
          待办: view.预警依据 ? '发布预警' : '补填预警依据后发布',
          说明: view.预警依据
            ? '依据齐全，可发布；发布时冻结影响区域与预警级别。'
            : '预警依据为空，直接发布会被退回。',
        }
      }
      if (view.status === STATUS_PUBLISHED) {
        return { view, 待办: '解除预警', 说明: '预警生效中，解除后待办自动移除，发布快照保留。' }
      }
      return { view, 待办: '提交拟稿', 说明: '拟稿中，提交后进入待发布队列。' }
    })
    .sort((a, b) => {
      const diff = rank[a.view.status] - rank[b.view.status]
      if (diff !== 0) {
        return diff
      }
      const timeA = a.view.开始时间 || `9999-${a.view.id}`
      const timeB = b.view.开始时间 || `9999-${b.view.id}`
      return timeA === timeB ? a.view.id - b.view.id : timeA.localeCompare(timeB)
    })
}

export type FloodwarnStats = { label: string; value: number }[]

export function floodwarnStats(): FloodwarnStats {
  const views = listRows(KEY).map(toView)
  const activeAreas = new Set<string>()
  for (const view of views) {
    if (view.status === STATUS_PENDING || view.status === STATUS_PUBLISHED) {
      for (const area of view.影响区域) {
        activeAreas.add(area)
      }
    }
  }
  return [
    { label: '待发布预警', value: views.filter((view) => view.status === STATUS_PENDING).length },
    { label: '已发布预警', value: views.filter((view) => view.status === STATUS_PUBLISHED).length },
    { label: '在挂影响片区数', value: activeAreas.size },
  ]
}

export function exportFloodwarnCsv(): { filename: string; content: string } {
  const header = [
    '编号',
    '预警编号',
    '预警级别',
    '影响区域',
    '预警依据',
    '拟稿人',
    '预警开始',
    '预警结束',
    '发布时间',
    '解除时间',
    '当前状态',
  ]
  const lines = [header.join(',')]
  for (const view of listRows(KEY).map(toView)) {
    lines.push(
      [
        view.id,
        view.预警编号,
        view.预警级别,
        view.影响区域.join('、'),
        view.预警依据,
        view.拟稿人,
        view.开始时间,
        view.结束时间,
        view.发布时间,
        view.解除时间,
        view.status,
      ]
        .map((cell) => String(cell).replace(/"/g, '""'))
        .map((cell) => `"${cell}"`)
        .join(','),
    )
  }
  return { filename: '防涝预警发布-清单.csv', content: `﻿${lines.join('\n')}` }
}
