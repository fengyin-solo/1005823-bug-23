import { __resetCacheForTest, listRows, saveRows } from './local-store'
import type { EntryRow } from './types'

// 测试辅助：重置本地存储的内存缓存（生产代码不用）。
export const __resetStoreCache = __resetCacheForTest

// 防涝预警领域层：拟稿、发布、解除都收敛在这里。
// 核心约定：发布那一刻把「影响区域」与「预警级别」存进同一份发布快照，
// 之后列表与详情都读快照，解除后也还能查到当时那份，不跟着后来的改动变。

export const FLOODWARN_KEY = 'floodwarn'
export const SNAPSHOT_FIELD = '发布快照'

export const STATUSES = ['待拟稿', '待发布', '已发布', '已解除'] as const
export type WarningStatus = (typeof STATUSES)[number]

export const LEVELS = ['蓝色', '黄色', '橙色', '红色'] as const
export type WarningLevel = (typeof LEVELS)[number]

export const AREA_OPTIONS = [
  '临江片',
  '临港片',
  '湿地片',
  '城西片',
  '老城片',
  '高新片',
  '高铁片',
  '南站片',
] as const

const ACTIVE_STATUSES: WarningStatus[] = ['待发布', '已发布']
const STATUS_ACTIONS: Record<WarningStatus, '提交拟稿' | '发布预警' | '解除预警'> = {
  待拟稿: '提交拟稿',
  待发布: '发布预警',
  已发布: '解除预警',
  已解除: '解除预警',
}

export type PublishSnapshot = {
  预警编号: string
  预警级别: string
  影响区域: string[]
  预警依据: string
  拟稿人: string
  发布时间: string
  计划开始: string
  计划结束: string
  [field: string]: string | string[]
}

export type DraftInput = {
  预警编号: string
  预警级别: string
  影响区域: string[]
  预警依据: string
  拟稿人: string
  计划开始: string
  计划结束: string
}

export type FieldErrors = Record<string, string>

// 业务校验失败：带字段级错误，表单可以把原因指到具体哪一格。
export class FloodWarnError extends Error {
  fields: FieldErrors
  code: string
  constructor(message: string, fields: FieldErrors = {}, code = 'FLOOD_WARN_ERROR') {
    super(message)
    this.name = 'FloodWarnError'
    this.fields = fields
    this.code = code
  }
}

// 查不到这一单：和「读不出来」区分开，界面给不同说明。
export class WarningNotFoundError extends FloodWarnError {
  constructor(message: string) {
    super(message, {}, 'WARNING_NOT_FOUND')
    this.name = 'WarningNotFoundError'
  }
}

export type WarningRecord = {
  id: number
  status: WarningStatus
  code: string
  level: string
  areaList: string[]
  basis: string
  operator: string
  planStart: string
  planEnd: string
  publishedAt: string
  liftedAt: string
  conclusion: string
  snapshot: PublishSnapshot | null
}

// 给界面用的视图模型：发布之后一律以快照为准，保证列表与详情是同一份数据。
export type WarningDisplay = WarningRecord

export type TodoItem = {
  id: number
  todoKind: 'submit' | 'publish' | 'lift'
  label: string
  actionLabel: '提交拟稿' | '发布预警' | '解除预警'
  code: string
  level: string
  areas: string
  planStart: string
}

function parseAreas(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter((item) => item.trim() !== '')
  }
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return []
    try {
      const parsed: unknown = JSON.parse(text)
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item)).filter((item) => item.trim() !== '')
      }
    } catch {
      // 兼容改造前的存量数据：逗号、顿号分隔的一段文字也能解析成片区列表。
      return text.split(/[,，、]/).map((item) => item.trim()).filter(Boolean)
    }
  }
  return []
}

function parseSnapshot(id: number, value: unknown): PublishSnapshot | null {
  if (typeof value !== 'string') {
    return value && typeof value === 'object' ? (value as PublishSnapshot) : null
  }
  const text = value.trim()
  if (!text) return null
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object') {
      return parsed as PublishSnapshot
    }
    throw new Error('快照不是对象结构')
  } catch (error) {
    const reason = error instanceof Error ? error.message : '格式损坏'
    throw new Error(`预警单 ${id} 的发布快照读不出来（${reason}），无法保证展示的是发布时那份，请联系管理员核对数据。`)
  }
}

