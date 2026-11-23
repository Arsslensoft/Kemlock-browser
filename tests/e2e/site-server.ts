// One https server behind every name the tests use. The browser resolves them all to it
// (--host-resolver-rules), so a page is at https://orbit-cloud.com/signin with no port, and the
// extension sees the host a person would. It serves the pages in fixtures/pages for any host, takes
// the forms' posts (and remembers them, so a test can tell what the page was sent), and hands the
// WebDAV host to the in-memory WebDAV server.
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer, type Server } from 'node:https'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { selfSigned } from './cert'
import { allHosts, hosts } from './hosts'
import { WebDavServer } from './webdav-server'

const pagesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'pages')

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
}

/** The page names that exist, which are also their paths: /signin is signin.html. */
const pages = new Set([
  'signin',
  'signin-2step',
  'signup',
  'signup-maxlength',
  'change-password',
  'code',
  'boxes',
  'frame',
  'hidden',
  'controlled',
  'welcome',
  'qr',
])

/** Where a form's post goes next. */
const after: Record<string, string> = {
  '/session': '/welcome',
  '/session-2step': '/code',
  '/account': '/welcome',
  '/password': '/welcome',
  '/code': '/welcome',
}

export interface Post {
  host: string
  path: string
  body: Record<string, string>
}

export class SiteServer {
  readonly dav = new WebDavServer()
  readonly posts: Post[] = []
  private server?: Server
  port = 0

  async start(): Promise<void> {
    const { key, cert } = selfSigned(allHosts)
    this.server = createServer({ key, cert }, (req, res) => {
      void this.route(req, res).catch((error: unknown) => {
        res.writeHead(500)
        res.end(String(error))
      })
    })
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve))
    this.port = (this.server.address() as AddressInfo).port
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()))
    this.server?.closeAllConnections()
  }

  /**
   * The browser's flag: every name goes to this server, on the https port the address has, but the
   * real servers a run was pointed at (KEMLOCK_SERVER_URL, VAULTWARDEN_URL) and localhost.
   */
  resolverRules(exclude: string[] = []): string {
    const rules = [`MAP * 127.0.0.1:${this.port}`, 'EXCLUDE localhost']
    for (const host of exclude) rules.push(`EXCLUDE ${host}`)
    return rules.join(', ')
  }

  url(host: string, path = '/'): string {
    return `https://${host}${path}`
  }

  /** The posts a host took, newest last. */
  postsTo(host: string): Post[] {
    return this.posts.filter((p) => p.host === host)
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '')
    if (host === hosts.dav) return this.dav.handle(req, res)

    const url = new URL(req.url ?? '/', `https://${host}`)
    const path = url.pathname
    if (req.method === 'POST' && path in after) {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()))
      this.posts.push({ host, path, body })
      res.writeHead(303, { Location: after[path] })
      return void res.end()
    }
    const name =
      path === '/page.css' || path === '/qr.js'
        ? path.slice(1)
        : pages.has(path.slice(1))
          ? `${path.slice(1)}.html`
          : undefined
    if (req.method !== 'GET' || !name) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      return void res.end('Not found')
    }
    const ext = name.slice(name.lastIndexOf('.'))
    res.writeHead(200, {
      'Content-Type': types[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    res.end(await readFile(join(pagesDir, name)))
  }
}
