import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';

/*
 * A small WebSocket (RFC 6455) for the guest menu's tunnel (server/guest-tunnel.ts ↔ server/merkez/guest-tunnel.ts): binary
 * messages, ping/pong and close; no extensions, no text frames needed. Both ends are ours, so nothing else is implemented, but
 * the framing is the standard one: Caddy (and any HTTP proxy that knows WebSockets) passes it on without settings.
 *   server role: the client's frames must be masked (refused otherwise), ours are not.
 *   client role: our frames are masked with a fresh random key each, the server's must not be.
 * A message larger than `maxMessage` closes the connection (1009): the other side is not trusted to stay small.
 */
export const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const wsAccept = (key: string) => createHash('sha1').update(key + WS_GUID).digest('base64');
export const OPCODE = { continuation: 0, text: 1, binary: 2, close: 8, ping: 9, pong: 10 } as const;

export function encodeFrame(opcode: number, payload: Buffer, mask: boolean): Buffer {
  const length = payload.length, extra = length < 126 ? 0 : length < 65536 ? 2 : 8;
  const out = Buffer.allocUnsafe(2 + extra + (mask ? 4 : 0) + length);
  out[0] = 0x80 | opcode;
  let offset = 2;
  if (length < 126) out[1] = length;
  else if (length < 65536) { out[1] = 126; out.writeUInt16BE(length, 2); offset = 4; }
  else { out[1] = 127; out.writeBigUInt64BE(BigInt(length), 2); offset = 10; }
  if (!mask) { payload.copy(out, offset); return out; }
  out[1] |= 0x80;
  const key = randomBytes(4); key.copy(out, offset); offset += 4;
  for (let i = 0; i < length; i++) out[offset + i] = payload[i] ^ key[i & 3];
  return out;
}

export type WsRole = 'server' | 'client';
/**
 * One open WebSocket on a socket that has already been upgraded (the 101 answer sent or read). Events: 'message' (Buffer),
 * 'pong', 'close' (code). `send` returns false when the socket's buffer is full: wait for 'drain' on `socket`.
 */
export class WsSocket extends EventEmitter {
  private buffer: Buffer = Buffer.alloc(0);
  private parts: Buffer[] = []; private partsSize = 0; private partsOpcode = 0;
  closed = false;
  constructor(readonly socket: Duplex, private role: WsRole, private maxMessage = 16 * 1024 * 1024, head?: Buffer) {
    super();
    (socket as { setNoDelay?: (on: boolean) => void }).setNoDelay?.(true);
    socket.on('data', (chunk: Buffer) => this.read(chunk));
    // An HTTP server's sockets stay half-open after the other side ends (allowHalfOpen): ours is closed too, or it would hold
    // the server's close() for ever.
    socket.on('close', () => this.finish(1006));
    socket.on('error', () => { socket.destroy(); this.finish(1006); });
    socket.on('end', () => { socket.destroy(); this.finish(1006); });
    if (head?.length) this.read(head);
  }
  /** Bytes waiting in the socket's own buffer (back-pressure). */
  get buffered() { return (this.socket as { writableLength?: number }).writableLength ?? 0; }
  send(data: Buffer) { return this.write(OPCODE.binary, data); }
  ping(data = Buffer.alloc(0)) { return this.write(OPCODE.ping, data); }
  close(code = 1000, reason = '') {
    if (this.closed) return;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason)); body.writeUInt16BE(code, 0); body.write(reason, 2);
    this.write(OPCODE.close, body);
    this.socket.end();
    // The close frame goes out first; a peer that never closes its side is cut off a moment later.
    setTimeout(() => this.socket.destroy(), 1000).unref();
    this.finish(code);
  }
  /** Drops the connection at once (a dead peer, a protocol error). */
  destroy(code = 1006) { this.socket.destroy(); this.finish(code); }
  private write(opcode: number, payload: Buffer) {
    if (this.closed || this.socket.destroyed) return false;
    try { return this.socket.write(encodeFrame(opcode, payload, this.role === 'client')); } catch { this.destroy(); return false; }
  }
  private finish(code: number) {
    if (this.closed) return;
    this.closed = true; this.buffer = Buffer.alloc(0); this.parts = [];
    this.emit('close', code);
  }
  private fail(code: number) { this.close(code); this.socket.destroy(); }
  private read(chunk: Buffer) {
    if (this.closed) return;
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const b = this.buffer;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, rsv = b[0] & 0x70, opcode = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      let length = b[1] & 0x7f, offset = 2;
      if (rsv) return this.fail(1002);
      // The client must mask, the server must not (RFC 6455 5.1).
      if (masked !== (this.role === 'server')) return this.fail(1002);
      if (length === 126) { if (b.length < 4) return; length = b.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (b.length < 10) return; const big = b.readBigUInt64BE(2); if (big > BigInt(this.maxMessage)) return this.fail(1009); length = Number(big); offset = 10; }
      if (length > this.maxMessage) return this.fail(1009);
      const keyAt = offset; if (masked) offset += 4;
      if (b.length < offset + length) return;
      let payload = b.subarray(offset, offset + length);
      if (masked) { const key = b.subarray(keyAt, keyAt + 4), out = Buffer.allocUnsafe(length); for (let i = 0; i < length; i++) out[i] = payload[i] ^ key[i & 3]; payload = out; }
      this.buffer = b.subarray(offset + length);
      if (opcode >= 8) {
        // Control frames: never fragmented, at most 125 bytes.
        if (!fin || length > 125) return this.fail(1002);
        if (opcode === OPCODE.ping) { this.write(OPCODE.pong, Buffer.from(payload)); this.emit('ping'); }
        else if (opcode === OPCODE.pong) this.emit('pong');
        else if (opcode === OPCODE.close) { const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005; this.close(code === 1005 ? 1000 : code); return; }
        else return this.fail(1002);
        continue;
      }
      if (opcode === OPCODE.continuation) { if (!this.partsOpcode) return this.fail(1002); }
      else if (opcode === OPCODE.binary || opcode === OPCODE.text) { if (this.partsOpcode) return this.fail(1002); this.partsOpcode = opcode; }
      else return this.fail(1002);
      this.partsSize += payload.length;
      if (this.partsSize > this.maxMessage) return this.fail(1009);
      this.parts.push(Buffer.from(payload));
      if (fin) {
        const message = this.parts.length === 1 ? this.parts[0] : Buffer.concat(this.parts, this.partsSize);
        this.parts = []; this.partsSize = 0; this.partsOpcode = 0;
        this.emit('message', message);
        if (this.closed) return;
      }
    }
  }
}