export function fromRow(row: EntryRow): WarningRecord {
  const id = Number(row.id)
  const snapshot = parseSnapshot(id, row[SNAPSHOT_FIELD])
  const record: WarningRecord = {
    id,
    status: String(row.status) as WarningStatus,
    code: String(row['预警编号'] ?? ''),
    level: String(row['预警级别'] ?? ''),
    areaList: parseAreas(row['影响区域']),
    basis: String(row['预警依据'] ?? ''),
    operator: String(row['拟稿人'] ?? ''),
    planStart: String(row['计划开始'] ?? ''),
    planEnd: String(row['计划结束'] ?? ''),
    publishedAt: String(row['发布时间'] ?? ''),
    liftedAt: String(row['解除时间'] ?? ''),
    conclusion: String(row['解除结论'] ?? ''),
    snapshot,
  }
  // 发布之后，级别与影响区域只认发布时锁定的那一份快照。
  if (snapshot) {
    record.level = String(snapshot['预警级别'] ?? record.level)
    record.areaList = parseAreas(snapshot['影响区域'])
    record.code = String(snapshot['预警编号'] ?? record.code)
    record.basis = String(snapshot['预警依据'] ?? record.basis)
    record.operator = String(snapshot['拟稿人'] ?? record.operator)
    record.planStart = String(snapshot['计划开始'] ?? record.planStart)
    record.planEnd = String(snapshot['计划结束'] ?? record.planEnd)
    record.publishedAt = String(snapshot['发布时间'] ?? record.publishedAt)
  }
  return record
}

