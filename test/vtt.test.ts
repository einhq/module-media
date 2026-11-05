/** A time as WebVTT writes it: hours always, milliseconds, never negative. */

import { assertEquals } from '@std/assert';
import { formatVttTime } from '@media/vtt';

Deno.test('vtt time always carries the hours field', () => {
  assertEquals(formatVttTime(0), '00:00:00.000');
  assertEquals(formatVttTime(1.5), '00:00:01.500');
  assertEquals(formatVttTime(83.25), '00:01:23.250');
});

Deno.test('vtt time crosses the hour boundary', () => {
  assertEquals(formatVttTime(3600), '01:00:00.000');
  assertEquals(formatVttTime(3661.007), '01:01:01.007');
});

Deno.test('a negative start clamps rather than emitting a broken cue', () => {
  assertEquals(formatVttTime(-1), '00:00:00.000');
});
