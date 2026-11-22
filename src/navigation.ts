export function navigate(to: string): void {
  if (location.pathname + location.search === to) return;
  history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