function toRow(record: WarningRecord): EntryRow {
  return {
    id: record.id,
    status: record.status,
    pending: record.status !== '已解除',
    abnormal: false,
    预警编号: record.code,
    预警级别: record.level,
    影响区域: JSON.stringify(record.areaList),
    预警依据: record.basis,
    拟稿人: record.operator,
    计划开始: record.planStart,
    计划结束: record.planEnd,
    发布时间: record.publishedAt,
    解除时间: record.liftedAt,
    解除结论: record.conclusion,
    预警状态: record.status,
    [SNAPSHOT_FIELD]: record.snapshot ? JSON.stringify(record.snapshot) : '',
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function nowText(): string {
  const date = new Date()
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function normalizeTime(value: string): string {
  return value.includes('T') ? value.replace('T', ' ') : value
}

// 对外统一走展示模型：列表与详情同源，不会再出现「两处不是同一份」。
export function listWarnings(filters: Record<string, string> = {}): WarningDisplay[] {
  const records = listRows(FLOODWARN_KEY).map(fromRow)
  const code = filters['预警编号']?.trim() ?? ''
  const level = filters['预警级别']?.trim() ?? ''
  const area = filters['影响区域']?.trim() ?? ''
  return records.filter((record) => {
    if (code && !record.code.includes(code)) return false
    if (level && record.level !== level) return false
    if (area && !record.areaList.some((item) => item.includes(area))) return false
    return true
  })
}

export function getWarning(id: number): WarningDisplay {
  const row = listRows(FLOODWARN_KEY).find((item) => Number(item.id) === id)
  if (!row) {
    throw new WarningNotFoundError(`查不到编号为 ${id} 的预警单，可能已被删除或从未登记。`)
  }
  return fromRow(row)
}

function levelWeight(level: string): number {
  const index = LEVELS.indexOf(level as WarningLevel)
  return index < 0 ? 0 : index
}

function periodsOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  const aStart = Date.parse(startA.replace(' ', 'T'))
  const aEnd = Date.parse(endA.replace(' ', 'T'))
  const bStart = Date.parse(startB.replace(' ', 'T'))
  const bEnd = Date.parse(endB.replace(' ', 'T'))
  if ([aStart, aEnd, bStart, bEnd].some(Number.isNaN)) {
    // 时段不完整时按同日保守处理，宁可提示重复也不漏掉撞期。
    return true
  }
  return aStart < bEnd && bStart < aEnd
}

function conflictMessage(record: WarningRecord, areas: string[], inputCode: string): string {
  const overlap = areas.filter((area) => record.areaList.includes(area)).join('、')
  const statusText = record.status === '已发布' ? '已发布、正在生效' : '待发布'
  return `片区「${overlap}」在同一时段已有${statusText}的预警 ${record.code}（级别：${record.level}，时段：${record.planStart} 至 ${record.planEnd}），与 ${inputCode} 同时挂着会造成重复发布，请先解除或错开时段。`
}

// 检查同片区同时段是否已有待发布/已发布的预警；排除自身与已解除办结的单子。
function findConflict(input: DraftInput, selfId: number | null): string {
  const areas = input.影响区域
  if (areas.length === 0 || !input.计划开始 || !input.计划结束) return ''
  for (const record of listRows(FLOODWARN_KEY).map(fromRow)) {
    if (record.id === selfId) continue
    if (!ACTIVE_STATUSES.includes(record.status)) continue
    const sameArea = areas.some((area) => record.areaList.includes(area))
    if (!sameArea) continue
    if (periodsOverlap(input.计划开始, input.计划结束, record.planStart, record.planEnd)) {
      return conflictMessage(record, areas, input.预警编号)
    }
  }
  return ''
}

function normalizeDraft(input: Partial<DraftInput>): DraftInput {
  const uniqueAreas = Array.from(
    new Set(
      (input.影响区域 ?? [])
        .map((area) => area.trim())
        .filter(Boolean),
    ),
  )
  return {
    预警编号: (input.预警编号 ?? '').trim(),
    预警级别: (input.预警级别 ?? '').trim(),
    影响区域: uniqueAreas,
    预警依据: (input.预警依据 ?? '').trim(),
    拟稿人: (input.拟稿人 ?? '').trim(),
    计划开始: normalizeTime((input.计划开始 ?? '').trim()),
    计划结束: normalizeTime((input.计划结束 ?? '').trim()),
  }
}

// 拟稿阶段校验：编号、级别、拟稿人、时段必填；影响区域允许为空（按空数据展示）。
function validateDraft(raw: Partial<DraftInput>, selfId: number | null): { input: DraftInput; fields: FieldErrors } {
  const input = normalizeDraft(raw)
  const fields: FieldErrors = {}
  if (!input.预警编号) {
    fields['预警编号'] = '预警编号必填，请填写编号。'
  } else {
    const duplicate = listRows(FLOODWARN_KEY)
      .map(fromRow)
      .find((record) => record.code === input.预警编号 && record.id !== selfId)
    if (duplicate) {
      fields['预警编号'] = `预警编号 ${input.预警编号} 已存在（当前状态：${duplicate.status}），同一编号重复登记/发布只允许保留一条。`
    }
  }
  if (!input.预警级别) {
    fields['预警级别'] = '预警级别必选，请选择蓝/黄/橙/红其中一级。'
  } else if (!LEVELS.includes(input.预警级别 as WarningLevel)) {
    fields['预警级别'] = `预警级别「${input.预警级别}」不在允许的蓝、黄、橙、红四级内。`
  }
  if (!input.拟稿人) {
    fields['拟稿人'] = '拟稿人必填。'
  }
  if (!input.计划开始) {
    fields['计划开始'] = '影响时段开始必填。'
  }
  if (!input.计划结束) {
    fields['计划结束'] = '影响时段结束必填。'
  }
  if (input.计划开始 && input.计划结束) {
    const start = Date.parse(input.计划开始.replace(' ', 'T'))
    const end = Date.parse(input.计划结束.replace(' ', 'T'))
    if (!Number.isNaN(start) && !Number.isNaN(end) && start >= end) {
      fields['计划结束'] = '影响时段结束必须晚于开始时间。'
    }
  }
  // 影响区域为空不拦：空数据要有明确说明而不是禁止保存。
  if (input.影响区域.length > 0) {
    const conflict = findConflict(input, selfId)
    if (conflict) {
      fields['影响区域'] = conflict
    }
  }
  return { input, fields }
}

function assertStatus(record: WarningRecord, expected: WarningStatus, action: string): void {
  if (record.status === expected) return
  const currentIndex = STATUSES.indexOf(record.status)
  const expectedIndex = STATUSES.indexOf(expected)
  const route = STATUSES.join(' → ')
  if (expectedIndex <= currentIndex) {
    throw new FloodWarnError(`预警单 ${record.code} 当前是「${record.status}」，不能执行「${action}」；状态只能顺着 ${route} 流转，不允许跳级或回退。`)
  }
  throw new FloodWarnError(`预警单 ${record.code} 当前是「${record.status}」，还不能「${action}」，需先完成上一环节；状态只能顺着 ${route} 逐级流转。`)
}

function readAll(): WarningRecord[] {
  return listRows(FLOODWARN_KEY).map(fromRow)
}

function persist(records: WarningRecord[]): void {
  saveRows(FLOODWARN_KEY, records.map(toRow))
}

function nextId(records: WarningRecord[]): number {
  return records.reduce((max, record) => Math.max(max, record.id), 0) + 1
}

export function createDraft(raw: Partial<DraftInput>): WarningDisplay {
  const { input, fields } = validateDraft(raw, null)
  if (Object.keys(fields).length > 0) {
    throw new FloodWarnError('预警单登记被退回，请按提示补全后再保存。', fields)
  }
  const records = readAll()
  const record: WarningRecord = {
    id: nextId(records),
    status: '待拟稿',
    code: input.预警编号,
    level: input.预警级别,
    areaList: input.影响区域,
    basis: input.预警依据,
    operator: input.拟稿人,
    planStart: input.计划开始,
    planEnd: input.计划结束,
    publishedAt: '',
    liftedAt: '',
    conclusion: '',
    snapshot: null,
  }
  persist([...records, record])
  return record
}

export function updateDraft(id: number, raw: Partial<DraftInput>): WarningDisplay {
  const records = readAll()
  const index = records.findIndex((record) => record.id === id)
  if (index < 0) {
    throw new WarningNotFoundError(`查不到编号为 ${id} 的预警单。`)
  }
  assertStatus(records[index], '待拟稿', '修改拟稿')
  const { input, fields } = validateDraft(raw, id)
  if (Object.keys(fields).length > 0) {
    throw new FloodWarnError('拟稿修改被退回，请按提示补全后再保存。', fields)
  }
  records[index] = {
    ...records[index],
    code: input.预警编号,
    level: input.预警级别,
    areaList: input.影响区域,
    basis: input.预警依据,
    operator: input.拟稿人,
    planStart: input.计划开始,
    planEnd: input.计划结束,
  }
  persist(records)
  return records[index]
}

export function submitDraft(id: number): WarningDisplay {
  const records = readAll()
  const index = records.findIndex((record) => record.id === id)
  if (index < 0) {
    throw new WarningNotFoundError(`查不到编号为 ${id} 的预警单。`)
  }
  assertStatus(records[index], '待拟稿', '提交拟稿')
  // 提交时再做一次片区撞期检查，防止拟稿存着期间别的单子抢先挂起。
  if (records[index].areaList.length > 0) {
    const conflict = findConflict(
      {
        预警编号: records[index].code,
        预警级别: records[index].level,
        影响区域: records[index].areaList,
        预警依据: records[index].basis,
        拟稿人: records[index].operator,
        计划开始: records[index].planStart,
        计划结束: records[index].planEnd,
      },
      id,
    )
    if (conflict) {
      throw new FloodWarnError(`提交被退回：${conflict}`, { '影响区域': conflict })
    }
  }
  records[index] = { ...records[index], status: '待发布' }
  persist(records)
  return records[index]
}

// 待发布阶段补充预警依据：只补这一格、不改状态，避免依据为空被发布退回后无路可走。
export function supplementBasis(id: number, basis: string): WarningDisplay {
  const text = basis.trim()
  if (!text) {
    throw new FloodWarnError('补充被退回：预警依据仍为空，请填写气象/水文依据或调度令。', { '预警依据': '预警依据必填，不能为空。' })
  }
  const records = readAll()
  const index = records.findIndex((record) => record.id === id)
  if (index < 0) {
    throw new WarningNotFoundError(`查不到编号为 ${id} 的预警单。`)
  }
  assertStatus(records[index], '待发布', '补充预警依据')
  records[index] = { ...records[index], basis: text }
  persist(records)
  return records[index]
}

export function publishWarning(id: number): WarningDisplay {  const records = readAll()
  const index = records.findIndex((record) => record.id === id)
  if (index < 0) {
    throw new WarningNotFoundError(`查不到编号为 ${id} 的预警单。`)
  }
  const current = records[index]
  assertStatus(current, '待发布', '发布预警')

  // 预警依据没填的单子不许发布：退回并指出缺哪一格。
  const fields: FieldErrors = {}
  if (!current.basis) {
    fields['预警依据'] = '预警依据为空，不允许发布；请在该格填写气象/水文依据或调度令后再发布。'
  }
  if (current.areaList.length > 0) {
    const conflict = findConflict(
      {
        预警编号: current.code,
        预警级别: current.level,
        影响区域: current.areaList,
        预警依据: current.basis,
        拟稿人: current.operator,
        计划开始: current.planStart,
        计划结束: current.planEnd,
      },
      id,
    )
    if (conflict) {
      fields['影响区域'] = conflict
    }
  }
  if (Object.keys(fields).length > 0) {
    throw new FloodWarnError(`预警单 ${current.code} 发布被退回，请补齐后再发布。`, fields)
  }

  // 发布时刻：影响区域与预警级别（连同依据、拟稿人、时段）存成同一份快照，一次性锁定。
  const publishedAt = nowText()
  const snapshot: PublishSnapshot = {
    预警编号: current.code,
    预警级别: current.level,
    影响区域: [...current.areaList],
    预警依据: current.basis,
    拟稿人: current.operator,
    发布时间: publishedAt,
    计划开始: current.planStart,
    计划结束: current.planEnd,
  }
  records[index] = {
    ...current,
    status: '已发布',
    publishedAt,
    snapshot,
  }
  persist(records)
  return records[index]
}

export function liftWarning(id: number, conclusion: string): WarningDisplay {
  const text = conclusion.trim()
  if (!text) {
    throw new FloodWarnError('解除被退回：解除结论必填，请说明雨情水情与退水结论。', { '解除结论': '解除结论必填。' })
  }
  const records = readAll()
  const index = records.findIndex((record) => record.id === id)
  if (index < 0) {
    throw new WarningNotFoundError(`查不到编号为 ${id} 的预警单。`)
  }
  assertStatus(records[index], '已发布', '解除预警')
  // 只改解除状态、时间与结论；发布快照原封不动，解除后查的还是当时那份。
  records[index] = {
    ...records[index],
    status: '已解除',
    liftedAt: nowText(),
    conclusion: text,
  }
  persist(records)
  return records[index]
}

// 待办清单：只列未办结的单子，按 流程节点 → 级别（红橙黄蓝）→ 计划开始 排序；
// 解除后该条直接从待办消失，清单自然跟着解除结论重排。
export function listTodos(): TodoItem[] {
  const kindRank: Record<WarningStatus, number> = {
    // 越接近办结越优先处理：待解除 > 待发布 > 待拟稿；已解除不进待办。
    待拟稿: 2,
    待发布: 1,
    已发布: 0,
    已解除: 9,
  }
  const kindOf: Record<WarningStatus, TodoItem['todoKind'] | null> = {
    待拟稿: 'submit',
    待发布: 'publish',
    已发布: 'lift',
    已解除: null,
  }
  const labelOf: Record<WarningStatus, string> = {
    待拟稿: '拟稿待提交：核对级别、片区与依据后提交发布',
    待发布: '待发布预警：确认预警依据齐备后发布',
    已发布: '生效中预警：跟踪雨情水情，达到解除条件时填报结论解除',
    已解除: '',
  }
  return readAll()
    .filter((record) => kindOf[record.status] !== null)
    .map((record): TodoItem & { _rank: number; _weight: number } => ({
      id: record.id,
      todoKind: kindOf[record.status] as TodoItem['todoKind'],
      label: labelOf[record.status],
      actionLabel: STATUS_ACTIONS[record.status],
      code: record.code,
      level: record.level,
      areas: record.areaList.length ? record.areaList.join('、') : '未圈定区域',
      planStart: record.planStart,
      _rank: kindRank[record.status],
      _weight: levelWeight(record.level),
    }))
    .sort((a, b) => {
      if (a._rank !== b._rank) return a._rank - b._rank
      if (a._weight !== b._weight) return b._weight - a._weight
      return a.planStart.localeCompare(b.planStart)
    })
    .map(({ _rank, _weight, ...item }) => item)
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function buildWarningsCsv(records: WarningDisplay[]): string {
  const header = ['编号', '预警编号', '预警级别', '影响区域', '预警依据', '拟稿人', '计划开始', '计划结束', '发布时间', '解除时间', '解除结论', '当前状态']
  const lines = [header.join(',')]
  for (const record of records) {
    lines.push(
      [
        String(record.id),
        record.code,
        record.level,
        record.areaList.join('、'),
        record.basis,
        record.operator,
        record.planStart,
        record.planEnd,
        record.publishedAt,
        record.liftedAt,
        record.conclusion,
        record.status,
      ].map(csvCell).join(','),
    )
  }
  return `﻿${lines.join('\n')}`
}
