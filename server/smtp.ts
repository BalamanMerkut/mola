import { randomUUID } from 'node:crypto';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';

/*
 * A small SMTP client with Node's own net/tls, no package, shared by both servers:
 *   Mola Merkez   "E-posta bildirimleri" of the vendor (server/merkez/mail.ts: plain text, From "Mola Yönetim")
 *   Kafe          "E-posta raporları" of the café (server/email-reports.ts: HTML + text, sent from the café's own account)
 * One message at a time:
 *   security 'tls'       implicit TLS (smtp.gmail.com:465, the default)
 *   security 'starttls'  plain connection upgraded with STARTTLS (port 587); refused if the server does not offer it
 *   security 'none'      only for a relay on this computer (127.0.0.1), e.g. tests
 * AUTH PLAIN with the account and its app password. The password is never logged and never part of an error text.
 */
export class MailError extends Error {}
export type SmtpAccount = { host: string; port: number; security: 'tls' | 'starttls' | 'none'; user: string; password: string; from?: string };
/**
 * `to`: one or more addresses (each its own RCPT TO). `html`: sent as multipart/alternative with `text` as the fallback.
 * `fromName`: the display name ("Mola Yönetim", the business name); `encodeName: false` writes it as it is (Merkez's old header).
 */
export type SmtpMessage = { to: string | string[]; subject: string; text: string; html?: string; fromName?: string; encodeName?: boolean; ehlo?: string; attachments?: SmtpAttachment[] };
/** A file sent with the message (the printable report: PDF, else HTML). `filename`: plain ASCII, no quotes or line breaks. */
export type SmtpAttachment = { filename: string; contentType: string; content: Buffer };
type Conn = { socket: Socket | TLSSocket; read: () => Promise<{ code: number; text: string }> };
function wrap(socket: Socket | TLSSocket): Conn {
  let buffer = ''; const waiting: ((line: string) => void)[] = []; const lines: string[] = [];
  // Errors after connecting end the conversation through 'close' (the waiting read fails); never an unhandled crash.
  socket.on('error', () => {}); socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => { buffer += chunk; let i; while ((i = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, i).replace(/\r$/, ''); buffer = buffer.slice(i + 1); const w = waiting.shift(); if (w) w(line); else lines.push(line); } });
  const next = () => new Promise<string>((resolve, reject) => {
    const l = lines.shift(); if (l !== undefined) return resolve(l);
    const fail = () => reject(new MailError('E-posta sunucusu bağlantıyı kapattı.'));
    socket.once('close', fail); waiting.push(line => { socket.off('close', fail); resolve(line); });
  });
  // A reply may span lines ("250-…" … "250 …").
  const read = async () => { let text = ''; for (;;) { const line = await next(); text += line.slice(4) + '\n'; if (line[3] !== '-') return { code: Number(line.slice(0, 3)), text: text.trim() }; } };
  return { socket, read };
}
const open = (host: string, port: number, secure: boolean, timeoutMs: number) => new Promise<Socket | TLSSocket>((resolve, reject) => {
  const socket = secure ? tlsConnect({ host, port, servername: host }) : netConnect({ host, port });
  socket.setTimeout(timeoutMs, () => socket.destroy(new MailError('E-posta sunucusu yanıt vermedi (zaman aşımı).')));
  socket.once(secure ? 'secureConnect' : 'connect', () => resolve(socket));
  socket.once('error', e => reject(e instanceof MailError ? e : new MailError(`E-posta sunucusuna bağlanılamadı (${(e as NodeJS.ErrnoException).code ?? 'bağlantı hatası'}).`)));
});
/** "=?UTF-8?B?…?=" so Turkish letters in the subject (and a business name) arrive whole. */
const encodedWord = (s: string) => `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
const lines76 = (b64: string) => b64.replace(/.{1,76}/g, '$&\r\n');
/** No line breaks in a header value (a name typed in a form must not start a header of its own). */
const oneLine = (s: string) => s.replace(/[\r\n\u0000]+/g, ' ').trim();
const loopback = (host: string) => ['127.0.0.1', 'localhost', '::1'].includes(host.toLowerCase());
export function validSettings(s: Pick<SmtpAccount, 'host' | 'port' | 'security'>) {
  if (s.security === 'none' && !loopback(s.host)) throw new MailError('Şifresiz bağlantı yalnız bu bilgisayardaki bir e-posta aktarıcısı için kullanılabilir.');
}
const ADDRESS = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,}$/i;
export const validAddress = (a: string) => ADDRESS.test(a);
/** Never "From: <>": the "Gönderen adresi", else the SMTP user when it is an e-mail address; '' when neither. */
export const senderOf = (s: Pick<SmtpAccount, 'from' | 'user'>) => s.from && validAddress(s.from) ? s.from : validAddress(s.user) ? s.user : '';
export const NO_SENDER = 'Gönderen adresi yok: SMTP kullanıcısı bir e-posta adresi değil. E-posta ayarlarında “Gönderen adresi”ni yazıp kaydedin.';
/** The text kept for the screen after a failure: never the password, never what the server echoed back. */
export const safeError = (e: unknown) => e instanceof MailError ? e.message : 'E-posta gönderilemedi.';

/** The message as it goes after DATA (headers + body), CRLF lines. Exported for tests. */
export function composeMessage(from: string, m: SmtpMessage, at = new Date()) {
  const to = (Array.isArray(m.to) ? m.to : [m.to]).map(a => `<${a}>`).join(', ');
  const name = oneLine(m.fromName ?? 'Mola'), host = from.split('@')[1] || 'mola.local';
  const head = [`From: ${m.encodeName === false ? name : encodedWord(name)} <${from}>`, `To: ${to}`, `Subject: ${encodedWord(oneLine(m.subject))}`, `Date: ${at.toUTCString()}`, `Message-ID: <${randomUUID()}@${host}>`, 'MIME-Version: 1.0'];
  const part = (type: string, body: string) => [`Content-Type: ${type}; charset=utf-8`, 'Content-Transfer-Encoding: base64', '', lines76(Buffer.from(body, 'utf8').toString('base64'))];
  // Without attachments the message is exactly as it always was (Merkez's plain text; the reports' text + HTML).
  const body = (): string[] => {
    if (!m.html) return part('text/plain', m.text);
    const boundary = `mola-${randomUUID()}`;
    return [`Content-Type: multipart/alternative; boundary="${boundary}"`, '', `--${boundary}`, ...part('text/plain', m.text), `--${boundary}`, ...part('text/html', m.html), `--${boundary}--`, ''];
  };
  if (!m.attachments?.length) return [...head, ...body()].join('\r\n');
  const mixed = `mola-${randomUUID()}`;
  const file = (a: SmtpAttachment) => { const name = safeFilename(a.filename), type = oneLine(a.contentType).replace(/[^\w.+/-]/g, '') || 'application/octet-stream'; return [`--${mixed}`, `Content-Type: ${type}; name="${name}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${name}"`, '', lines76(a.content.toString('base64'))]; };
  return [...head, `Content-Type: multipart/mixed; boundary="${mixed}"`, '', `--${mixed}`, ...body(), ...m.attachments.flatMap(file), `--${mixed}--`, ''].join('\r\n');
}
/** "Gün sonu 5 Ekim.pdf" → "Gun-sonu-5-Ekim.pdf": ASCII only, so every mail program shows the same name. */
export const safeFilename = (s: string) => s.normalize('NFKD').replace(/[ıİ]/g, c => c === 'ı' ? 'i' : 'I').replace(/[^\x20-\x7e]/g, '').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 100) || 'ek';

export async function sendSmtp(s: SmtpAccount, m: SmtpMessage, timeoutMs = 20_000) {
  validSettings(s);
  // Checked before connecting: no sender, nothing is sent (the server would otherwise get "MAIL FROM:<>").
  const from = senderOf(s);
  if (!from) throw new MailError(NO_SENDER);
  const recipients = Array.isArray(m.to) ? m.to : [m.to];
  if (!recipients.length || !recipients.every(validAddress)) throw new MailError('Alıcı e-posta adresi geçersiz.');
  let conn = wrap(await open(s.host, s.port, s.security === 'tls', timeoutMs));
  const expect = async (codes: number[], what: string) => { const r = await conn.read(); if (!codes.includes(r.code)) throw new MailError(`E-posta sunucusu ${what} adımında reddetti (${r.code}).`); return r; };
  const say = (line: string) => conn.socket.write(line + '\r\n');
  const ehlo = m.ehlo ?? 'mola';
  try {
    await expect([220], 'karşılama');
    say(`EHLO ${ehlo}`); let hello = await expect([250], 'EHLO');
    if (s.security === 'starttls') {
      if (!/STARTTLS/i.test(hello.text)) throw new MailError('E-posta sunucusu STARTTLS desteklemiyor; 465 (TLS) deneyin.');
      say('STARTTLS'); await expect([220], 'STARTTLS');
      const upgraded = await new Promise<TLSSocket>((resolve, reject) => { const t = tlsConnect({ socket: conn.socket as Socket, servername: s.host }); t.once('secureConnect', () => resolve(t)); t.once('error', () => reject(new MailError('Güvenli bağlantı kurulamadı.'))); });
      conn = wrap(upgraded); say(`EHLO ${ehlo}`); hello = await expect([250], 'EHLO');
    }
    if (s.user) {
      say(`AUTH PLAIN ${Buffer.from(`\0${s.user}\0${s.password}`, 'utf8').toString('base64')}`);
      const auth = await conn.read();
      if (auth.code !== 235) throw new MailError(auth.code === 535 ? 'E-posta kullanıcı adı veya uygulama şifresi kabul edilmedi.' : `E-posta sunucusu girişi reddetti (${auth.code}).`);
    }
    say(`MAIL FROM:<${from}>`); await expect([250], 'gönderen');
    for (const to of recipients) { say(`RCPT TO:<${to}>`); await expect([250, 251], 'alıcı'); }
    say('DATA'); await expect([354], 'DATA');
    conn.socket.write(composeMessage(from, m) + '\r\n.\r\n'); await expect([250], 'gönderim');
    say('QUIT');
  } finally { conn.socket.end(); conn.socket.destroy(); }
}
