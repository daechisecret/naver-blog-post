export function markdownToHtml(md: string): string {
  let html = md;

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr/>');

  // Headers: ## text
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');

  // Blockquotes: > text (can be multi-line)
  // Process line by line
  const lines = html.split('\n');
  const processed: string[] = [];
  let inBlockquote = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('&gt; ') || line.startsWith('> ')) {
      const content = line.replace(/^(&gt; |> )/, '');
      if (!inBlockquote) {
        processed.push('<blockquote>');
        inBlockquote = true;
      }
      processed.push(content);
    } else {
      if (inBlockquote) {
        processed.push('</blockquote>');
        inBlockquote = false;
      }
      processed.push(line);
    }
  }
  if (inBlockquote) {
    processed.push('</blockquote>');
  }
  html = processed.join('\n');

  // Bold: **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

  // Italic: *text* (but not inside bold)
  html = html.replace(/\*(.+?)\*/g, '<i>$1</i>');

  // Line breaks: preserve newlines as <br>
  html = html.replace(/\n/g, '<br>\n');

  return html;
}
