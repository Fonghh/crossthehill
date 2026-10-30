// PeerJS (WebRTC) transport. The host's browser is the server; everyone else connects
// to it in a star. Signalling defaults to the free PeerJS cloud; TURN credentials come
// from our Cloudflare Worker when VITE_TURN_ENDPOINT is set.

import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import { GAME } from '../config/game';
import type { ClientMsg, HostMsg } from './protocol';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomRoomCode(): string {
  let s = '';
  for (let i = 0; i < GAME.roomCodeLength; i++) s += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  return s;
}

export function normalizeRoomCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, GAME.roomCodeLength);
}

async function iceServers(): Promise<RTCIceServer[]> {
  const fallback: RTCIceServer[] = [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
  ];
  const endpoint = import.meta.env.VITE_TURN_ENDPOINT as string | undefined;
  if (!endpoint) return fallback;
  try {
    const res = await fetch(endpoint, { method: 'POST' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const list = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
    return [...fallback, ...list.filter(Boolean)];
  } catch (e) {
    console.warn('TURN credentials unavailable, using STUN only', e);
    return fallback;
  }
}

async function peerOptions(): Promise<PeerOptions> {
  const env = import.meta.env;
  const opts: PeerOptions = { config: { iceServers: await iceServers() }, debug: 1 };
  if (env.VITE_PEER_HOST) {
    opts.host = env.VITE_PEER_HOST;
    opts.port = Number(env.VITE_PEER_PORT ?? 443);
    opts.path = env.VITE_PEER_PATH ?? '/';
    opts.secure = (env.VITE_PEER_SECURE ?? 'true') !== 'false';
  }
  return opts;
}

function openPeer(id: string | undefined, opts: PeerOptions): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, opts) : new Peer(opts);
    const timer = setTimeout(() => { peer.destroy(); reject(new Error('timeout')); }, 12000);
    peer.once('open', () => { clearTimeout(timer); resolve(peer); });
    peer.once('error', (err) => { clearTimeout(timer); peer.destroy(); reject(err); });
  });
}

export class HostNet {
  conns = new Map<string, DataConnection>();
  onMessage: (id: string, msg: ClientMsg) => void = () => {};
  onLeave: (id: string) => void = () => {};
  private nextId = 1;

  private constructor(public peer: Peer, public code: string) {
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('disconnected', () => peer.reconnect());
  }

  static async create(): Promise<HostNet> {
    const opts = await peerOptions();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomRoomCode();
      try {
        const peer = await openPeer(GAME.peerIdPrefix + code, opts);
        return new HostNet(peer, code);
      } catch (e) {
        if ((e as { type?: string }).type !== 'unavailable-id') throw e;
      }
    }
    throw new Error('no free room code');
  }

  private accept(conn: DataConnection) {
    const id = 'p' + this.nextId++;
    conn.on('open', () => this.conns.set(id, conn));
    conn.on('data', (d) => this.onMessage(id, d as ClientMsg));
    const gone = () => {
      if (this.conns.delete(id)) this.onLeave(id);
    };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  send(id: string, msg: HostMsg) {
    const c = this.conns.get(id);
    if (c?.open) c.send(msg);
  }

  broadcast(msg: HostMsg) {
    for (const c of this.conns.values()) if (c.open) c.send(msg);
  }

  kick(id: string) {
    this.conns.get(id)?.close();
    this.conns.delete(id);
  }

  get count() {
    return this.conns.size;
  }

  destroy() {
    this.peer.destroy();
  }
}

export class ClientNet {
  onMessage: (msg: HostMsg) => void = () => {};
  onClose: () => void = () => {};
  private constructor(public peer: Peer, public conn: DataConnection) {
    conn.on('data', (d) => this.onMessage(d as HostMsg));
    conn.on('close', () => this.onClose());
    conn.on('error', () => this.onClose());
    peer.on('disconnected', () => peer.reconnect());
  }

  static async join(code: string): Promise<ClientNet> {
    const opts = await peerOptions();
    const peer = await openPeer(undefined, opts);
    const conn = peer.connect(GAME.peerIdPrefix + code, { reliable: true, serialization: 'json' });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 15000);
      conn.once('open', () => { clearTimeout(timer); resolve(); });
      peer.once('error', (err) => { clearTimeout(timer); reject(err); });
    });
    return new ClientNet(peer, conn);
  }

  send(msg: ClientMsg) {
    if (this.conn.open) this.conn.send(msg);
  }

  destroy() {
    this.peer.destroy();
  }
}
