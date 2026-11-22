export function lineSpan(start: number, lines: number) {
  if (lines <= 0) return "none";
  return lines === 1 ? `${start}` : `${start}–${start + lines - 1}`;
}

export function counted(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}
