// 临时测试构建器：
// 1) 把 src/data/floodwarn.ts 及其依赖打成一个 ESM 包（处理 @/ 别名）；
// 2) 把测试文件单独编译成 ESM，并把 @/data/floodwarn 重写到第 1 步的产物。
// esbuild 本体不打进产物，避免 ESM 里动态 require 它的 CJS 依赖。
import { build } from 'esbuild'
import { join } from 'node:path'

const root = process.cwd()
const outDir = '.tmp-floodwarn-test'
const domainOut = join(root, outDir, 'domain.mjs')

await build({
  entryPoints: ['src/data/floodwarn.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: domainOut,
  alias: { '@': join(root, 'src') },
  logLevel: 'silent',
})

const testPlugin = {
  name: 'rewrite-alias',
  setup(b) {
    b.onResolve({ filter: /^@\/data\/floodwarn$/ }, () => ({
      path: domainOut,
    }))
  },
}

await build({
  entryPoints: ['floodwarn.test.mts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: join(root, outDir, 'test.mjs'),
  plugins: [testPlugin],
  external: ['esbuild', 'node:assert/strict', 'node:test', 'node:url', 'node:fs', 'node:os', 'node:path'],
  logLevel: 'silent',
})
console.log('built')
