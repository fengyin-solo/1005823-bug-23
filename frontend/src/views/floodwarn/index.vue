<template>
  <section class="page" data-module="floodwarn">
    <header class="page-head">
      <div>
        <h2>防涝预警发布管理</h2>
        <p class="page-desc">发布时把影响区域与预警级别存成同一份快照，解除之后仍可查到当时那份，不跟着后来的改动变。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记预警单</button>
        <button class="btn" type="button" @click="exportRows">导出防涝预警发布清单</button>
      </div>
    </header>

    <div v-if="loadError" class="banner error" role="alert">
      <div>
        <strong>列表读取失败：</strong>{{ loadError }}
      </div>
      <button class="btn" type="button" @click="repairAndReload">修复为示例数据并重试</button>
    </div>

    <template v-else>
      <div class="stat-row">
        <article v-for="item in statCards" :key="item.label" class="stat-card">
          <span class="stat-label">{{ item.label }}</span>
          <strong class="stat-value">{{ item.value }}</strong>
        </article>
      </div>

      <p class="status-legend">
        <span v-for="item in statusSummary" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
      </p>

      <!-- 待办清单：跟着状态重排，解除即出清单 -->
      <section class="todo-panel">
        <h3 class="panel-title">待办清单（{{ todos.length }}）</h3>
        <p v-if="!todos.length" class="panel-empty">当前没有待办，所有预警单均已办结。</p>
        <ol v-else class="todo-list">
          <li v-for="item in todos" :key="item.view.id" class="todo-item">
            <RouterLink class="todo-main" :to="`/floodwarn/${item.view.id}`">
              <span class="todo-code">{{ item.view.预警编号 }}</span>
              <span :class="['level-tag', levelClass(item.view.预警级别)]">{{ item.view.预警级别 || '未定级' }}</span>
              <span class="todo-task">{{ item.待办 }}</span>
              <span class="todo-desc">{{ item.说明 }}</span>
            </RouterLink>
            <span class="todo-meta">{{ item.view.status }} · {{ item.view.影响区域文本 || '影响区域为空' }}</span>
          </li>
        </ol>
      </section>

      <form class="filter-bar" @submit.prevent="reload">
        <label v-for="field in filterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="filters[field]" :placeholder="`按${field}检索`" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <!-- 拟稿/改稿面板：预警依据发布前可缺，但发布那一格必须填；影响片区逐条添加 -->
      <form v-if="formOpen" class="form-panel" @submit.prevent="submitForm">
        <h3 class="panel-title">{{ editingId === null ? '登记预警单（拟稿）' : `修改拟稿 ${form.预警编号}` }}</h3>
        <div class="form-grid">
          <label class="form-item">
            <span>预警编号 <i>*</i></span>
            <input v-model="form.预警编号" :disabled="editingId !== null" placeholder="如 YJ-2026-019" />
          </label>
          <label class="form-item">
            <span>预警级别 <i>*</i></span>
            <select v-model="form.预警级别">
              <option value="" disabled>请选择级别</option>
              <option v-for="level in levels" :key="level" :value="level">{{ level }}</option>
            </select>
          </label>
          <label class="form-item">
            <span>拟稿人</span>
            <input v-model="form.拟稿人" placeholder="默认当前值班" />
          </label>
          <label class="form-item">
            <span>预警开始 <i>*</i></span>
            <input v-model="form.开始时间" type="datetime-local" />
          </label>
          <label class="form-item">
            <span>预警结束 <i>*</i></span>
            <input v-model="form.结束时间" type="datetime-local" />
          </label>
          <div class="form-item form-item-wide">
            <span>影响区域（可空；同一片区在同一时段已有待发布/已发布预警时会提示重复）</span>
            <div class="area-input">
              <input
                v-model="areaDraft"
                placeholder="输入片区名后点「添加」或回车，如 城东片"
                @keydown.enter.prevent="addArea"
              />
              <button class="btn" type="button" @click="addArea">添加</button>
            </div>
            <div v-if="form.影响区域.length" class="area-chips">
              <span v-for="area in form.影响区域" :key="area" class="area-chip">
                {{ area }}
                <button type="button" class="chip-remove" @click="removeArea(area)">×</button>
              </span>
            </div>
            <p v-else class="field-hint">尚未登记影响区域，发布后详情将按「空数据」说明，不会留一片白。</p>
          </div>
          <label class="form-item form-item-wide">
            <span>预警依据（拟稿时可空，发布时必填，否则会被退回）</span>
            <textarea v-model="form.预警依据" rows="3" placeholder="如：气象台暴雨橙色预警，6小时累计雨量超80毫米……"></textarea>
          </label>
        </div>
        <p v-if="formError" class="banner error inline">{{ formError }}</p>
        <div class="form-actions">
          <button class="btn primary" type="submit">{{ editingId === null ? '保存拟稿' : '保存修改' }}</button>
          <button class="btn ghost" type="button" @click="closeForm">取消</button>
        </div>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="view in rows" :key="String(view.id)">
            <td>
              <RouterLink class="link" :to="`/floodwarn/${view.id}`">{{ view.预警编号 }}</RouterLink>
            </td>
            <td><span :class="['level-tag', levelClass(view.预警级别)]">{{ view.预警级别 || '未定级' }}</span></td>
            <td>
              <template v-if="view.影响区域.length">{{ view.影响区域.join('、') }}</template>
              <span v-else class="muted-text">未登记影响区域（空数据）</span>
            </td>
            <td>
              <template v-if="view.预警依据">{{ view.预警依据 }}</template>
              <span v-else class="muted-text">未填，发布时会被退回</span>
            </td>
            <td>{{ view.拟稿人 || '—' }}</td>
            <td>{{ view.开始时间 || '—' }}</td>
            <td>{{ view.结束时间 || '—' }}</td>
            <td>{{ view.发布时间 || '—' }}</td>
            <td>{{ view.解除时间 || '—' }}</td>
            <td>
              <span class="status-badge">{{ view.status }}</span>
            </td>
            <td class="row-actions">
              <template v-for="item in availableActions(view)" :key="item.action">
                <button class="link" type="button" @click="runTransition(item.action, view)">
                  {{ item.label }}
                </button>
              </template>
              <button
                v-if="view.status === '待拟稿' || view.status === '待发布'"
                class="link"
                type="button"
                @click="openEdit(view)"
              >
                改稿
              </button>
              <RouterLink class="link" :to="`/floodwarn/${view.id}`">详情</RouterLink>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">
              没有符合条件的预警单，可点「登记预警单」拟稿；若这与预期不符，请检查上方筛选条件。
            </td>
          </tr>
        </tbody>
      </table>

      <p v-if="actionMessage" :class="['banner', actionOk ? 'success' : 'error', 'inline']">{{ actionMessage }}</p>

      <footer class="page-foot">
        <span>共 {{ total }} 条防涝预警发布记录</span>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  availableActions,
  createDraft,
  exportFloodwarnCsv,
  floodwarnStats,
  liftWarning,
  listFloodwarn,
  listTodos,
  publishWarning,
  submitDraft,
  updateDraft,
  warningLevels,
} from '@/api/floodwarn-service'
import { repairStorage } from '@/data/local-store'
import { useSessionStore } from '@/stores/session'
import type { FloodwarnTodo, FloodwarnView } from '@/data/types'

