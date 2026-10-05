<template>
  <section class="page" data-module="floodwarn">
    <header class="page-head">
      <div>
        <h2>防涝预警发布管理</h2>
        <p class="page-desc">维护预警单，围绕预警编号、预警级别、影响区域、预警依据做登记、发布与解除流转。发布时锁定影响区域与预警级别快照，解除后仍可查当时那份。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记预警单</button>
        <button class="btn" type="button" @click="exportRows">导出防涝预警发布清单</button>
      </div>
    </header>

    <div v-if="successMessage" class="banner success">{{ successMessage }}</div>
    <div v-if="errorMessage" class="banner error">{{ errorMessage }}<button v-if="listFailed" class="link" type="button" style="margin-left:8px" @click="reload">重试</button></div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <!-- 待办清单：随预警解除结论实时重排，已解除的单子不再挂待办 -->
    <div class="todo-panel">
      <div class="todo-head">待办清单（按流程节点、预警级别、计划开始时间排序）</div>
      <table class="data-table">
        <thead>
          <tr><th style="width:44px">序</th><th>待办事项</th><th>预警编号</th><th>预警级别</th><th>影响片区</th><th>计划开始</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in todos" :key="item.id">
            <td><span class="todo-order">{{ index + 1 }}</span></td>
            <td>{{ item.label }}</td>
            <td>{{ item.code }}</td>
            <td><span :class="['level-badge', levelClass(item.level)]">{{ item.level }}</span></td>
            <td>{{ item.areas }}</td>
            <td>{{ item.planStart }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="runTodo(item)">{{ item.actionLabel }}</button>
            </td>
          </tr>
          <tr v-if="!todos.length">
            <td colspan="7" class="empty-state">暂无待办事项：所有预警均已办结或解除。</td>
          </tr>
        </tbody>
      </table>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>预警编号</span>
        <input v-model="filters['预警编号']" placeholder="按预警编号检索" />
      </label>
      <label class="filter-item">
        <span>预警级别</span>
        <select v-model="filters['预警级别']">
          <option value="">全部级别</option>
          <option v-for="level in levels" :key="level" :value="level">{{ level }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>影响片区</span>
        <input v-model="filters['影响区域']" placeholder="按片区检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>预警编号</th>
          <th>预警级别</th>
          <th>影响区域</th>
          <th>预警依据</th>
          <th>拟稿人</th>
          <th>影响时段</th>
          <th>发布时间</th>
          <th>解除时间</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="listLoading">
          <td :colspan="10" class="state-note">预警清单读取中，请稍候…</td>
        </tr>
        <tr v-for="row in displayRows" :key="row.id">
          <td><button class="warning-no-link" type="button" @click="openDetail(row.id)">{{ row.code }}</button></td>
          <td><span :class="['level-badge', levelClass(row.level)]">{{ row.level }}</span></td>
          <td>
            <span v-if="row.areaList.length" class="area-tags">
              <span v-for="area in row.areaList" :key="area" class="area-tag">{{ area }}</span>
            </span>
            <span v-else class="area-tag empty">未圈定影响区域（空数据）</span>
          </td>
          <td>{{ row.basis || '—' }}</td>
          <td>{{ row.operator }}</td>
          <td>{{ row.planStart || '—' }} 至 {{ row.planEnd || '—' }}</td>
          <td>{{ row.publishedAt || '—' }}</td>
          <td>{{ row.liftedAt || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="row.status === '待拟稿'">
              <button class="link" type="button" @click="openEdit(row.id)">修改拟稿</button>
              <button class="link" type="button" @click="runStatusAction('submitDraft', row.id)">提交拟稿</button>
            </template>
            <button v-else-if="row.status === '待发布'" class="link" type="button" @click="runStatusAction('publishWarning', row.id)">发布预警</button>
            <button v-if="row.status === '待发布'" class="link" type="button" @click="openSupplement(row.id)">补充预警依据</button>
            <button v-else-if="row.status === '已发布'" class="link" type="button" @click="openLift(row.id)">解除预警</button>
            <span v-else class="area-empty-note">已办结</span>
          </td>
        </tr>
        <tr v-if="!listLoading && !listFailed && !displayRows.length">
          <td :colspan="10" class="empty-state">{{ hasFilter ? '没有符合筛选条件的预警单' : '暂无防涝预警发布数据，可先登记预警单' }}</td>
        </tr>
        <tr v-if="!listLoading && listFailed">
          <td :colspan="10" class="state-note error">预警清单读取失败，未能展示记录。<button class="link" type="button" style="margin-left:8px" @click="reload">重试</button></td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ displayRows.length }} 条防涝预警发布记录；发布后的级别与影响区域以发布快照为准，不再随拟稿改动变化。</span>
    </footer>

    <!-- 登记 / 修改拟稿 -->
    <div v-if="draftForm" class="modal-mask" @click.self="closeDraft">
      <div class="modal-card">
        <div class="modal-head">
          <h3>{{ draftForm.id === null ? '登记预警单（待拟稿）' : '修改拟稿' }}</h3>
          <button class="modal-close" type="button" @click="closeDraft">×</button>
        </div>
        <div class="modal-body">
          <div v-if="draftFormError" class="banner error">{{ draftFormError }}</div>
          <div class="form-grid">
            <div class="form-field">
              <label>预警编号<span class="required">*</span></label>
              <input v-model="draftForm.预警编号" :class="{ invalid: !!draftErrors['预警编号'] }" placeholder="如 YJ-2026-1004" />
              <span v-if="draftErrors['预警编号']" class="field-error">{{ draftErrors['预警编号'] }}</span>
            </div>
            <div class="form-field">
              <label>预警级别<span class="required">*</span></label>
              <select v-model="draftForm.预警级别" :class="{ invalid: !!draftErrors['预警级别'] }">
                <option value="" disabled>请选择级别</option>
                <option v-for="level in levels" :key="level" :value="level">{{ level }}</option>
              </select>
              <span v-if="draftErrors['预警级别']" class="field-error">{{ draftErrors['预警级别'] }}</span>
            </div>
            <div class="form-field full">
              <label>影响区域（圈定片区，可多选）</label>
              <div class="area-picker">
                <button
                  v-for="area in areaOptions"
                  :key="area"
                  type="button"
                  :class="['area-chip', { selected: draftForm.影响区域.includes(area) }]"
                  @click="toggleArea(area)"
                >{{ area }}</button>
              </div>
              <input v-model="customArea" placeholder="片区不在候选里？输入后回车追加" @keydown.enter.prevent="addCustomArea" />
              <span v-if="draftErrors['影响区域']" class="field-error">{{ draftErrors['影响区域'] }}</span>
              <span v-else class="area-empty-note">不选任何片区时按空数据保存，详情页会明确说明，不留空白。</span>
            </div>
            <div class="form-field full">
              <label>预警依据<span class="required">*</span>（发布前必填，拟稿阶段可后补）</label>
              <textarea v-model="draftForm.预警依据" :class="{ invalid: !!draftErrors['预警依据'] }" placeholder="如气象台暴雨预警、潮位站超警戒读数、调度令编号等"></textarea>
              <span v-if="draftErrors['预警依据']" class="field-error">{{ draftErrors['预警依据'] }}</span>
            </div>
            <div class="form-field">
              <label>拟稿人<span class="required">*</span></label>
              <input v-model="draftForm.拟稿人" :class="{ invalid: !!draftErrors['拟稿人'] }" />
              <span v-if="draftErrors['拟稿人']" class="field-error">{{ draftErrors['拟稿人'] }}</span>
            </div>
            <div class="form-field"></div>
            <div class="form-field">
              <label>影响时段开始<span class="required">*</span></label>
              <input v-model="draftForm.计划开始" type="datetime-local" :class="{ invalid: !!draftErrors['计划开始'] }" />
              <span v-if="draftErrors['计划开始']" class="field-error">{{ draftErrors['计划开始'] }}</span>
            </div>
            <div class="form-field">
              <label>影响时段结束<span class="required">*</span></label>
              <input v-model="draftForm.计划结束" type="datetime-local" :class="{ invalid: !!draftErrors['计划结束'] }" />
              <span v-if="draftErrors['计划结束']" class="field-error">{{ draftErrors['计划结束'] }}</span>
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn ghost" type="button" @click="closeDraft">取消</button>
          <button class="btn primary" type="button" :disabled="draftSaving" @click="saveDraft">{{ draftSaving ? '保存中…' : '保存拟稿' }}</button>
        </div>
      </div>
    </div>

    <!-- 解除预警 -->
    <div v-if="liftForm" class="modal-mask" @click.self="closeLift">
      <div class="modal-card narrow">
        <div class="modal-head">
          <h3>解除预警：{{ liftForm.code }}</h3>
          <button class="modal-close" type="button" @click="closeLift">×</button>
        </div>
        <div class="modal-body">
          <div v-if="liftError" class="banner error">{{ liftError }}</div>
          <div class="snapshot-box" style="margin-bottom:12px">
            <div class="snapshot-title">发布时锁定的快照（解除不改动它）</div>
            <div class="detail-grid">
              <div class="detail-item"><span class="detail-label">预警级别</span><span class="detail-value"><span :class="['level-badge', levelClass(liftForm.level)]">{{ liftForm.level }}</span></span></div>
              <div class="detail-item"><span class="detail-label">发布时间</span><span class="detail-value">{{ liftForm.publishedAt }}</span></div>
              <div class="detail-item full"><span class="detail-label">影响区域</span><span class="detail-value">{{ liftForm.areas || '未圈定影响区域（空数据）' }}</span></div>
              <div class="detail-item full"><span class="detail-label">预警依据</span><span class="detail-value">{{ liftForm.basis || '—' }}</span></div>
            </div>
          </div>
          <div class="form-field">
            <label>解除结论<span class="required">*</span></label>
            <textarea v-model="liftForm.conclusion" :class="{ invalid: !!liftFieldError }" placeholder="说明雨情/水情结论、退水情况、有无伤亡，作为待办重排与归档依据"></textarea>
            <span v-if="liftFieldError" class="field-error">{{ liftFieldError }}</span>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn ghost" type="button" @click="closeLift">取消</button>
          <button class="btn primary" type="button" :disabled="liftSaving" @click="confirmLift">{{ liftSaving ? '提交中…' : '确认解除' }}</button>
        </div>
      </div>
    </div>

    <!-- 待发布阶段补充预警依据（不改状态） -->
    <div v-if="supplementState" class="modal-mask" @click.self="closeSupplement">
      <div class="modal-card narrow">
        <div class="modal-head">
          <h3>补充预警依据：{{ supplementState.code }}</h3>
          <button class="modal-close" type="button" @click="closeSupplement">×</button>
        </div>
        <div class="modal-body">
          <div v-if="supplementState.error" class="banner error">{{ supplementState.error }}</div>
          <p class="area-empty-note" style="margin-top:0">该单处于「待发布」，发布时校验到预警依据缺失；补填这一格后即可发布，状态不变。</p>
          <div class="form-field">
            <label>预警依据<span class="required">*</span></label>
            <textarea v-model="supplementState.basis" :class="{ invalid: !!supplementState.fieldError }" placeholder="如气象台暴雨预警、潮位站超警戒读数、调度令编号等"></textarea>
            <span v-if="supplementState.fieldError" class="field-error">{{ supplementState.fieldError }}</span>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn ghost" type="button" @click="closeSupplement">取消</button>
          <button class="btn primary" type="button" :disabled="supplementState.saving" @click="confirmSupplement">{{ supplementState.saving ? '保存中…' : '保存并回到待发布' }}</button>
        </div>
      </div>
    </div>

    <!-- 预警详情：明确区分 读取中 / 读不出 / 查无此单 / 空数据 -->
    <div v-if="detailState" class="modal-mask" @click.self="closeDetail">
      <div class="modal-card">
        <div class="modal-head">
          <h3>预警单详情</h3>
          <button class="modal-close" type="button" @click="closeDetail">×</button>
        </div>
        <div class="modal-body">
          <div v-if="detailState.status === 'loading'" class="state-note">详情读取中，请稍候…</div>
          <div v-else-if="detailState.status === 'error'" class="state-note error">
            {{ detailState.message }}
            <div style="margin-top:10px"><button class="btn" type="button" @click="reloadDetail">重试</button></div>
          </div>
          <div v-else-if="detailState.status === 'notfound'" class="state-note">{{ detailState.message }}</div>
          <template v-else>
            <div v-if="detailError" class="banner error">{{ detailError }}</div>
            <div class="detail-grid">
              <div class="detail-item"><span class="detail-label">预警编号</span><span class="detail-value">{{ detailState.data.code }}</span></div>
              <div class="detail-item"><span class="detail-label">当前状态</span><span class="detail-value">{{ detailState.data.status }}</span></div>
              <div class="detail-item full"><span class="detail-label">预警级别</span><span class="detail-value"><span :class="['level-badge', levelClass(detailState.data.level)]">{{ detailState.data.level || '—' }}</span></span></div>
              <div class="detail-item full">
                <span class="detail-label">影响区域</span>
                <span v-if="detailState.data.areaList.length" class="area-tags">
                  <span v-for="area in detailState.data.areaList" :key="area" class="area-tag">{{ area }}</span>
                </span>
                <span v-else class="area-tag empty">未圈定影响区域（空数据），该预警单发布时未圈选任何片区。</span>
              </div>
              <div class="detail-item full"><span class="detail-label">预警依据</span><span class="detail-value">{{ detailState.data.basis || '—' }}</span></div>
              <div class="detail-item"><span class="detail-label">拟稿人</span><span class="detail-value">{{ detailState.data.operator || '—' }}</span></div>
              <div class="detail-item"><span class="detail-label">影响时段</span><span class="detail-value">{{ detailState.data.planStart || '—' }} 至 {{ detailState.data.planEnd || '—' }}</span></div>
            </div>

            <div v-if="detailState.data.snapshot" class="snapshot-box" style="margin-top:14px">
              <div class="snapshot-title">发布快照 · 发布于 {{ detailState.data.snapshot['发布时间'] }}</div>
              <div class="detail-grid">
                <div class="detail-item"><span class="detail-label">快照级别</span><span class="detail-value"><span :class="['level-badge', levelClass(String(detailState.data.snapshot['预警级别'] ?? ''))]">{{ detailState.data.snapshot['预警级别'] }}</span></span></div>
                <div class="detail-item"><span class="detail-label">快照发布时间</span><span class="detail-value">{{ detailState.data.snapshot['发布时间'] }}</span></div>
                <div class="detail-item full">
                  <span class="detail-label">快照影响区域（与级别同一份，发布后不可改）</span>
                  <span v-if="snapshotAreas.length" class="area-tags">
                    <span v-for="area in snapshotAreas" :key="area" class="area-tag">{{ area }}</span>
                  </span>
                  <span v-else class="area-tag empty">发布时未圈定影响区域（空数据）</span>
                </div>
                <div class="detail-item full"><span class="detail-label">快照预警依据</span><span class="detail-value">{{ detailState.data.snapshot['预警依据'] || '—' }}</span></div>
              </div>
              <p v-if="detailState.data.status === '已解除'" class="lifted-note">该预警已解除并办结，上方为解除当时保留下来的发布快照，不再随任何后来的改动变化。</p>
            </div>
            <div v-else class="snapshot-box" style="margin-top:14px">
              <div class="snapshot-title">发布快照</div>
              <div class="area-empty-note">该预警单尚未发布，还没有发布快照；发布预警时会把影响区域与预警级别存成同一份快照锁定。</div>
            </div>

            <div v-if="detailState.data.status === '已解除'" class="detail-grid" style="margin-top:14px">
              <div class="detail-item"><span class="detail-label">解除时间</span><span class="detail-value">{{ detailState.data.liftedAt || '—' }}</span></div>
              <div class="detail-item full"><span class="detail-label">解除结论</span><span class="detail-value">{{ detailState.data.conclusion || '—' }}</span></div>
            </div>
          </template>
        </div>
        <div class="modal-foot">
          <button class="btn" type="button" @click="closeDetail">关闭</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  AREA_OPTIONS,
  FloodWarnError,
  LEVELS,
  buildWarningsCsv,
  createDraft,
  getWarning,
  listTodos,
  listWarnings,
  liftWarning,
  publishWarning,
  submitDraft,
  supplementBasis,
  updateDraft,
} from '@/data/floodwarn'
import type { FieldErrors, TodoItem, WarningDisplay } from '@/data/floodwarn'

const levels = LEVELS
const areaOptions = AREA_OPTIONS

const rows = ref<WarningDisplay[]>([])
const todos = ref<TodoItem[]>([])
const listLoading = ref(false)
const listFailed = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({ '预警编号': '', '预警级别': '', '影响区域': '' })

type DraftFormState = {
  id: number | null
  预警编号: string
  预警级别: string
  影响区域: string[]
  预警依据: string
  拟稿人: string
  计划开始: string
  计划结束: string
}
const draftForm = ref<DraftFormState | null>(null)
const draftErrors = ref<FieldErrors>({})
const draftFormError = ref('')
const draftSaving = ref(false)
const customArea = ref('')

type LiftFormState = { id: number; code: string; level: string; areas: string; basis: string; publishedAt: string; conclusion: string }
const liftForm = ref<LiftFormState | null>(null)
const liftFieldError = ref('')
const liftError = ref('')
const liftSaving = ref(false)

type SupplementState = { id: number; code: string; basis: string; fieldError: string; error: string; saving: boolean }
const supplementState = ref<SupplementState | null>(null)

type DetailState =
  | { status: 'loading' }
  | { status: 'ready'; data: WarningDisplay }
  | { status: 'error'; message: string }
  | { status: 'notfound'; message: string }
const detailState = ref<DetailState | null>(null)
const detailId = ref<number | null>(null)
const detailError = ref('')

const displayRows = computed(() => rows.value)
const hasFilter = computed(() => Object.values(filters.value).some((value) => value.trim() !== ''))

const stats = computed(() => {
  const waiting = rows.value.filter((row) => row.status === '待发布').length
  const published = rows.value.filter((row) => row.status === '已发布').length
  const activeAreas = new Set<string>()
  for (const row of rows.value) {
    if (row.status === '已发布') {
      row.areaList.forEach((area) => activeAreas.add(area))
    }
  }
  return [
    { label: '待发布预警', value: waiting },
    { label: '已发布预警', value: published },
    { label: '生效影响片区数', value: activeAreas.size },
  ]
})

const statusSummary = computed(() =>
  (['待拟稿', '待发布', '已发布', '已解除'] as const).map((status) => ({
    status,
    count: rows.value.filter((row) => row.status === status).length,
  })),
)

const snapshotAreas = computed<string[]>(() => {
  if (detailState.value?.status !== 'ready' || !detailState.value.data.snapshot) {
    return []
  }
  const raw = detailState.value.data.snapshot['影响区域']
  return Array.isArray(raw) ? raw.map((item) => String(item)) : []
})

function levelClass(level: string): string {
  if (level === '红色') return 'red'
  if (level === '橙色') return 'orange'
  if (level === '黄色') return 'yellow'
  return 'blue'
}

function delay(ms = 120): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function isFieldError(error: unknown): error is FloodWarnError & { fields: FieldErrors } {
  return error instanceof FloodWarnError && !!error.fields && Object.keys(error.fields).length > 0
}

async function reload() {
  listLoading.value = true
  listFailed.value = false
  errorMessage.value = ''
  await delay()
  try {
    rows.value = listWarnings(filters.value)
    todos.value = listTodos()
  } catch (error) {
    listFailed.value = true
    errorMessage.value = error instanceof Error ? `预警清单读取失败：${error.message}` : '预警清单读取失败，请稍后重试。'
  } finally {
    listLoading.value = false
  }
}

function resetFilters() {
  filters.value = { '预警编号': '', '预警级别': '', '影响区域': '' }
  void reload()
}

function exportRows() {
  try {
    const content = buildWarningsCsv(rows.value)
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = '防涝预警发布-清单.csv'
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  } catch (error) {
    errorMessage.value = error instanceof Error ? `导出失败：${error.message}` : '导出失败，请稍后重试。'
  }
}

function blankDraft(): DraftFormState {
  return {
    id: null,
    预警编号: '',
    预警级别: '',
    影响区域: [],
    预警依据: '',
    拟稿人: '值班管理员',
    计划开始: '',
    计划结束: '',
  }
}

function openCreate() {
  successMessage.value = ''
  errorMessage.value = ''
  draftForm.value = blankDraft()
  draftErrors.value = {}
  draftFormError.value = ''
  customArea.value = ''
}

function openEdit(id: number) {
  successMessage.value = ''
  errorMessage.value = ''
  try {
    const warning = getWarning(id)
    draftForm.value = {
      id: warning.id,
      预警编号: warning.code,
      预警级别: warning.level,
      影响区域: [...warning.areaList],
      预警依据: warning.basis,
      拟稿人: warning.operator,
      计划开始: toDateTimeLocal(warning.planStart),
      计划结束: toDateTimeLocal(warning.planEnd),
    }
    draftErrors.value = {}
    draftFormError.value = ''
    customArea.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '拟稿读取失败，请稍后重试。'
  }
}

function toDateTimeLocal(value: string): string {
  return value ? value.replace(' ', 'T') : ''
}

function closeDraft() {
  draftForm.value = null
}

function toggleArea(area: string) {
  if (!draftForm.value) return
  const list = draftForm.value.影响区域
  draftForm.value.影响区域 = list.includes(area) ? list.filter((item) => item !== area) : [...list, area]
}

function addCustomArea() {
  if (!draftForm.value) return
  const area = customArea.value.trim()
  if (area && !draftForm.value.影响区域.includes(area)) {
    draftForm.value.影响区域 = [...draftForm.value.影响区域, area]
  }
  customArea.value = ''
}

async function saveDraft() {
  if (!draftForm.value) return
  draftSaving.value = true
  draftErrors.value = {}
  draftFormError.value = ''
  await delay(150)
  try {
    const input = {
      预警编号: draftForm.value.预警编号,
      预警级别: draftForm.value.预警级别,
      影响区域: draftForm.value.影响区域,
      预警依据: draftForm.value.预警依据,
      拟稿人: draftForm.value.拟稿人,
      计划开始: draftForm.value.计划开始.replace('T', ' '),
      计划结束: draftForm.value.计划结束.replace('T', ' '),
    }
    if (draftForm.value.id === null) {
      createDraft(input)
      successMessage.value = '预警单已登记为「待拟稿」。'
    } else {
      updateDraft(draftForm.value.id, input)
      successMessage.value = '拟稿已更新。'
    }
    draftForm.value = null
    await reload()
  } catch (error) {
    if (isFieldError(error)) {
      draftErrors.value = error.fields
    }
    draftFormError.value = error instanceof Error ? error.message : '保存失败，请稍后重试。'
  } finally {
    draftSaving.value = false
  }
}

async function runStatusAction(action: 'submitDraft' | 'publishWarning', id: number) {
  successMessage.value = ''
  errorMessage.value = ''
  await delay(150)
  try {
    if (action === 'submitDraft') {
      submitDraft(id)
      successMessage.value = `预警单 ${id} 已提交拟稿，进入「待发布」。`
    } else {
      publishWarning(id)
      successMessage.value = `预警单 ${id} 已发布：影响区域与预警级别已存为同一份快照。`
    }
    await reload()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '操作失败，请稍后重试。'
  }
}

function runTodo(item: TodoItem) {
  if (item.todoKind === 'submit') {
    void runStatusAction('submitDraft', item.id)
  } else if (item.todoKind === 'publish') {
    void runStatusAction('publishWarning', item.id)
  } else {
    openLift(item.id)
  }
}

function openLift(id: number) {
  successMessage.value = ''
  errorMessage.value = ''
  try {
    const warning = getWarning(id)
    liftForm.value = {
      id,
      code: warning.code,
      level: warning.level,
      areas: warning.areaList.length ? warning.areaList.join('、') : '',
      basis: warning.basis,
      publishedAt: warning.publishedAt,
      conclusion: '',
    }
    liftFieldError.value = ''
    liftError.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '预警读取失败，暂时无法解除。'
  }
}

function closeLift() {
  liftForm.value = null
}

function openSupplement(id: number) {
  successMessage.value = ''
  errorMessage.value = ''
  try {
    const warning = getWarning(id)
    supplementState.value = { id, code: warning.code, basis: warning.basis, fieldError: '', error: '', saving: false }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '预警单读取失败，暂时无法补充依据。'
  }
}

function closeSupplement() {
  supplementState.value = null
}

async function confirmSupplement() {
  const state = supplementState.value
  if (!state) return
  state.saving = true
  state.fieldError = ''
  state.error = ''
  await delay(150)
  try {
    supplementBasis(state.id, state.basis)
    successMessage.value = `预警单 ${state.code} 的预警依据已补充，状态仍为「待发布」，可直接发布。`
    supplementState.value = null
    await reload()
  } catch (error) {
    if (error instanceof FloodWarnError && error.fields['预警依据']) {
      state.fieldError = error.fields['预警依据']
    } else {
      state.error = error instanceof Error ? error.message : '保存失败，请稍后重试。'
    }
    state.saving = false
  }
}

async function confirmLift() {
  if (!liftForm.value) return
  liftSaving.value = true
  liftFieldError.value = ''
  liftError.value = ''
  await delay(150)
  try {
    if (!liftForm.value.conclusion.trim()) {
      liftFieldError.value = '解除结论必填：请说明雨情水情与退水结论后再解除。'
      return
    }
    liftWarning(liftForm.value.id, liftForm.value.conclusion)
    successMessage.value = `预警单 ${liftForm.value.code} 已解除并办结，待办清单已按解除结论重排。`
    liftForm.value = null
    await reload()
    if (detailState.value?.status === 'ready') {
      closeDetail()
    }
  } catch (error) {
    if (error instanceof FloodWarnError && error.fields['解除结论']) {
      liftFieldError.value = error.fields['解除结论']
    } else {
      liftError.value = error instanceof Error ? error.message : '解除失败，请稍后重试。'
    }
  } finally {
    liftSaving.value = false
  }
}

function openDetail(id: number) {
  detailId.value = id
  detailState.value = { status: 'loading' }
  detailError.value = ''
  void delay(180).then(() => loadDetail(id))
}

function loadDetail(id: number) {
  try {
    const data = getWarning(id)
    detailState.value = { status: 'ready', data }
  } catch (error) {
    if (error instanceof FloodWarnError && error.code === 'WARNING_NOT_FOUND') {
      detailState.value = { status: 'notfound', message: error.message }
    } else {
      detailState.value = {
        status: 'error',
        message: error instanceof Error ? `详情读不出来：${error.message}` : '详情读取失败，请稍后重试。',
      }
    }
  }
}

function reloadDetail() {
  if (detailId.value === null) return
  detailState.value = { status: 'loading' }
  window.setTimeout(() => loadDetail(detailId.value ?? 0), 150)
}

function closeDetail() {
  detailState.value = null
  detailId.value = null
}

onMounted(reload)
</script>
