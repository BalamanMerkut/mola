import { createHash, randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z } from 'zod';
import { DomainError } from '../packages/domain/engine.js';

export type FailureEvent = { event: 'request_failed'; requestId: string; method: string; route: string; status: number; code: string; elapsedMs: number; tenantId?: string; role?: string; fingerprint?: string; frames?: string[] };
// Code locations only ("at fn (server/app.ts:12:3)"): no message, values or absolute paths.
export function codeFrames(err: unknown) {
  if (!(err instanceof Error)) return [];
  return (err.stack ?? '').split('\n').slice(1).flatMap(raw => {
    if (/node_modules/.test(raw)) return [];
    const text = raw.trim().replace(/^at\s+/, ''), call = text.match(/^(.*?)\s*\((.*)\)$/);
    const where = (call ? call[2] : text).match(/[\\/]((?:server|packages)[\\/][^\\/]+(?:[\\/][^\\/]+)*:\d+:\d+)$/)?.[1].replace(/\\/g, '/');
    if (!where || !/^(server|packages)\/[\w./-]+:\d+:\d+$/.test(where)) return [];
    const name = call?.[1] && /^[\w$.<> [\]-]{1,80}$/.test(call[1]) ? call[1] : '';
    return [name ? `${name} (${where})` : where];
  }).slice(0, 8);
}
/** Field names people know, for "Alanları kontrol edin: kullanıcı adı." */
const FIELD_NAMES: Record<string, string> = { username: 'kullanıcı adı', password: 'şifre', currentPassword: 'mevcut şifre', name: 'ad', amount: 'tutar', description: 'açıklama', note: 'not', day: 'tarih', code: 'kod', email: 'e-posta', phone: 'telefon', people: 'kişi sayısı', time: 'saat' };
/**
 * A rejected form names what to fix: the rule written for the field (a Turkish message given to the schema), else the
 * field's name, else the plain "Alanları kontrol edin.". zod's own English texts never reach the screen.
 */
export function validationMessage(err: z.ZodError) {
  const first = err.issues[0];
  if (!first) return 'Alanları kontrol edin.';
  if (first.message && !/^(Invalid|Too (small|big)|Unrecognized|Expected|Required)\b/i.test(first.message) && /[a-zçğıöşü]/i.test(first.message)) return first.message;
  const names = [...new Set(err.issues.map(i => FIELD_NAMES[String(i.path.at(-1) ?? '')]).filter(Boolean))];
  return names.length ? `Alanları kontrol edin: ${names.join(', ')}.` : 'Alanları kontrol edin.';
}
export function requestDiagnostics(log: (event: FailureEvent) => void = event => console.error(JSON.stringify(event))) {
  const begin: RequestHandler = (_req, res, next) => {
    res.locals.requestId = randomUUID(); res.locals.requestStarted = performance.now();
    res.set('X-Request-Id', res.locals.requestId); next();
  };
  const error: ErrorRequestHandler = (err: unknown, req, res, next) => {
    if (res.headersSent) return next(err);
    const requestId = res.locals.requestId ?? randomUUID();
    const bodyError = err as { type?: string } | null;
    let status = 500, code = 'SERVER_ERROR', message = 'İşlem tamamlanamadı. Aynı işlemi tekrar deneyebilirsiniz.';
    let fields: string[] | undefined;
    if (err instanceof z.ZodError) { status = 400; code = 'VALIDATION_ERROR'; message = validationMessage(err); fields = err.issues.map(i => i.path.join('.')); }
    else if (err instanceof DomainError) { status = err.status; code = err.code; message = err.message; }
    else if (bodyError?.type === 'entity.parse.failed') { status = 400; code = 'INVALID_JSON'; message = 'İstek biçimi geçersiz.'; }
    else if (bodyError?.type === 'entity.too.large') { status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Gönderilen içerik çok büyük. İçeriği küçültüp tekrar deneyin.'; }
    // Library client errors (a missing file, a bad path) stay client errors: they are not server faults and are not logged.
    else if (typeof (err as { status?: unknown } | null)?.status === 'number' && (err as { status: number }).status >= 400 && (err as { status: number }).status < 500) { status = (err as { status: number }).status; code = status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST'; message = status === 404 ? 'Bulunamadı.' : 'İstek geçersiz.'; }
    if (status >= 500) {
      // Route pattern only: never URL/query, body, headers, error message or stack.
      const route = typeof req.route?.path === 'string' ? req.route.path : 'unmatched';
      const frames = codeFrames(err);
      const fingerprint = createHash('sha256').update(code + route + frames.join('\n')).digest('hex').slice(0, 24);
      try { log({ ...(res.locals.diagnosticTenant ? { tenantId: res.locals.diagnosticTenant, role: res.locals.diagnosticRole } : {}), fingerprint, ...(frames.length ? { frames } : {}), event: 'request_failed', requestId, method: req.method, route, status, code, elapsedMs: Math.max(0, Math.round(performance.now() - (res.locals.requestStarted ?? performance.now()))) }); } catch { /* Logging must not change the HTTP result. */ }
    }
    res.status(status).json({ code, message, ...(fields ? { fields } : {}), requestId });
  };
  return { begin, error };
}
