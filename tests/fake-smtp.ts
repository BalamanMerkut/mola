import { createServer as createNet, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

/**
 * A tiny SMTP server on 127.0.0.1 for tests: records what arrives (sender, every RCPT, the DATA, the AUTH it got);
 * `password` decides AUTH (535 for anything else). `decode` gives the text of every base64 part of a message.
 */
export async function fakeSmtp(password: string) {
  const received: { from: string; to: string[]; data: string; auth: string }[] = [];
  const server = createNet((socket: Socket) => {
    let buffer = '', data: string | null = null, from = '', to: string[] = [], auth = '';
    socket.on('error', () => {}); socket.write('220 test ESMTP\r\n');
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      for (let i; (i = buffer.indexOf('\r\n')) >= 0;) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 2);
        if (data !== null) { if (line === '.') { received.push({ from, to, data, auth }); data = null; to = []; socket.write('250 OK\r\n'); } else data += line + '\n'; continue; }
        if (/^EHLO/.test(line)) socket.write('250-test\r\n250 AUTH PLAIN\r\n');
        else if (/^AUTH PLAIN /.test(line)) { auth = Buffer.from(line.slice(11), 'base64').toString('utf8'); socket.write(auth.split('\0')[2] === password ? '235 OK\r\n' : '535 no\r\n'); }
        else if (/^MAIL FROM:/.test(line)) { from = line; socket.write('250 OK\r\n'); }
        else if (/^RCPT TO:/.test(line)) { to.push(line.slice(8)); socket.write('250 OK\r\n'); }
        else if (line === 'DATA') { data = ''; socket.write('354 go\r\n'); }
        else if (line === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
        else socket.write('500 ?\r\n');
      }
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return { port: (server.address() as AddressInfo).port, received, close: () => new Promise<void>(r => { server.close(() => r()); }) };
}
/**
 * Every base64 part of a message, decoded: the body (text/plain, text/html; a plain message has one) first, then the
 * attachments with their `name` (`bytes` for a PDF). Tests that only want the body filter `!p.name`.
 */
export function decodeParts(data: string) {
  const parts: { type: string; text: string; name?: string; bytes: Buffer }[] = [];
  const blocks = data.split(/\n--[^\n]+\n?/);
  for (const block of blocks) {
    const type = /Content-Type: ([^;\n]+)/i.exec(block)?.[1]?.trim(), name = /filename="([^"]+)"/i.exec(block)?.[1];
    if (!type || (!/^text\//.test(type) && !name)) continue;
    const body = block.split('\n\n').slice(1).join('\n').replace(/\s/g, '');
    if (body) { const bytes = Buffer.from(body, 'base64'); parts.push({ type, text: bytes.toString('utf8'), ...(name ? { name } : {}), bytes }); }
  }
  return parts;
}
