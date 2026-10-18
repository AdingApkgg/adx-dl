import { Fragment, type ReactNode } from "react";

// A bounded, non-recursive allowlist renderer. Everything else stays escaped text.
function inline(text: string): ReactNode[] {
  const result: ReactNode[] = []; const pattern = /`([^`\n]+)`|(?<!!)\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    if (result.length >= 2000) break;
    result.push(text.slice(end, match.index));
    if (match[1]) result.push(<code key={match.index} className="rounded bg-muted px-1 font-mono">{match[1]}</code>);
    else { try { const url = new URL(match[3]!); result.push(<a key={match.index} href={url.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="break-all underline">{match[2]}</a>); } catch { result.push(match[0]); } }
    end = match.index + match[0].length;
  }
  result.push(text.slice(end)); return result;
}
export function LimitedMarkdown({ body }: { body: string }) {
  const lines = Array.from(body).slice(0, 10000).join("").replace(/\r\n?/g, "\n").split("\n"), blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!; if (!line.trim()) continue;
    if (/^```/.test(line)) { const code: string[] = []; while (++i < lines.length && !/^```/.test(lines[i]!)) code.push(lines[i]!); blocks.push(<pre key={i} className="overflow-x-auto rounded-lg bg-muted p-3"><code>{code.join("\n")}</code></pre>); continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { blocks.push(<div role="heading" aria-level={Number(heading[1]!.length) + 1} key={i} className="break-words font-semibold">{inline(heading[2]!)}</div>); continue; }
    if (/^>\s?/.test(line)) { const quote: string[] = [line.replace(/^>\s?/, "")]; while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1]!)) quote.push(lines[++i]!.replace(/^>\s?/, "")); blocks.push(<blockquote key={i} className="whitespace-pre-wrap break-words border-l-4 pl-3 text-muted-foreground">{inline(quote.join("\n"))}</blockquote>); continue; }
    if (/^(?:[-*+] |\d+\. )/.test(line)) { const ordered = /^\d+\. /.test(line), items: ReactNode[] = []; do { items.push(<li key={i}>{inline(lines[i]!.replace(/^(?:[-*+] |\d+\. )/, ""))}</li>); if (i + 1 >= lines.length || !(ordered ? /^\d+\. / : /^[-*+] /).test(lines[i + 1]!)) break; i++; } while (i < lines.length); blocks.push(ordered ? <ol key={i} className="list-decimal space-y-1 pl-6">{items}</ol> : <ul key={i} className="list-disc space-y-1 pl-6">{items}</ul>); continue; }
    const paragraph = [line]; while (i + 1 < lines.length && lines[i + 1]!.trim() && !/^(?:```|#{1,6} |>|[-*+] |\d+\. )/.test(lines[i + 1]!)) paragraph.push(lines[++i]!);
    blocks.push(<p key={i} className="whitespace-pre-wrap break-words">{inline(paragraph.join("\n"))}</p>);
  }
  return <div className="space-y-3 text-sm">{blocks.map((block, i) => <Fragment key={i}>{block}</Fragment>)}</div>;
}
