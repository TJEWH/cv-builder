export function normalizeMarkdownText(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
      .map((item) => `- ${item.replace(/^\s*-\s*/, '')}`)
      .join('\n');
  }

  return value == null ? '' : String(value).replaceAll('\r\n', '\n');
}

/** Render paired !!confidential text!! markers for normal or anonymous output. */
export function renderConfidentialText(value, { anonymized = false } = {}) {
  const normalized = normalizeMarkdownText(value);
  return normalized.replace(/!!([\s\S]*?)!!/g, anonymized ? '!!confidential text!!' : '$1');
}

export function parseMarkdownText(value) {
  const proseLines = [];
  const bullets = [];
  let listStarted = false;
  let currentBullet = -1;

  normalizeMarkdownText(value).split('\n').forEach((line) => {
    const bullet = line.match(/^\s*-(?:\s+(.*)|\s*)$/);

    if (bullet) {
      listStarted = true;
      bullets.push(bullet[1] || '');
      currentBullet = bullets.length - 1;
      return;
    }

    if (!listStarted) {
      proseLines.push(line);
      return;
    }

    if (line.trim() && currentBullet !== -1) {
      bullets[currentBullet] = `${bullets[currentBullet]}${bullets[currentBullet] ? '\n' : ''}${line.trim()}`;
    }
  });

  return {
    prose: proseLines.join('\n').trim(),
    bullets: bullets.filter((item) => item.trim()),
  };
}

export function safeMarkdownUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function parseInlineMarkdown(value, { confidentialMarkers = true } = {}) {
  const source = String(value ?? '');
  const tokens = [];
  const pattern = confidentialMarkers
    ? /!!([\s\S]+?)!!|\*\*([\s\S]+?)\*\*|\[([^\]]+)\]\(([^\s)]+)\)/g
    : /\*\*([\s\S]+?)\*\*|\[([^\]]+)\]\(([^\s)]+)\)/g;
  let cursor = 0;
  let match;

  while ((match = pattern.exec(source))) {
    if (match.index > cursor) tokens.push({ type: 'text', value: source.slice(cursor, match.index) });

    if (confidentialMarkers && match[1] != null) {
      tokens.push({ type: 'strike', value: match[1] });
    } else if (match[confidentialMarkers ? 2 : 1] != null) {
      tokens.push({ type: 'bold', value: match[confidentialMarkers ? 2 : 1] });
    } else {
      const label = match[confidentialMarkers ? 3 : 2];
      const href = safeMarkdownUrl(match[confidentialMarkers ? 4 : 3]);
      if (href) tokens.push({ type: 'link', value: label, href });
      else tokens.push({ type: 'text', value: match[0] });
    }
    cursor = pattern.lastIndex;
  }

  if (cursor < source.length) tokens.push({ type: 'text', value: source.slice(cursor) });
  return tokens;
}

export function hasMarkdownText(value) {
  const { prose, bullets } = parseMarkdownText(value);
  return Boolean(prose || bullets.length);
}
