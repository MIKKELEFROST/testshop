/**
 * The information pages' text format (src/content/info-pages.ts): {tokens} filled in from the
 * company and shop settings, links written as [text](href), and placeholders in [brackets]
 * that the owner still has to fill in.
 */

export type TextPart = { kind: "text"; text: string } | { kind: "link"; text: string; href: string } | { kind: "placeholder"; text: string };

export function fillTokens(text: string, values: Record<string, string>): string {
  return text.replace(/\{([a-zæøå_]+)\}/g, (match, name: string) => values[name] ?? match);
}

/** Splits filled-in text into plain text, links and placeholders. */
export function parseText(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const pattern = /\[([^\]]+)\]\(([^)\s]+)\)|\[([^\]]+)\]/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push({ kind: "text", text: text.slice(last, match.index) });
    if (match[2] !== undefined) parts.push({ kind: "link", text: match[1]!, href: match[2] });
    else parts.push({ kind: "placeholder", text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

/** Safe link targets only: site paths, mailto/tel and https. */
export function safeHref(href: string): string | null {
  if (/^\/(?!\/)/.test(href) || /^(mailto|tel):[^\s]+$/.test(href)) return href;
  try {
    return new URL(href).protocol === "https:" ? href : null;
  } catch {
    return null;
  }
}
