/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

/**
 * 发布快照：预警单「发布预警」那一刻冻结的底子。
 * 影响区域与预警级别在发布时一并存成同一份，之后单据怎么改、是否解除，都不动它。
 */
export type FloodwarnSnapshot = {
  预警级别: string
  影响区域: string[]
  预警依据: string
  发布时间: string
  解除时间: string
  是否历史补录: boolean
}

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean | FloodwarnSnapshot
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 防涝预警单的读模型：列表与详情都读这一份，避免「两处留下的东西不是同一份」。 */
export type FloodwarnView = {
  id: number
  预警编号: string
  预警级别: string
  影响区域: string[]
  影响区域文本: string
  预警依据: string
  拟稿人: string
  开始时间: string
  结束时间: string
  发布时间: string
  解除时间: string
  status: string
  pending: boolean
  abnormal: boolean
  快照: FloodwarnSnapshot | null
  行: EntryRow
}

export type FloodwarnTodo = {
  view: FloodwarnView
  待办: string
  说明: string
}
