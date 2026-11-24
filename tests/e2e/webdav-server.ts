// An in-memory WebDAV server, just enough for sync: PROPFIND (depth 0 and 1), MKCOL, GET, PUT
// with If-Match and If-None-Match against strong ETags, DELETE, and Basic authentication. It is
// not an HTTP server of its own: `handle` takes a request the fixture server routes to it by host,
// so the browser reaches it over https like any real server (the extension takes no other).
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface DavRequest {
  method: string
  path: string
  status: number
  ifMatch?: string
  ifNoneMatch?: string
}

interface Entry {
  body: Buffer
  etag: string
}

export class WebDavServer {
  /** Collections, as paths with a trailing slash. */
  readonly folders = new Set<string>(['/'])
  readonly files = new Map<string, Entry>()
  readonly log: DavRequest[] = []
  private counter = 0

  constructor(
    readonly username = 'sam',
    readonly password = 'dav-secret',
  ) {}

  /** A fresh, empty server: tests share one process, not one state. */
  reset(): void {
    this.folders.clear()
    this.folders.add('/')
    this.files.clear()
    this.log.length = 0
    this.counter = 0
  }

  /** Makes a folder (and its parents) and puts files in it. */
  seed(folder: string, files: Record<string, string | Buffer>): void {
    const parts = folder.split('/').filter(Boolean)
    let path = '/'
    for (const part of parts) {
      path += `${part}/`
      this.folders.add(path)
    }
    for (const [name, body] of Object.entries(files)) this.put(`${path}${name}`, body)
  }

  put(path: string, body: string | Buffer): string {
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body)
    const etag = `"${++this.counter}-${createHash('sha1').update(buffer).digest('hex').slice(0, 12)}"`
    this.files.set(path, { body: buffer, etag })
    return etag
  }

  text(path: string): string | undefined {
    return this.files.get(path)?.body.toString('utf8')
  }

  etag(path: string): string | undefined {
    return this.files.get(path)?.etag
  }

  /** The PUTs the server accepted, by path. */
  writes(path?: string): DavRequest[] {
    return this.log.filter(
      (r) => r.method === 'PUT' && r.status < 300 && (path === undefined || r.path === path),
    )
  }

  private authorised(req: IncomingMessage): boolean {
    const expected = Buffer.from(`${this.username}:${this.password}`).toString('base64')
    return req.headers.authorization === `Basic ${expected}`
  }

  private listing(path: string, depth: string): string {
    const entry = (href: string, props: string) =>
      `<D:response><D:href>${encodeURI(href)}</D:href><D:propstat><D:prop>${props}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`
    const folder = path.endsWith('/') ? path : `${path}/`
    const rows = [entry(folder, '<D:resourcetype><D:collection/></D:resourcetype>')]
    if (depth !== '0') {
      for (const [file, { body, etag }] of this.files) {
        if (file.startsWith(folder) && !file.slice(folder.length).includes('/')) {
          rows.push(
            entry(
              file,
              `<D:resourcetype/><D:getcontentlength>${body.length}</D:getcontentlength><D:getetag>${etag}</D:getetag>`,
            ),
          )
        }
      }
      for (const sub of this.folders) {
        if (
          sub !== folder &&
          sub.startsWith(folder) &&
          !sub.slice(folder.length, -1).includes('/')
        ) {
          rows.push(entry(sub, '<D:resourcetype><D:collection/></D:resourcetype>'))
        }
      }
    }
    return `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${rows.join('')}</D:multistatus>`
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET'
    const path = decodeURIComponent(new URL(req.url ?? '/', 'https://dav.invalid').pathname)
    const ifMatch = req.headers['if-match']
    const ifNoneMatch = req.headers['if-none-match']
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = Buffer.concat(chunks)

    const reply = (
      status: number,
      headers: Record<string, string> = {},
      text?: string | Buffer,
    ) => {
      this.log.push({ method, path, status, ifMatch, ifNoneMatch })
      res.writeHead(status, headers)
      res.end(text)
    }

    if (method === 'OPTIONS')
      return reply(200, { DAV: '1', Allow: 'OPTIONS, GET, PUT, DELETE, PROPFIND, MKCOL' })
    if (!this.authorised(req))
      return reply(401, { 'WWW-Authenticate': 'Basic realm="Kemlock e2e"' })

    const parent = path.slice(0, path.lastIndexOf('/', path.length - 2) + 1)

    switch (method) {
      case 'PROPFIND': {
        const isFolder = this.folders.has(path.endsWith('/') ? path : `${path}/`)
        if (!isFolder && !this.files.has(path)) return reply(404)
        const depth = String(req.headers.depth ?? '1')
        const xml = isFolder
          ? this.listing(path, depth)
          : `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>${encodeURI(path)}</D:href><D:propstat><D:prop><D:getetag>${this.files.get(path)!.etag}</D:getetag></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`
        return reply(207, { 'Content-Type': 'application/xml; charset=utf-8' }, xml)
      }
      case 'MKCOL': {
        const folder = path.endsWith('/') ? path : `${path}/`
        if (this.folders.has(folder) || this.files.has(path)) return reply(405)
        if (!this.folders.has(parent)) return reply(409)
        this.folders.add(folder)
        return reply(201)
      }
      case 'GET':
      case 'HEAD': {
        const file = this.files.get(path)
        if (!file) return reply(404)
        return reply(
          200,
          { 'Content-Type': 'application/octet-stream', ETag: file.etag },
          method === 'GET' ? file.body : undefined,
        )
      }
      case 'PUT': {
        if (!this.folders.has(parent)) return reply(409)
        const existing = this.files.get(path)
        if (ifNoneMatch === '*' && existing) return reply(412)
        if (ifMatch !== undefined && (!existing || existing.etag !== ifMatch)) return reply(412)
        const etag = this.put(path, body)
        return reply(existing ? 204 : 201, { ETag: etag })
      }
      case 'DELETE': {
        if (!this.files.delete(path)) return reply(404)
        return reply(204)
      }
      default:
        return reply(405)
    }
  }
}
