import { DurableObject } from 'cloudflare:workers';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

const token = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 28);
};

const roomCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, value => alphabet[value % alphabet.length]).join('');
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'letsworship-sync' });
    }

    if (request.method === 'POST' && url.pathname === '/api/rooms') {
      const code = roomCode();
      const hostToken = token();
      const joinToken = token();
      const id = env.ROOMS.idFromName(code);
      const stub = env.ROOMS.get(id);
      const initialized = await stub.fetch('https://room.internal/init', {
        method: 'POST',
        body: JSON.stringify({ code, hostToken, joinToken, expiresAt: Date.now() + 12 * 60 * 60 * 1000 })
      });
      if (!initialized.ok) return json({ error: 'Room initialization failed.' }, 500);
      return json({ code, hostToken, joinToken, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
    }

    const joinMatch = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})\/join$/);
    if (joinMatch && request.method === 'POST') {
      const id = env.ROOMS.idFromName(joinMatch[1]);
      const response = await env.ROOMS.get(id).fetch('https://room.internal/join-token');
      if (!response.ok) return json({ error: response.status === 410 ? 'Room expired.' : 'Room not found.' }, response.status);
      return json(await response.json());
    }

    const match = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})\/websocket$/);
    if (match && request.headers.get('Upgrade') === 'websocket') {
      const id = env.ROOMS.idFromName(match[1]);
      return env.ROOMS.get(id).fetch(request);
    }

    return json({ error: 'Not found.' }, 404);
  }
};

export class SyncRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/init' && request.method === 'POST') {
      if (await this.ctx.storage.get('config')) return new Response(null, { status: 204 });
      const config = await request.json();
      await this.ctx.storage.put('config', { ...config, createdAt: Date.now() });
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/join-token' && request.method === 'GET') {
      const config = await this.ctx.storage.get('config');
      if (!config) return new Response(null, { status: 404 });
      if (Date.now() > config.expiresAt) return new Response(null, { status: 410 });
      return new Response(JSON.stringify({ code: config.code, joinToken: config.joinToken, expiresAt: config.expiresAt }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Upgrade required', { status: 426 });
    const config = await this.ctx.storage.get('config');
    if (!config) return new Response('Room not found', { status: 404 });
    if (Date.now() > config.expiresAt) return new Response('Room expired', { status: 410 });

    const supplied = url.searchParams.get('token') || '';
    const role = supplied === config.hostToken ? 'host' : supplied === config.joinToken ? 'follower' : '';
    if (!role) return new Response('Invalid room token', { status: 403 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const deviceId = (url.searchParams.get('device') || crypto.randomUUID()).slice(0, 80);
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, deviceId, joinedAt: Date.now() });
    server.send(JSON.stringify({ type: 'WELCOME', role, room: config.code, serverTime: Date.now() }));

    const state = await this.ctx.storage.get('state');
    if (role === 'follower' && state) server.send(JSON.stringify({ type: 'STATE', payload: state, serverTime: Date.now() }));
    this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let message;
    try { message = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); }
    catch (_) { return; }
    const attachment = ws.deserializeAttachment() || {};

    if (message.type === 'PING') {
      ws.send(JSON.stringify({ type: 'PONG', clientTime: message.clientTime, serverTime: Date.now() }));
      return;
    }
    if (message.type === 'REQUEST_STATE') {
      const state = await this.ctx.storage.get('state');
      if (state) ws.send(JSON.stringify({ type: 'STATE', payload: state, serverTime: Date.now() }));
      return;
    }
    if (attachment.role !== 'host') return;

    if (message.type === 'STATE') {
      await this.ctx.storage.put('state', message.payload);
      this.broadcast({ type: 'STATE', payload: message.payload, serverTime: Date.now() }, ws);
    } else if (message.type === 'STORE_STATE') {
      await this.ctx.storage.put('state', message.payload);
    } else if (message.type === 'EVENT') {
      this.broadcast({ type: 'EVENT', payload: message.payload, serverTime: Date.now() }, ws);
    }
  }

  webSocketClose(ws, code, reason) {
    ws.close(code, reason);
    this.broadcastPresence();
  }

  webSocketError() {
    this.broadcastPresence();
  }

  broadcast(message, except = null) {
    const encoded = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== except && socket.readyState === WebSocket.OPEN) socket.send(encoded);
    }
  }

  broadcastPresence() {
    const sockets = this.ctx.getWebSockets();
    const roles = sockets.map(socket => (socket.deserializeAttachment() || {}).role);
    this.broadcast({
      type: 'PRESENCE',
      devices: sockets.length,
      hostOnline: roles.includes('host'),
      followers: roles.filter(role => role === 'follower').length
    });
  }
}
