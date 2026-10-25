/**
 * Turn `[3]` style references into markdown links (`[3](cite:3)`) so the
 * renderer can swap them for clickable chips. Skips fenced code blocks so
 * snippets containing array access are left alone.
 */
export function linkifyCitations(text: string, max: number): string {
  if (max <= 0) return text;
  let inFence = false;
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(/\[(\d+)\](?!\()/g, (match, digits: string) => {
        const index = Number(digits);
        return index >= 1 && index <= max ? `[${digits}](cite:${digits})` : match;
      });
    })
    .join('\n');
}
