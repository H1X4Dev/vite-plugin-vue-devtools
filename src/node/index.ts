import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { normalizePath } from 'vite'
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite'
import sirv from 'sirv'
import Inspect from 'vite-plugin-inspect'
import { createRPCServer } from 'vite-dev-rpc'
import type { ViteInspectAPI } from 'vite-plugin-inspect'
import VueInspector from 'vite-plugin-vue-inspector'
import { DIR_CLIENT } from '../dir'
import type { RPCFunctions } from '../types'

const NAME = 'vite-plugin-vue-devtools'

function getVueDevtoolsPath() {
  const pluginPath = normalizePath(path.dirname(fileURLToPath(import.meta.url)))
  return pluginPath.replace(/\/dist$/, '/\/src')
}

async function getComponentsRelationships(rpc: ViteInspectAPI['rpc']) {
  const list = await rpc.list()
  const modules = list?.modules || []

  return modules
  const vueModules = modules.filter(i => i.id.match(/\.vue($|\?v=)/))

  const graph = vueModules.map((i) => {
    function searchForVueDeps(id: string, seen = new Set<string>()): string[] {
      if (seen.has(id))
        return []
      seen.add(id)
      const module = modules.find(m => m.id === id)
      if (!module)
        return []
      return module.deps.flatMap((i) => {
        if (vueModules.find(m => m.id === i))
          return [i]
        return searchForVueDeps(i, seen)
      })
    }

    return {
      id: i.id,
      deps: searchForVueDeps(i.id),
    }
  })

  return graph
}

export default function PluginVueDevtools(): Plugin[] {
  const vueDevtoolsPath = getVueDevtoolsPath()
  const inspect = Inspect()
  let config: ResolvedConfig

  function configureServer(server: ViteDevServer) {
    const base = (server.config.base) || '/'
    server.middlewares.use(`${base}__devtools`, sirv(DIR_CLIENT, {
      single: true,
      dev: true,
    }))

    createRPCServer<RPCFunctions>('vite-plugin-vue-devtools', server.ws, {
      componentGraph: () => getComponentsRelationships(inspect.api.rpc),
      inspectClientUrl: () => `${config.base || '/'}__inspect/`,
    })
  }
  const plugin = <Plugin>{
    name: NAME,
    enforce: 'post',
    apply: 'serve',
    configResolved(resolvedConfig) {
      config = resolvedConfig
    },
    configureServer(server) {
      configureServer(server)
      // setTimeout(() => {
      //   console.log(server.resolvedUrls)
      // }, 3000)
      // console.log(server)
    },
    async resolveId(importee: string) {
      if (importee.startsWith('virtual:vue-devtools-options')) {
        return importee
      }
      else if (importee.startsWith('virtual:vue-devtools-path:')) {
        const resolved = importee.replace('virtual:vue-devtools-path:', `${vueDevtoolsPath}/`)
        return resolved
      }
    },
    async load(id) {
      if (id === 'virtual:vue-devtools-options')
        return `export default ${JSON.stringify({ ...config })}`
    },
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'script',
            injectTo: 'head',
            attrs: {
              type: 'module',
              src: '/@id/virtual:vue-devtools-path:app.js',
            },
          },
        ],
      }
    },
    async buildEnd() {
    },
  }

  return [
    inspect,
    VueInspector({
      toggleComboKey: '',
      toggleButtonVisibility: 'never',
    }) as Plugin,
    plugin,
  ]
}
