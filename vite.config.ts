import { defineConfig } from 'vite'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export default defineConfig(({ command, mode }) => {
  const root = fileURLToPath(new URL('.', import.meta.url))
  const buildMode = command === 'serve' ? 'development' : 'production'
  const createBuildIdentity = () => {
    const sourceHash = createHash('sha256')
    sourceHash.update(`test-mode:${process.env.ROBOT_LAB_TEST_MODE === '1' ? '1' : '0'}`)
    const collectSource = (directory: string): void => {
      const entries = readdirSync(join(root, directory), { withFileTypes: true })
      entries.sort((first, second) => first.name.localeCompare(second.name))
      for (const entry of entries) {
        const sourcePath = join(directory, entry.name)
        if (entry.isDirectory()) {
          collectSource(sourcePath)
        } else if (entry.isFile()) {
          sourceHash.update(sourcePath).update(readFileSync(join(root, sourcePath)))
        }
      }
    }
    collectSource('src')
    collectSource('server')
    for (const filename of ['index.html', 'preview.html', 'leaderboard.html', 'scripts/build-server.mjs', 'tsconfig.server.json', 'vite.config.ts', 'package.json', 'package-lock.json', 'tsconfig.json']) {
      sourceHash.update(filename).update(readFileSync(join(root, filename)))
    }
    const builtAt = new Date().toISOString()
    const buildId = `${buildMode === 'development' ? 'dev' : 'build'}-${sourceHash.digest('hex').slice(0, 12)}-${builtAt.replace(/\D/g, '')}`
    return { buildId, builtAt }
  }
  let identity = createBuildIdentity()
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version as string

  return {
    base: './',
    plugins: [{
      name: 'robot-lab-build-identity',
      handleHotUpdate(context) {
        if (!context.file.replaceAll('\\', '/').startsWith(`${root.replaceAll('\\', '/').replace(/\/$/, '')}/src/`)) return
        identity = createBuildIdentity()
        context.server.ws.send({ type: 'full-reload' })
        return []
      },
      transformIndexHtml(html: string) {
        return html
          .replaceAll('__ROBOT_TEST_MODE__', process.env.ROBOT_LAB_TEST_MODE === '1' ? '1' : '0')
          .replaceAll('__ROBOT_BUILD_ID__', identity.buildId)
          .replaceAll('__ROBOT_BUILD_TIME__', identity.builtAt)
          .replaceAll('__ROBOT_VERSION__', version)
          .replaceAll('__ROBOT_BUILD_MODE__', `${buildMode}/${mode}`)
      },
    }],
    server: {
      port: 3001,
      strictPort: true,
      proxy: { '/api': 'http://127.0.0.1:3002' },
      watch: { ignored: ['**/docs/evidence/**'] },
      headers: { 'Cache-Control': 'no-store' },
    },
    preview: {
      port: 3001,
      strictPort: true,
      proxy: { '/api': 'http://127.0.0.1:3002' },
      headers: { 'Cache-Control': 'no-store' },
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      rollupOptions: { input: { main: join(root, 'index.html'), preview: join(root, 'preview.html'), leaderboard: join(root, 'leaderboard.html') } },
    },
  }
})
