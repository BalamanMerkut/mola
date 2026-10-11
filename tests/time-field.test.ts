import test from 'node:test';
import assert from 'node:assert/strict';
import { finishTime, isTime, shapeTime } from '../src/timeText';

// 24-hour time fields (src/TimeField.tsx): never AM/PM, whatever the computer's language.
test('typing a time: the colon comes after the hour, a single first digit above 2 is 0X, pasting "19:30" stays', () => {
  assert.equal(shapeTime('1', ''), '1');
  assert.equal(shapeTime('19', '1'), '19:');
  assert.equal(shapeTime('19', '19:'), '19', 'backspace over the colon removes it');
  assert.equal(shapeTime('193', '19'), '19:3');
  assert.equal(shapeTime('1930', '193'), '19:30');
  assert.equal(shapeTime('9', ''), '09:');
  assert.equal(shapeTime('930', ''), '09:30');
  assert.equal(shapeTime('19:30', ''), '19:30');
  assert.equal(shapeTime('7:5', ''), '7:5');
  assert.equal(shapeTime('ab12:3x4', ''), '12:34');
});
test('leaving the field finishes it; only real 24-hour times count', () => {
  assert.equal(finishTime('9'), '09:00');
  assert.equal(finishTime('19:3'), '19:30');
  assert.equal(finishTime('7:5'), '07:50');
  assert.equal(finishTime(''), '');
  assert.equal(finishTime('25:00'), '25:00', 'impossible hours stay visible (and invalid)');
  for (const ok of ['00:00', '09:05', '23:59']) assert.equal(isTime(ok), true, ok);
  for (const bad of ['24:00', '9:00', '12:60', '12:3', '', '09:00 AM']) assert.equal(isTime(bad), false, bad);
});
