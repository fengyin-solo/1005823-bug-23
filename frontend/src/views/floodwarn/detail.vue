<template>
  <section class="page" data-module="floodwarn-detail">
    <header class="page-head">
      <div>
        <h2>
          预警单详情
          <span v-if="view" class="title-code">（{{ view.预警编号 }}）</span>
        </h2>
        <p class="page-desc">已发布或已解除的单据展示发布那一刻冻结的快照；影响区域为空时按空数据说明，不显示一片白。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/floodwarn">返回列表</RouterLink>
      </div>
    </header>

    <p v-if="loading" class="banner info">正在读取预警单，请稍候……</p>

    <div v-else-if="loadError" class="banner error" role="alert">
      <div>
        <strong>详情读取失败：</strong>{{ loadError }}
      </div>
      <div class="form-actions">
        <button class="btn" type="button" @click="load">重新读取</button>
        <button class="btn" type="button" @click="repairAndReload">修复为示例数据并重试</button>
      </div>
    </div>

    <div v-else-if="!view" class="banner warn" role="status">
      <strong>没有这条预警单记录。</strong>
      可能已被清除或编号有误，这不是加载问题；请返回列表核对，或重新登记预警单。
    </div>

    <template v-else>
      <p v-if="actionMessage" :class="['banner', actionOk ? 'success' : 'error']">
        {{ actionMessage }}
      </p>

      <div class="detail-head">
        <span :class="['level-tag', levelClass(view.预警级别)]">{{ view.预警级别 || '未定级' }}</span>
        <span class="status-badge">{{ view.status }}</span>
        <span class="muted-text">拟稿人：{{ view.拟稿人 || '—' }}</span>
        <span class="muted-text">预警时段：{{ view.开始时间 || '—' }} 至 {{ view.结束时间 || '—' }}</span>
      </div>

      <!-- 发布快照：发布时存下的同一份底子，解除后也不变 -->
      <article class="snapshot-panel">
        <h3 class="panel-title">
          发布快照
          <span class="panel-tag">{{ view.快照 ? '已冻结，不随单据改动变化' : '尚未生成' }}</span>
        </h3>

        <template v-if="view.快照">
          <p v-if="view.快照.是否历史补录" class="banner warn inline">
            本单在快照功能上线前已办结，以下级别与区域依据当时单上内容补录冻结，仅供查阅。
          </p>
          <dl class="detail-grid">
            <div class="detail-cell">
              <dt>预警级别（发布时）</dt>
              <dd><span :class="['level-tag', levelClass(view.快照.预警级别)]">{{ view.快照.预警级别 || '未定级' }}</span></dd>
            </div>
            <div class="detail-cell detail-cell-wide">
              <dt>影响区域（发布时圈定的片区）</dt>
              <dd v-if="view.快照.影响区域.length">
                <span v-for="area in view.快照.影响区域" :key="area" class="area-chip area-chip-static">{{ area }}</span>
              </dd>
              <dd v-else>
                <span class="muted-text">空数据：发布时没有登记任何影响区域，并非没有加载出来。</span>
              </dd>
            </div>
            <div class="detail-cell detail-cell-wide">
              <dt>预警依据（发布时）</dt>
              <dd>{{ view.快照.预警依据 || '（未填）' }}</dd>
            </div>
            <div class="detail-cell">
              <dt>发布时间</dt>
              <dd>{{ view.快照.发布时间 || '—' }}</dd>
            </div>
            <div class="detail-cell">
              <dt>解除时间</dt>
              <dd>{{ view.快照.解除时间 || '尚未解除' }}</dd>
            </div>
          </dl>
        </template>

        <p v-else class="panel-empty">
          该预警单尚未发布，暂时没有发布快照；执行「发布预警」时会把当时的影响区域与预警级别一并存下，解除之后仍可在此查阅。
        </p>
      </article>

      <!-- 拟稿现稿：未发布时展示当前填写内容，已发布后仅作对照 -->
      <article class="snapshot-panel">
        <h3 class="panel-title">
          单据现稿
          <span class="panel-tag">{{ view.status === '已发布' || view.status === '已解除' ? '仅供对照，以发布快照为准' : '发布前可改稿' }}</span>
        </h3>
        <dl class="detail-grid">
          <div class="detail-cell">
            <dt>预警编号</dt>
            <dd>{{ view.预警编号 }}</dd>
          </div>
          <div class="detail-cell">
            <dt>预警级别</dt>
            <dd>{{ view.预警级别 || '（未选）' }}</dd>
          </div>
          <div class="detail-cell detail-cell-wide">
            <dt>影响区域（现稿）</dt>
            <dd v-if="view.影响区域.length">{{ view.影响区域.join('、') }}</dd>
            <dd v-else><span class="muted-text">空数据：当前单据没有登记影响区域。</span></dd>
          </div>
          <div class="detail-cell detail-cell-wide">
            <dt>预警依据（现稿）</dt>
            <dd>{{ view.预警依据 || '（未填，发布时会被退回）' }}</dd>
          </div>
        </dl>
      </article>

      <div class="detail-actions">
        <template v-for="item in availableActions(view)" :key="item.action">
          <button class="btn primary" type="button" @click="runTransition(item.action)">{{ item.label }}</button>
        </template>
        <button
          v-if="view.status === '待拟稿' || view.status === '待发布'"
          class="btn"
          type="button"
          @click="goEdit"
        >
          改稿
        </button>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  availableActions,
  getFloodwarn,
  liftWarning,
  publishWarning,
  submitDraft,
} from '@/api/floodwarn-service'
import { repairStorage } from '@/data/local-store'
import type { FloodwarnView } from '@/data/types'

const route = useRoute()
const router = useRouter()

const view = ref<FloodwarnView | null>(null)
const loading = ref(true)
const loadError = ref('')
const actionMessage = ref('')
const actionOk = ref(true)

function levelClass(level: string): string {
  if (level.startsWith('一级')) return 'level-red'
  if (level.startsWith('二级')) return 'level-orange'
  if (level.startsWith('三级')) return 'level-yellow'
  if (level.startsWith('四级')) return 'level-blue'
  return 'level-none'
}

function load() {
  loading.value = true
  loadError.value = ''
  actionMessage.value = ''
  try {
    const id = Number(route.params.id)
    view.value = Number.isFinite(id) ? getFloodwarn(id) : null
    if (!Number.isFinite(id)) {
      loadError.value = '预警单编号无效，无法读取详情。'
    }
  } catch (error) {
    // 读不出明确提示失败，由用户选择重试或修复，而不是一直转圈或留白。
    view.value = null
    loadError.value = error instanceof Error ? error.message : '预警单详情读取失败，请重试'
  } finally {
    loading.value = false
  }
}

function repairAndReload() {
  repairStorage()
  load()
}

function runTransition(action: string) {
  if (!view.value) {
    return
  }
  const result =
    action === 'submit' ? submitDraft(view.value.id)
    : action === 'publish' ? publishWarning(view.value.id)
    : liftWarning(view.value.id)
  actionOk.value = result.ok
  actionMessage.value = result.message
  if (result.ok) {
    load()
  }
}

function goEdit() {
  router.push('/floodwarn')
}

watch(() => route.params.id, load)
onMounted(load)
</script>
