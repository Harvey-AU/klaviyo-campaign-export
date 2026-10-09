const formats = new Map();

export function localTime(iso, timeZone) {
  if (!formats.has(timeZone)) {
    formats.set(timeZone, new Intl.DateTimeFormat('en-AU', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }));
  }
  const p = Object.fromEntries(formats.get(timeZone).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
