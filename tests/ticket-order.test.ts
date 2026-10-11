import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareTickets, dayTitle, listTime, ticketChip, ticketTimeline } from '../src/ticketOrder.js';
import type { Ticket } from '../server/license.js';
test('Destek chat: list times, day lines, grouping and the opened / closed / reopened lines', () => {
  const now = new Date(2026, 9, 4, 15, 0);
  const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString();
  assert.equal(listTime(at(4, 14, 5), now), '14:05');
  assert.equal(listTime(at(3, 23, 59), now), 'Dün');
  assert.equal(listTime(at(1, 9), now), '1 Eki');
  assert.equal(listTime(new Date(2025, 11, 30).toISOString(), now), '30 Ara 2025');
  assert.equal(dayTitle(at(4, 1), now), 'Bugün'); assert.equal(dayTitle(at(3, 1), now), 'Dün'); assert.equal(dayTitle(at(1, 1), now), '1 Ekim');
  const ticket: Ticket = { id: 't', tenantId: 'one', subject: 'Yazıcı', status: 'open', createdAt: at(1, 9), messages: [
    { id: 'a', source: 'business', text: 'Yazmıyor', at: at(1, 9) }, { id: 'b', source: 'business', text: 'Hiç', at: at(1, 9, 2) },
    { id: 'c', source: 'support', text: 'Baktık, kapatıyoruz', at: at(3, 10) }, { id: 'd', source: 'business', text: 'Yine oldu', at: at(4, 11) },
  ] };
  const lines = ticketTimeline(ticket, 'support', { businessName: 'Işık Kafe', events: [{ ticketId: 't', kind: 'closed', at: at(3, 10) }], now });
  assert.deepEqual(lines.map(l => l.kind === 'message' ? `${l.message.id}${l.mine ? '>' : '<'}${l.first ? 'F' : ''}${l.last ? 'L' : ''}` : l.kind === 'day' ? l.label : l.text.split(' · ')[0]),
    ['1 Ekim', 'Işık Kafe talebi açtı', 'a<F', 'b<L', 'Dün', 'c>FL', 'Talep kapatıldı', 'Bugün', 'Talep yeniden açıldı', 'd<FL']);
  // The café's side: no İşlem geçmişi there; a closed ticket closes at the Mola team's last answer.
  const closed = ticketTimeline({ ...ticket, status: 'closed', messages: ticket.messages.slice(0, 3) }, 'business', { now });
  assert.deepEqual(closed.filter(l => l.kind === 'system').map(l => (l as { text: string }).text.split(' · ')[0]), ['Talep açıldı', 'Mola ekibi talebi kapattı']);
  assert.equal(ticketChip(ticket).label, 'Yanıt bekleniyor');
  assert.equal(ticketChip({ ...ticket, messages: ticket.messages.slice(0, 3) }).label, 'Açık');
  assert.equal(ticketChip({ ...ticket, status: 'closed' }).label, 'Kapandı');
});
test('support priority orders longest waiting first and keeps answered or closed requests below', () => {
  const make = (id: string, at: string, source: 'business' | 'support', status: 'open' | 'closed' = 'open'): Ticket => ({ id, tenantId: 'one', subject: id, status, createdAt: '2026-01-01T00:00:00Z', messages: [{ id, source, at, text: 'test' }] });
  const tickets = [make('new', '2026-09-27T12:00:00Z', 'business'), make('closed', '2026-09-27T13:00:00Z', 'business', 'closed'), make('old', '2026-09-26T10:00:00Z', 'business'), make('answered', '2026-09-27T14:00:00Z', 'support')];
  assert.deepEqual([...tickets].sort((a,b) => compareTickets(a,b,'waiting')).map(t => t.id), ['old','new','answered','closed']);
  assert.deepEqual([...tickets].sort((a,b) => compareTickets(a,b,'recent')).map(t => t.id), ['answered','closed','new','old']);
  assert.equal(tickets[0].id, 'new');
  tickets[2].messages.push({ id: 'reminder', source: 'business', at: '2026-09-27T15:00:00Z', text: 'hatırlatma' });
  assert.equal([...tickets].sort((a,b) => compareTickets(a,b,'waiting'))[0].id, 'old');
});
