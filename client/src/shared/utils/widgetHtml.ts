/** Strip markdown code fence (```html / ```) if the model wrapped the output */
export function stripMarkdownCodeFence(html: string): string {
  return html
    .replace(/^\s*```(?:html)?\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/i, '')
    .trim();
}

/** Strip any leading text before <!DOCTYPE or <html> so the iframe never receives reasoning/code as plain text */
export function stripToHtmlDocumentStart(html: string): string {
  const lower = html.toLowerCase();
  const doctype = lower.indexOf('<!doctype');
  const htmlTag = lower.indexOf('<html');
  let start = -1;
  if (doctype !== -1 && (htmlTag === -1 || doctype <= htmlTag)) start = doctype;
  else if (htmlTag !== -1) start = htmlTag;
  if (start === -1) return html;
  return html.slice(start);
}
