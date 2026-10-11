/**
 * Launch prep: a tiny Redis client (RESP2 over TCP/TLS) for the shared rate-limit store – just enough
 * for INCR / PEXPIRE / PTTL / PING, with no new npm dependency. REDIS_URL = redis://[:password@]host:port[/db]
 * or rediss:// for TLS (Upstash, Railway, Render Key Value, ElastiCache with in-transit encryption).
 */
import net from 'node:net';
import tls from 'node:tls';

export type RedisReply = string | number | null | RedisReply[];

export class RedisError extends Error {}

/** Parses as many complete replies as the buffer holds; returns them and the unconsumed rest. */
export function parseReplies(buf: Buffer): { replies: (RedisReply | RedisError)[]; rest: Buffer } {
  const replies: (RedisReply | RedisError)[] = [];
  let pos = 0;
  const line = (from: number) => {
    const end = buf.indexOf('\r\n', from);
    return end < 0 ? null : { text: buf.toString('utf8', from + 1, end), next: end + 2 };
  };
  const one = (from: number): { v: RedisReply | RedisError; next: number } | null => {
    if (from >= buf.length) return null;
    const type = String.fromCharCode(buf[from]);
    const l = line(from);
    if (!l) return null;
    if (type === '+') return { v: l.text, next: l.next };
    if (type === '-') return { v: new RedisError(l.text), next: l.next };
    if (type === ':') return { v: Number(l.text), next: l.next };
    if (type === '$') {
      const n = Number(l.text);
      if (n < 0) return { v: null, next: l.next };
      if (buf.length < l.next + n + 2) return null;
      return { v: buf.toString('utf8', l.next, l.next + n), next: l.next + n + 2 };
    }
    if (type === '*') {
      const n = Number(l.text);
      if (n < 0) return { v: null, next: l.next };
      const arr: RedisReply[] = [];
      let p = l.next;
      for (let i = 0; i < n; i++) {
        const r = one(p);
        if (!r) return null;
        arr.push(r.v instanceof RedisError ? null : r.v);
        p = r.next;
      }
      return { v: arr, next: p };
    }
    throw new RedisError(`Unexpected reply type ${type}`);
  };
  for (;;) {
    const r = one(pos);
    if (!r) break;
    replies.push(r.v);
    pos = r.next;
  }
  return { replies, rest: buf.subarray(pos) };
}

export const encodeCommand = (args: (string | number)[]) =>
  `*${args.length}\r\n${args.map((a) => `$${Buffer.byteLength(String(a))}\r\n${a}\r\n`).join('')}`;

export class RedisClient {
  private sock: net.Socket | null = null;
  private ready: Promise<void> | null = null;
  private queue: { resolve: (v: RedisReply) => void; reject: (e: Error) => void }[] = [];
  private buf: Buffer = Buffer.alloc(0);
  constructor(
    private readonly url: string,
    private readonly timeoutMs = 2000,
  ) {
    const u = new URL(url);
    if (u.protocol !== 'redis:' && u.protocol !== 'rediss:') throw new Error('REDIS_URL must start with redis:// or rediss://');
  }

  private connect(): Promise<void> {
    if (this.ready) return this.ready;
    const u = new URL(this.url);
    const port = Number(u.port || 6379);
    this.ready = new Promise<void>((resolve, reject) => {
      const onError = (e: Error) => {
        this.fail(e);
        reject(e);
      };
      const s = u.protocol === 'rediss:' ? tls.connect({ host: u.hostname, port, servername: u.hostname }) : net.connect({ host: u.hostname, port });
      s.setTimeout(this.timeoutMs, () => s.destroy(new Error('Redis timeout')));
      s.once('error', onError);
      s.on('data', (d: Buffer) => this.onData(d));
      s.on('close', () => this.fail(new Error('Redis connection closed')));
      s.once(u.protocol === 'rediss:' ? 'secureConnect' : 'connect', async () => {
        s.setTimeout(0);
        this.sock = s;
        try {
          const pass = decodeURIComponent(u.password);
          if (pass) await this.raw(u.username ? ['AUTH', decodeURIComponent(u.username), pass] : ['AUTH', pass]);
          const db = u.pathname.replace(/^\//, '');
          if (db) await this.raw(['SELECT', db]);
          resolve();
        } catch (e) {
          onError(e as Error);
        }
      });
    });
    return this.ready;
  }

  private fail(e: Error) {
    this.sock?.destroy();
    this.sock = null;
    this.ready = null;
    this.buf = Buffer.alloc(0);
    const q = this.queue.splice(0);
    q.forEach((p) => p.reject(e));
  }

  private onData(d: Buffer) {
    this.buf = Buffer.concat([this.buf, d]);
    const { replies, rest } = parseReplies(this.buf);
    this.buf = rest;
    for (const r of replies) {
      const p = this.queue.shift();
      if (!p) continue;
      if (r instanceof RedisError) p.reject(r);
      else p.resolve(r);
    }
  }

  private raw(args: (string | number)[]): Promise<RedisReply> {
    return new Promise((resolve, reject) => {
      if (!this.sock) return reject(new Error('Redis not connected'));
      const timer = setTimeout(() => this.fail(new Error('Redis timeout')), this.timeoutMs);
      this.queue.push({
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      this.sock.write(encodeCommand(args));
    });
  }

  async command(args: (string | number)[]): Promise<RedisReply> {
    await this.connect();
    return this.raw(args);
  }

  async close() {
    const s = this.sock;
    this.sock = null;
    this.ready = null;
    if (s) await new Promise<void>((r) => s.end(() => r()));
  }
}
