import { useEffect, useRef } from 'react';

const BOOTSTRAP_SCRIPT = `var c = document.currentScript.closest('[data-widget-id]'); if(c){ window.__CURRENT_WIDGET_ID__ = c.getAttribute('data-widget-id'); try { window.__WIDGET_INIT__ = JSON.parse(c.getAttribute('data-widget-init') || '{}'); } catch(e) { window.__WIDGET_INIT__ = {}; } }`;

export function useWidgetContentInject(
  widgetId: string,
  cleanHtml: string,
  isFocused: boolean,
  isGenerating: boolean,
  containerRef: React.RefObject<HTMLDivElement | null>,
): void {
  const lastInjectedRef = useRef<{ id: string; html: string } | null>(null);

  useEffect(() => {
    if (!isFocused) return;
    if (isGenerating || !cleanHtml || !containerRef.current) return;
    const el = containerRef.current;
    if (
      lastInjectedRef.current?.id === widgetId &&
      lastInjectedRef.current?.html === cleanHtml
    )
      return;
    lastInjectedRef.current = { id: widgetId, html: cleanHtml };
    el.innerHTML = '';
    el.innerHTML = cleanHtml;
    fetch(`/api/widgets/${widgetId}/data`)
      .then((res) => res.json())
      .then((initialData: unknown) => {
        el.setAttribute('data-widget-init', JSON.stringify(initialData));
        const bootstrap = document.createElement('script');
        bootstrap.textContent = BOOTSTRAP_SCRIPT;
        el.appendChild(bootstrap);
        el.querySelectorAll('script').forEach((oldScript) => {
          if (oldScript.src || oldScript === bootstrap) return;
          const newScript = document.createElement('script');
          newScript.textContent = (oldScript.textContent ?? '')
            .replace(/\bconst\s+/g, 'var ')
            .replace(/\blet\s+/g, 'var ');
          el.appendChild(newScript);
        });
      });
  }, [isFocused, cleanHtml, isGenerating, widgetId]);
}
