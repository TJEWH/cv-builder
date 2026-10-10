import type { Application } from '../cloudTypes';
import { resolveDeadline } from './opportunityDeadline';
import { safeWebUrl } from './safeUrl';

type CalendarApplication = Pick<Application, 'id' | 'application_code' | 'context_json'>;
export interface ApplicationDeadlineCalendar { content: string; filename: string }

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** RFC 5545 TEXT escaping also keeps imported research from creating properties. */
function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

/** Fold UTF-8 content lines at 75 bytes without splitting a Unicode character. */
function foldLine(value: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let line = '';
  let bytes = 0;
  for (const character of value) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      lines.push(line);
      line = ' ';
      bytes = 1;
    }
    line += character;
    bytes += size;
  }
  lines.push(line);
  return lines.join('\r\n');
}

function calendarTimestamp(value: Date): string {
  return value.toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
}

function filenamePart(value: string): string {
  const safe = value.normalize('NFC').replace(/[^\p{L}\p{N}\p{M}]+/gu, '-').replace(/^-+|-+$/g, '');
  let result = '';
  let bytes = 0;
  const encoder = new TextEncoder();
  for (const character of safe) {
    bytes += encoder.encode(character).length;
    if (bytes > 220) break;
    result += character;
  }
  return result.replace(/-+$/g, '');
}

/** Timed deadlines retain their instant; calendar apps display it in the device's timezone. */
export function buildApplicationDeadlineCalendar(
  application: CalendarApplication,
  lang = 'en',
  now = new Date(),
): ApplicationDeadlineCalendar | null {
  const context = application.context_json;
  const deadline = resolveDeadline(context);
  if (!deadline || !Number.isFinite(now.getTime()) || now.getUTCFullYear() < 0 || now.getUTCFullYear() > 9999) return null;
  const timestamp = new Date(deadline.timestamp);
  if (timestamp.getUTCFullYear() < 0 || timestamp.getUTCFullYear() > 9999) return null;
  const german = lang === 'de';
  const label = german ? 'Bewerbungsfrist' : 'Application deadline';
  const title = text(context.title) || (german ? 'Bewerbung' : 'Application');
  const summary = `${label}: ${title}`;
  const institution = text(context.institution) || text(context.university);
  const reference = text(application.application_code);
  const description = [summary, institution, reference ? `${german ? 'Referenz' : 'Reference'}: ${reference}` : ''].filter(Boolean).join('\n');
  const url = safeWebUrl(context.application_url) || safeWebUrl(context.official_url);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CV Builder//Application Deadlines//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${escapeText(`application-deadline-${application.id}@cv-builder`)}`, `DTSTAMP:${calendarTimestamp(now)}`,
  ];
  if (deadline.dateOnly && !deadline.time) {
    const nextDay = new Date(`${deadline.date}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    if (nextDay.getUTCFullYear() > 9999) return null;
    lines.push(`DTSTART;VALUE=DATE:${deadline.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${nextDay.toISOString().slice(0, 10).replace(/-/g, '')}`);
  } else {
    lines.push(`DTSTART:${calendarTimestamp(timestamp)}`);
  }
  lines.push(`SUMMARY:${escapeText(summary)}`, `DESCRIPTION:${escapeText(description)}`, 'TRANSP:TRANSPARENT', 'CLASS:PRIVATE');
  if (url) lines.push(`URL:${url}`);
  lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P1W', `DESCRIPTION:${escapeText(summary)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR');
  const name = [german ? 'bewerbungsfrist' : 'application-deadline', filenamePart(title), filenamePart(reference)].filter(Boolean).join('-');
  return { content: lines.map(foldLine).join('\r\n') + '\r\n', filename: `${filenamePart(name)}.ics` };
}
