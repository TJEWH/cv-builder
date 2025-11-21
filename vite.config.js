import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

function slugifyName(s) {
  return String(s || '')
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-')
      .replace(/[^a-z0-9\-]+/g, '')
      .replace(/\-+/g, '-')
      .replace(/^\-+|\-+$/g, '') || 'cv-backup'
}

function cvBackupPlugin() {
  const LEGACY_FILE = 'cv-backup.json' // Legacy-Pfad (Kompatibilität)
  let rootDir = process.cwd()

  const ensureDir = async (dir) => {
    if (!fs.existsSync(dir)) await fsp.mkdir(dir, { recursive: true })
  }

  const readMeta = async (fullPath, id) => {
    try {
      const txt = await fsp.readFile(fullPath, 'utf8')
      const json = JSON.parse(txt)
      // Datei kann entweder {__meta, data} oder "plain" sein
      const name =
          (json && json.__meta && json.__meta.name) ||
          path.basename(fullPath, '.json')
      const stat = await fsp.stat(fullPath)
      return { id: id || path.basename(fullPath, '.json'), name, mtime: stat.mtimeMs }
    } catch {
      return null
    }
  }

  return {
    name: 'cv-backup-plugin',
    configureServer(server) {
      rootDir = server.config.root || process.cwd()
      const legacyPath = path.resolve(rootDir, 'public', LEGACY_FILE)
      const dirPath = path.resolve(rootDir, 'public', 'cv-backups')

      server.middlewares.use(async (req, res, next) => {
        try {
          const url = new URL(req.url || '/', 'http://local')
          const p = url.pathname

          if (!p.startsWith('/__backup')) return next()

          // CORS / Preflight
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
          if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }

          await ensureDir(dirPath)

          // Health
          if (p === '/__backup/ping') {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true }))
            return
          }

          // Liste aller Backups
          if (p === '/__backup/list' && req.method === 'GET') {
            const files = (await fsp.readdir(dirPath)).filter(f => f.endsWith('.json'))
            const items = []
            for (const f of files) {
              const meta = await readMeta(path.join(dirPath, f))
              if (meta) items.push(meta)
            }

            // Legacy-Datei (nur lesend) optional ergänzen, falls vorhanden
            if (fs.existsSync(legacyPath)) {
              const stat = await fsp.stat(legacyPath)
              items.push({ id: 'legacy', name: 'Legacy (cv-backup.json)', mtime: stat.mtimeMs })
            }

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, items }))
            return
          }

          // Backup laden/speichern (benannt)
          if (p === '/__backup/cv') {
            const idParam = url.searchParams.get('id') // optional
            const isLegacy = !idParam // Legacy: kein id= -> alter Pfad
            const id = isLegacy ? 'legacy' : slugifyName(idParam)
            const target = isLegacy ? legacyPath : path.join(dirPath, `${id}.json`)

            if (req.method === 'GET') {
              if (!fs.existsSync(target)) {
                res.statusCode = 404
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ ok:false, error:'not_found', path: target }))
                return
              }
              const txt = await fsp.readFile(target, 'utf8')
              let json = {}
              try { json = JSON.parse(txt) } catch {}
              // Unwrap: immer reine Daten zurückgeben
              const data = (json && json.__meta && json.data) ? json.data : json
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(data))
              return
            }

            if (req.method === 'POST') {
              let body = ''
              for await (const chunk of req) body += chunk
              try {
                const parsed = JSON.parse(body)
                // Erwartet Wrapper { __meta:{id,name}, data } oder fall-back plain state
                let wrap
                if (parsed && parsed.__meta && parsed.data) {
                  const meta = {
                    id: slugifyName(parsed.__meta.id || id),
                    name: parsed.__meta.name || parsed.__meta.id || id,
                    updatedAt: new Date().toISOString()
                  }
                  wrap = { __meta: meta, data: parsed.data }
                  // Datei-Name ggf. aus Meta ableiten
                  const fileForMeta = path.join(dirPath, `${slugifyName(meta.id)}.json`)
                  await fsp.writeFile(fileForMeta, JSON.stringify(wrap, null, 2), 'utf8')
                  res.setHeader('Content-Type', 'application/json')
                  res.end(JSON.stringify({ ok:true, id: meta.id, name: meta.name, path: fileForMeta }))
                  return
                } else {
                  // Kompatibilität: plain -> als legacy oder benannt ohne Meta speichern
                  const meta = {
                    id, name: id, updatedAt: new Date().toISOString()
                  }
                  const wrapPlain = { __meta: meta, data: parsed }
                  await fsp.writeFile(target, JSON.stringify(wrapPlain, null, 2), 'utf8')
                  res.setHeader('Content-Type', 'application/json')
                  res.end(JSON.stringify({ ok:true, id, name: id, path: target }))
                  return
                }
              } catch (e) {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ ok:false, error:'invalid_json', message:String(e) }))
                return
              }
            }

            if (req.method === 'DELETE') {
              if (id === 'legacy') {
                // Legacy nicht löschen
                res.statusCode = 405
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ ok:false, error:'cannot_delete_legacy' }))
                return
              }
              if (fs.existsSync(target)) await fsp.rm(target)
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok:true, id }))
              return
            }

            res.statusCode = 405
            res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS')
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
    base: '/cv-builder/',
})
