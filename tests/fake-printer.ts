import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

/**
 * A pretend ESC/POS network receipt printer for tests (nothing ever reaches a real printer): it answers the real-time
 * status questions (DLE EOT 1/2/4) with the bytes set in `status` (none = it never answers, like an old printer) and,
 * once a ticket arrived, with `after` (paper that ran out halfway, a cover opened).
 * Status bytes: 0x12 all fine; paper (n=4) 0x72 roll empty, 0x1e nearly empty; offline cause (n=2) 0x16 cover open,
 * 0x32 stopped for paper end; printer (n=1) 0x1a offline.
 */
export type FakeStatus = { printer?: number; offline?: number; paper?: number };
export async function fakePrinter(host = '127.0.0.1', port = 0) {
  const received: Buffer[] = [];
  const state: { status: FakeStatus | null; after?: FakeStatus | null } = { status: { printer: 0x12, offline: 0x12, paper: 0x12 } };
  const answer = (socket: Socket, n: number, printed: boolean) => {
    const st = printed && state.after !== undefined ? state.after : state.status;
    const b = !st ? undefined : n === 1 ? st.printer : n === 2 ? st.offline : st.paper;
    if (b !== undefined) socket.write(Buffer.from([b]));
  };
  const server: Server = createServer(socket => {
    let printed = false;
    socket.on('error', () => {});
    socket.on('data', (d: Buffer) => {
      received.push(d);
      for (let i = 0; i < d.length; i++) {
        if (d[i] === 0x10 && d[i + 1] === 0x04 && [1, 2, 4].includes(d[i + 2])) { answer(socket, d[i + 2], printed); i += 2; }
        else if (d[i] === 0x1b) printed = true;
      }
    });
  });
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(port, host, () => done()); });
  return {
    port: (server.address() as AddressInfo).port, state,
    bytes: () => Buffer.concat(received), clear: () => { received.length = 0; },
    close: () => new Promise<void>(done => server.close(() => done())),
  };
}
