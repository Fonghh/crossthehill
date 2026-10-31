// PeerJS (WebRTC) transport. The host's browser is the server; everyone else connects
// to it in a star. Signalling defaults to the free PeerJS cloud; TURN credentials come
// from the Cloudflare Pages Function (functions/api/turn.js) when deployed there.

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
  // Production default: the Cloudflare Pages Function in functions/api/turn.js.
  const endpoint = (import.meta.env.VITE_TURN_ENDPOINT as string | undefined) ?? (import.meta.env.PROD ? './api/turn' : undefined);
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

/**
 * Peer id of a room's host. The player who opened the room uses the bare room id;
 * a player who takes over after a host drop uses room id + their player id, so the
 * new host never has to wait for the signalling server to free the old id.
 */
export function roomPeerId(code: string, hostPlayerId = 'host'): string {
  return GAME.peerIdPrefix + code + (hostPlayerId === 'host' ? '' : '-' + hostPlayerId);
}

interface Link { conn: DataConnection; ref: { id: string }; lastSeen: number }

/** WebRTC can take tens of seconds to report a vanished peer; silence this long = gone. */
const CLIENT_SILENCE_MS = 5000;

export class HostNet {
  private links = new Map<string, Link>();
  private peers: Peer[] = [];
  onMessage: (id: string, msg: ClientMsg) => void = () => {};
  onLeave: (id: string) => void = () => {};
  private nextId = 1;
  private destroyed = false;

  private watchdog: ReturnType<typeof setInterval>;

  private constructor(peer: Peer, public code: string) {
    this.listen(peer);
    // Clients send input ~30×/s, so a silent link is a dead one.
    this.watchdog = setInterval(() => {
      const now = performance.now();
      for (const [id, link] of this.links) {
        if (now - link.lastSeen > CLIENT_SILENCE_MS) {
          this.links.delete(id);
          link.conn.close();
          this.onLeave(id);
        }
      }
    }, 1000);
  }

  private listen(peer: Peer) {
    this.peers.push(peer);
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('disconnected', () => { if (!this.destroyed) peer.reconnect(); });
  }

  static async create(): Promise<HostNet> {
    const opts = await peerOptions();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomRoomCode();
      try {
        const peer = await openPeer(roomPeerId(code), opts);
        return new HostNet(peer, code);
      } catch (e) {
        if ((e as { type?: string }).type !== 'unavailable-id') throw e;
      }
    }
    throw new Error('no free room code');
  }

  /**
   * Become host of an existing room after the previous host dropped. Listens on our own
   * takeover id right away, and keeps trying to claim the bare room id (freed by the
   * signalling server a while after the old host vanished) so invite links work again.
   */
  static async takeOver(code: string, selfId: string, firstFreeId: number): Promise<HostNet> {
    const opts = await peerOptions();
    const peer = await openPeer(roomPeerId(code, selfId), opts);
    const net = new HostNet(peer, code);
    net.nextId = firstFreeId;
    void net.claimRoomId(opts);
    return net;
  }

  private async claimRoomId(opts: PeerOptions) {
    for (let i = 0; i < 40 && !this.destroyed; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const p = await openPeer(roomPeerId(this.code), opts);
        if (this.destroyed) { p.destroy(); return; }
        this.listen(p);
        return;
      } catch { /* still held by the old host: retry */ }
    }
  }

  private accept(conn: DataConnection) {
    const ref = { id: 'p' + this.nextId++ };
    const link: Link = { conn, ref, lastSeen: performance.now() };
    conn.on('open', () => { link.lastSeen = performance.now(); this.links.set(ref.id, link); });
    conn.on('data', (d) => {
      link.lastSeen = performance.now();
      if (this.links.get(ref.id) === link) this.onMessage(ref.id, d as ClientMsg);
    });
    const gone = () => {
      if (this.links.get(ref.id) === link) { this.links.delete(ref.id); this.onLeave(ref.id); }
    };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  /** A returning player reclaims their old id (and car). */
  rename(from: string, to: string) {
    const link = this.links.get(from);
    if (!link) return;
    this.links.get(to)?.conn.close();
    this.links.delete(from);
    link.ref.id = to;
    this.links.set(to, link);
  }

  send(id: string, msg: HostMsg) {
    const c = this.links.get(id)?.conn;
    if (c?.open) c.send(msg);
  }

  broadcast(msg: HostMsg) {
    for (const { conn } of this.links.values()) if (conn.open) conn.send(msg);
  }

  kick(id: string) {
    this.links.get(id)?.conn.close();
    this.links.delete(id);
  }

  get count() {
    return this.links.size;
  }

  destroy() {
    this.destroyed = true;
    clearInterval(this.watchdog);
    for (const p of this.peers) p.destroy();
  }
}

export class ClientNet {
  onMessage: (msg: HostMsg) => void = () => {};
  onClose: () => void = () => {};
  private detached = false;

  private constructor(public peer: Peer, public conn: DataConnection, public hostPeerId: string) {
    conn.on('data', (d) => { if (!this.detached) this.onMessage(d as HostMsg); });
    const closed = () => { if (!this.detached) { this.detached = true; this.onClose(); } };
    conn.on('close', closed);
    conn.on('error', closed);
  }

  /** Our own (randomly named) peer, reusable across host changes. */
  static async openPeer(): Promise<Peer> {
    const peer = await openPeer(undefined, await peerOptions());
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    return peer;
  }

  /** Try each host peer id in order; resolves with the first that answers. */
  static async connect(peer: Peer, hostIds: string[], timeoutMs = 8000): Promise<ClientNet> {
    let lastErr: unknown = new Error('peer-unavailable');
    for (const id of hostIds) {
      try {
        const conn = peer.connect(id, { reliable: true, serialization: 'json' });
        await new Promise<void>((resolve, reject) => {
          const done = (fn: () => void) => { clearTimeout(timer); peer.off('error', onErr); fn(); };
          const onErr = (err: { type?: string; message?: string }) => {
            // peer-unavailable errors name the id they were about
            if (err.type !== 'peer-unavailable' || String(err.message ?? '').includes(id)) done(() => reject(err));
          };
          const timer = setTimeout(() => done(() => reject(new Error('timeout'))), timeoutMs);
          conn.once('open', () => done(resolve));
          peer.on('error', onErr);
        });
        return new ClientNet(peer, conn, id);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }

  static async join(code: string): Promise<ClientNet> {
    const peer = await ClientNet.openPeer();
    try {
      return await ClientNet.connect(peer, [roomPeerId(code)], 15000);
    } catch (e) {
      peer.destroy();
      throw e;
    }
  }

  send(msg: ClientMsg) {
    if (this.conn.open) this.conn.send(msg);
  }

  /** Stop reporting events (we're switching hosts) without tearing down our peer. */
  detach() {
    this.detached = true;
    this.conn.close();
  }

  destroy() {
    this.detached = true;
    this.peer.destroy();
  }
}
