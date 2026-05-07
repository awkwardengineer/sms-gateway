/**
 * Plivo expects XML: https://www.plivo.com/docs/xml/
 */
export function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function plivoMessageXml(body: string): string {
  const safe = escapeXmlText(body);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Message>${safe}</Message>\n</Response>`;
}

/** No outbound SMS — empty Response. */
export function plivoEmptyResponseXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`;
}
