/** Strip markdown code fence (```html / ```) if the model wrapped the output */
export function stripMarkdownCodeFence(html: string): string {
  return html
    .replace(/^\s*```(?:html)?\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/i, '')
    .trim();
}
