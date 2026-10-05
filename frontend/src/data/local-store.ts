import { MODULE_BY_KEY } from './modules'
import { SEED_ROWS } from './seed'
import type { EntryRow, FloodwarnSnapshot } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'drainage-pump:entries'

// 防涝预警模块的状态顺序只能顺着走；该模块在自己的服务层里再校验一遍。
const FLOODWARN_KEY = 'floodwarn'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 影响区域按常见分隔符拆成片区清单；空白与重复片区会被去掉。 */
export function parseAreas(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    const fromArray = raw.map((item) => String(item).trim()).filter(Boolean)
    return [...new Set(fromArray)]
  }
  const text = String(raw ?? '').trim()
  if (!text) {
    return []
  }
  const parts = text.split(/[、,，;；\n\r\t/|]+/)
  return [...new Set(parts.map((part) => part.trim()).filter(Boolean))]
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return normalizeAll(fallback, false)
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = normalizeAll(fallback, false)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  let parsed: Record<string, EntryRow[]>
  try {
    parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('数据结构不是对象')
    }
  } catch {
    // 读不出不假装是「没有记录」：抛上去让界面给出失败提示，而不是一片白或一直转圈。
    throw new Error('本地数据读取失败：保存的业务数据已损坏或无法解析，请修复后重试')
  }
  // 旧版本存过的模块继续沿用，新版本的模块用种子补齐。
  const merged = { ...fallback, ...parsed }
  return normalizeAll(merged, true)
}

/**
 * 逐行修补历史数据：
 * - pending 以当前状态为准重算，保证待办跟着状态走；
 * - 已发布/已解除的预警单若没有发布快照，用当时留在单上的级别与区域补一份并标记「历史补录」，
 *   解除之后详情不再是一片白。
 */
function normalizeRow(key: string, row: EntryRow): EntryRow {
  const meta = MODULE_BY_KEY.get(key)
  const next: EntryRow = { ...row }
  if (meta) {
    const lastStatus = meta.statuses[meta.statuses.length - 1]
    next.pending = String(next.status) !== lastStatus
  }

  if (key === FLOODWARN_KEY) {
    const status = String(next.status)
    if (status === '待拟稿' || status === '待发布') {
      next.发布时间 = ''
    }
    if (status !== '已解除') {
      next.解除时间 = ''
    }
    if ((status === '已发布' || status === '已解除') && !next.发布快照) {
      const snapshot: FloodwarnSnapshot = {
        预警级别: String(next.预警级别 ?? '').trim(),
        影响区域: parseAreas(next.影响区域),
        预警依据: String(next.预警依据 ?? '').trim(),
        发布时间: String(next.发布时间 ?? '').trim(),
        解除时间: status === '已解除' ? String(next.解除时间 ?? '').trim() : '',
        是否历史补录: true,
      }
      next.发布快照 = snapshot
    }
  }
  return next
}

function normalizeAll(
  data: Record<string, EntryRow[]>,
  persist: boolean,
): Record<string, EntryRow[]> {
  const normalized: Record<string, EntryRow[]> = {}
  for (const [key, rows] of Object.entries(data)) {
    normalized[key] = Array.isArray(rows) ? rows.map((row) => normalizeRow(key, row)) : []
  }
  if (persist && typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  }
  return normalized
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

/** 清空并重建全部本地数据（数据损坏时的修复入口）。 */
export function repairStorage(): Record<string, EntryRow[]> {
  const seeded = normalizeAll(clone(SEED_ROWS), false)
  cache = seeded
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
  }
  return seeded
}

export function nextId(key: string): number {
  const rows = listRows(key)
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

export function storageKey(): string {
  return STORAGE_KEY
}
