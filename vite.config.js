import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

function cvBackupPlugin() {
  const FILE_NAME = 'cv-backup.json'
  let rootDir = process.cwd()

  return {
    name: 'cv-backup-plugin',
    configureServer(server) {
      rootDir = server.config.root || process.cwd()
      const filePath = path.resolve(rootDir + "/public", FILE_NAME)

      server.middlewares.use(async (req, res, next) => {
        try {
          const url = new URL(req.url || '/', 'http://local')
          const p = url.pathname

          if (!p.startsWith('/__backup')) return next()

          // CORS / Preflight
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
          if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }

          if (p === '/__backup/ping') {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true }))
            return
          }

          if (p === '/__backup/cv') {
            if (req.method === 'GET') {
              if (!fs.existsSync(filePath)) {
                res.statusCode = 404
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ ok:false, error:'not_found', path:filePath }))
                return
              }
              const txt = await fsp.readFile(filePath, 'utf8')
              res.setHeader('Content-Type', 'application/json')
              res.end(txt)
              return
            }

            if (req.method === 'POST') {
              let body = ''
              for await (const chunk of req) body += chunk
              try {
                const parsed = JSON.parse(body)
                await fsp.writeFile(filePath, JSON.stringify(parsed, null, 2), 'utf8')
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ ok:true, path:filePath }))
              } catch (e) {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ ok:false, error:'invalid_json', message:String(e) }))
              }
              return
            }

            res.statusCode = 405
            res.setHeader('Allow', 'GET, POST, OPTIONS')
            res.end(JSON.stringify({ ok:false, error:'method_not_allowed' }))
            return
          }

          next()
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok:false, error:'middleware_crash', message:String(err) }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [vue(), cvBackupPlugin()],
})
