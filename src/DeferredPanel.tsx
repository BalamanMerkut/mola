import { Component, Suspense, type ReactNode } from 'react';
class PanelLoadError extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <section className="panel"><h2>Ekran açılamadı</h2><p>Bağlantınızı kontrol edip sayfayı yenileyin.</p><button className="btn secondary" onClick={() => location.reload()}>Sayfayı yenile</button></section>;
    return this.props.children;
  }
}
export function DeferredPanel({ children }: { children: ReactNode }) {
  return <PanelLoadError><Suspense fallback={<section className="panel" aria-busy="true"><p role="status">Ekran hazırlanıyor…</p></section>}>{children}</Suspense></PanelLoadError>;
}