const session = useSessionStore()

const columns = ['预警编号', '预警级别', '影响区域', '预警依据', '拟稿人', '开始时间', '结束时间', '发布时间', '解除时间']
const filterFields = ['预警编号', '预警级别', '影响区域']
const statuses = ['待拟稿', '待发布', '已发布', '已解除']
const levels = warningLevels()

const rows = ref<FloodwarnView[]>([])
const todos = ref<FloodwarnTodo[]>([])
const total = ref(0)
const loadError = ref('')
const actionMessage = ref('')
const actionOk = ref(true)
const filters = ref<Record<string, string>>({})

const statCards = ref(floodwarnStats())

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((view) => view.status === status).length,
  })),
)

const formOpen = ref(false)
const editingId = ref<number | null>(null)
const formError = ref('')
const areaDraft = ref('')
const form = reactive({
  预警编号: '',
  预警级别: '',
  影响区域: [] as string[],
  预警依据: '',
  拟稿人: '',
  开始时间: '',
  结束时间: '',
})

function levelClass(level: string): string {
  if (level.startsWith('一级')) return 'level-red'
  if (level.startsWith('二级')) return 'level-orange'
  if (level.startsWith('三级')) return 'level-yellow'
  if (level.startsWith('四级')) return 'level-blue'
  return 'level-none'
}

function resetForm() {
  form.预警编号 = `YJ-${new Date().getFullYear()}-${String(Date.now()).slice(-3)}`
  form.预警级别 = ''
  form.影响区域 = []
  form.预警依据 = ''
  form.拟稿人 = session.operator
  form.开始时间 = ''
  form.结束时间 = ''
  areaDraft.value = ''
  formError.value = ''
}

function openCreate() {
  editingId.value = null
  resetForm()
  formOpen.value = true
  actionMessage.value = ''
}

function openEdit(view: FloodwarnView) {
  editingId.value = view.id
  form.预警编号 = view.预警编号
  form.预警级别 = view.预警级别
  form.影响区域 = [...view.影响区域]
  form.预警依据 = view.预警依据
  form.拟稿人 = view.拟稿人
  form.开始时间 = view.开始时间
  form.结束时间 = view.结束时间
  areaDraft.value = ''
  formError.value = ''
  formOpen.value = true
  actionMessage.value = ''
}

function closeForm() {
  formOpen.value = false
  editingId.value = null
}

function addArea() {
  const name = areaDraft.value.trim()
  if (!name) {
    return
  }
  if (!form.影响区域.includes(name)) {
    form.影响区域.push(name)
  }
  areaDraft.value = ''
}

function removeArea(name: string) {
  form.影响区域 = form.影响区域.filter((item) => item !== name)
}

function submitForm() {
  formError.value = ''
  const payload = { ...form, 影响区域: [...form.影响区域] }
  const result = editingId.value === null
    ? createDraft(payload)
    : updateDraft(editingId.value, payload)
  if (!result.ok) {
    formError.value = result.message
    return
  }
  closeForm()
  notify(true, result.message)
  reload()
}

function runTransition(action: string, view: FloodwarnView) {
  const result =
    action === 'submit' ? submitDraft(view.id)
    : action === 'publish' ? publishWarning(view.id)
    : liftWarning(view.id)
  notify(result.ok, result.message)
  if (result.ok) {
    reload()
  }
}

function notify(ok: boolean, message: string) {
  actionOk.value = ok
  actionMessage.value = message
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  const { filename, content } = exportFloodwarnCsv()
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function reload() {
  loadError.value = ''
  try {
    const payload = listFloodwarn(filters.value)
    rows.value = payload.items
    total.value = payload.total
    todos.value = listTodos()
    statCards.value = floodwarnStats()
  } catch (error) {
    // 读不出给出失败提示，不假装空数据，也不让界面一直转圈。
    loadError.value = error instanceof Error ? error.message : '防涝预警发布列表读取失败，请重试'
  }
}

function repairAndReload() {
  repairStorage()
  reload()
}

onMounted(reload)
</script>
