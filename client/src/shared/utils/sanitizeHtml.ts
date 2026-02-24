/**
 * Removes <script> and <style> tags and their content from HTML.
 * Use for safe preview during streaming (no script execution).
 */
export function stripScriptsAndStyles(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .trim();
}
