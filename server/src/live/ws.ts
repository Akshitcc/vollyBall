/**
 * Live updates over WebSocket at /live.
 *   client -> {type:'auth', token}            server -> {type:'ready', uid}
 *   client -> {type:'sub'|'unsub', topic}     server -> {type:'doc'|'invalidate'|'deleted', topic, data?}
 * `match:<id>` carries the full match (live scoreboard); other topics tell the
 * client to refetch over HTTP (their payload depends on who is asking).
 */
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { TokenVerifier } from '../auth/verifier';
import type { LiveBus, LiveMessage } from './bus';

const TOPIC_RE = /^(matches|teams|challenges|tournaments|courts|(match|photos|team|profile|tournament):[A-Za-z0-9_:.-]{1,140})$/;
const MAX_TOPICS = 200;

export function attachLive(server: Server, bus: LiveBus, verifier: TokenVerifier) {
  const wss = new WebSocketServer({ server, path: '/live', maxPayload: 16 * 1024 });
  const clients = new Map<WebSocket, { uid: string | null; topics: Set<string>; alive: boolean }>();

  const unsubscribe = bus.subscribe((m: LiveMessage) => {
    const payload = JSON.stringify(m);
    for (const [ws, c] of clients) if (c.uid && c.topics.has(m.topic) && ws.readyState === ws.OPEN) ws.send(payload);
  });

  wss.on('connection', (ws) => {
    const c = { uid: null as string | null, topics: new Set<string>(), alive: true };
    clients.set(ws, c);
    const authTimer = setTimeout(() => !c.uid && ws.close(4401, 'auth timeout'), 10_000);
    ws.on('pong', () => (c.alive = true));
    ws.on('close', () => {
      clearTimeout(authTimer);
      clients.delete(ws);
    });
    ws.on('message', async (raw) => {
      let msg: { type?: string; token?: string; topic?: string };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return ws.close(4400, 'bad message');
      }
      if (msg.type === 'auth' && typeof msg.token === 'string') {
        try {
          const id = await verifier.verify(msg.token);
          c.uid = id.uid;
          ws.send(JSON.stringify({ type: 'ready', uid: id.uid }));
        } catch {
          ws.close(4401, 'invalid token');
        }
        return;
      }
      if (!c.uid) return ws.close(4401, 'not authenticated');
      if ((msg.type === 'sub' || msg.type === 'unsub') && typeof msg.topic === 'string' && TOPIC_RE.test(msg.topic)) {
        if (msg.type === 'sub' && c.topics.size < MAX_TOPICS) c.topics.add(msg.topic);
        if (msg.type === 'unsub') c.topics.delete(msg.topic);
      }
    });
  });

  const ping = setInterval(() => {
    for (const [ws, c] of clients) {
      if (!c.alive) {
        ws.terminate();
        continue;
      }
      c.alive = false;
      ws.ping();
    }
  }, 30_000);

  return {
    wss,
    close: () => {
      clearInterval(ping);
      unsubscribe();
      for (const ws of clients.keys()) ws.terminate();
      wss.close();
    },
  };
}
