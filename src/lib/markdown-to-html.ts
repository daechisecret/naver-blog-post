export function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const output: string[] = [];
  let inBlockquote = false;
  let blockquoteLines: string[] = [];

  function flushBlockquote() {
    if (blockquoteLines.length === 0) return;
    // Join blockquote content, process inline formatting
    const content = blockquoteLines.join(' ');
    output.push('<blockquote>' + processInline(content) + '</blockquote>');
    blockquoteLines = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();

    // Blockquote lines
    if (line.startsWith('> ')) {
      let content = line.slice(2);
      // Strip ## inside blockquotes
      content = content.replace(/^#{1,3}\s+/, '');
      if (!inBlockquote) {
        inBlockquote = true;
        blockquoteLines = [];
      }
      blockquoteLines.push(content);
      continue;
    }

    // End of blockquote
    if (inBlockquote) {
      flushBlockquote();
      inBlockquote = false;
    }

    // Horizontal rule
    if (/^---+$/.test(line)) {
      output.push('<hr/>');
      continue;
    }

    // Headers
    if (line.startsWith('## ')) {
      output.push('<h2>' + processInline(line.slice(3)) + '</h2>');
      continue;
    }
    if (line.startsWith('### ')) {
      output.push('<h3>' + processInline(line.slice(4)) + '</h3>');
      continue;
    }

    // Bullet points with •
    if (line.startsWith('• ')) {
      output.push('<li style="list-style-type:disc;margin-left:20px">' + processInline(line.slice(2)) + '</li>');
      continue;
    }

    // Markdown bullet points (* or -)
    const bulletMatch = line.match(/^[\*\-]\s+(.+)/);
    if (bulletMatch) {
      output.push('<li style="list-style-type:disc;margin-left:20px">' + processInline(bulletMatch[1]) + '</li>');
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      output.push('<br>');
      continue;
    }

    // Regular line
    output.push('<p>' + processInline(line) + '</p>');
  }

  // Flush remaining blockquote
  if (inBlockquote) {
    flushBlockquote();
  }

  return output.join('\n');
}

function processInline(text: string): string {
  // Bold: **text**
  text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  // Italic: *text*
  text = text.replace(/\*(.+?)\*/g, '<i>$1</i>');
  return text;
}
