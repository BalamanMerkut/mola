import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalEmail, normalPhone, showPhone, validEmail, validTaxNumber, validTckn, validVkn } from '../packages/domain/invoice.js';
import { applicationForm } from '../server/sync-protocol.js';

test('VKN: the official 10-digit check digit', () => {
  for (const v of ['1234567890', '1111111114', '6120069780', '9000068418']) assert.equal(validVkn(v), true, v);
  // Every other last digit is wrong.
  for (let d = 0; d < 10; d++) if (d !== 0) assert.equal(validVkn(`123456789${d}`), false);
  for (const v of ['123456789', '12345678901', '12345 67890', 'abcdefghij', '']) assert.equal(validVkn(v), false, v);
});

test('TCKN: 11 digits, not starting with 0, both check digits', () => {
  for (const v of ['10000000146', '12345678950', '23456789138']) assert.equal(validTckn(v), true, v);
  assert.equal(validTckn('10000000147'), false, 'last check digit');
  assert.equal(validTckn('10000000156'), false, 'tenth check digit');
  assert.equal(validTckn('02345678950'), false, 'starts with 0');
  assert.equal(validTckn('1234567895'), false, 'ten digits');
  // The toggle decides which rule applies.
  assert.equal(validTaxNumber('company', '12345678950'), false); assert.equal(validTaxNumber('person', '1234567890'), false);
  assert.equal(validTaxNumber('company', '1234567890'), true); assert.equal(validTaxNumber('person', '12345678950'), true);
});

test('Turkish mobile numbers are normalised to +905xxxxxxxxx; landlines and short numbers are refused', () => {
  for (const p of ['0532 123 45 67', '+90 532 123 45 67', '905321234567', '5321234567', '(0532) 123-4567']) assert.equal(normalPhone(p), '+905321234567', p);
  for (const p of ['0212 123 45 67', '532123456', '+1 532 123 45 67', '']) assert.equal(normalPhone(p), '', p);
  assert.equal(showPhone('+905321234567'), '+90 532 123 45 67');
  assert.equal(validEmail(' Ayse@Kafe.com.tr '), true); assert.equal(normalEmail(' Ayse@Kafe.com.tr '), 'ayse@kafe.com.tr');
  assert.equal(validEmail('ayse@kafe'), false); assert.equal(validEmail('ayse kafe@x.com'), false);
});

test('the application schema checks the same rules on the servers and normalises what is kept', () => {
  const form = { businessName: 'Ayhanlar Çay Evi', sector: 'cafe', contactName: 'Ahmet Ayhan', consent: true,
    invoice: { legalName: 'Ahmet Ayhan – Ayhanlar Çay Evi', taxOffice: 'Kadıköy', taxType: 'person', taxNumber: '12345678950', city: 'İstanbul', district: 'Kadıköy', address: 'Moda Cd. No: 1', phone: '0532 123 45 67', email: 'Ahmet@Ayhan.com' } };
  const parsed = applicationForm.parse(form);
  assert.equal(parsed.invoice.phone, '+905321234567'); assert.equal(parsed.invoice.email, 'ahmet@ayhan.com');
  assert.equal(applicationForm.safeParse({ ...form, invoice: { ...form.invoice, taxType: 'company' } }).success, false, 'a TCKN is not a VKN');
  assert.equal(applicationForm.safeParse({ ...form, consent: false }).success, false, 'the notice must be accepted');
  assert.equal(applicationForm.safeParse({ ...form, invoice: { ...form.invoice, phone: '0212 123 45 67' } }).success, false);
  assert.equal(applicationForm.safeParse({ ...form, extra: 1 }).success, false, 'nothing else rides along');
});
