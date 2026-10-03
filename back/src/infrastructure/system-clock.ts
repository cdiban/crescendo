import type { Clock } from '../application/ports/clock.ts';

const TIME_ZONE = 'America/Santiago';
// en-CA formatea como YYYY-MM-DD.
const DATE_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  today(): string {
    return DATE_FORMAT.format(new Date());
  }
}
