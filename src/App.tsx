import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BrandLogo } from './components/BrandLogo.tsx';
import {
  IconBook,
  IconCheckCircle,
  IconExternalLink,
  IconFigma,
  IconFileBarChart,
  IconPlay,
  IconTarget,
} from './components/Icons.tsx';
import Demo from './demo/Demo.tsx';
import { useI18n } from './i18n/useI18n.ts';
import BenchmarkPage from './pages/BenchmarkPage.tsx';
import CapabilitiesPage from './pages/CapabilitiesPage.tsx';
import GuidePage from './pages/GuidePage.tsx';
import ReportDetailPage from './pages/ReportDetailPage.tsx';
import ReportsPage from './pages/ReportsPage.tsx';
import ValidatePage from './pages/ValidatePage.tsx';
import { Link } from './router.tsx';

export default function App() {
  const [route, setRoute] = useState(location.pathname);
  const [scrolled, setScrolled] = useState(false);
  const { locale, setLocale, t } = useI18n();
  const navRef = useRef<HTMLElement>(null);
  const initialRouteRef = useRef(true);
  const [pill, setPill] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useEffect(() => {
    const onPopState = () => setRoute(location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (initialRouteRef.current) {
      initialRouteRef.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [route]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const syncPill = useCallback(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('a.active');
    if (!nav || !active) {
      setPill(null);
      return;
    }
    setPill({
      left: active.offsetLeft,
      top: active.offsetTop,
      width: active.offsetWidth,
      height: active.offsetHeight,
    });
  }, []);

  useLayoutEffect(() => {
    const rafId = requestAnimationFrame(syncPill);
    const nav = navRef.current;
    let ro: ResizeObserver | undefined;
    if (nav && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(syncPill);
      ro.observe(nav);
    }
    document.fonts?.ready.then(syncPill).catch(() => undefined);
    return () => {
      cancelAnimationFrame(rafId);
      ro?.disconnect();
    };
  }, [route, locale, syncPill]);

  if (route.startsWith('/demo')) return <Demo />;
  const reportId = route.match(/^\/reports\/([a-z0-9-]+)\/?$/)?.[1];
  const routeKey = reportId ? `report-${reportId}` : route;

  return (
    <div className="app">
      <header className={`topbar${scrolled ? ' scrolled' : ''}`}>
        <div className={`topbar-inner${reportId ? ' wide' : ''}`}>
          <div className="topbar-left">
            <Link to="/" className="brand">
              <BrandLogo size={34} />
              <span className="brand-copy">
                <span className="brand-name">{t.appName}</span>
                <span className="brand-by">by Lucas Caldeira</span>
              </span>
            </Link>
            <nav ref={navRef} className={`topbar-nav${pill ? ' has-pill' : ''}`}>
              {pill && (
                <span
                  className="topbar-nav-pill"
                  aria-hidden="true"
                  style={{
                    width: pill.width,
                    height: pill.height,
                    transform: `translate3d(${pill.left}px, ${pill.top}px, 0)`,
                  }}
                />
              )}
              <Link to="/" className={route === '/' ? 'active' : ''}>
                <IconFigma size={15} />
                <span>{t.nav.validate}</span>
              </Link>
              <Link to="/reports" className={route.startsWith('/reports') ? 'active' : ''}>
                <IconFileBarChart size={15} />
                <span>{t.nav.reports}</span>
              </Link>
              <Link to="/guide" className={route === '/guide' ? 'active' : ''}>
                <IconBook size={15} />
                <span>{t.nav.guide}</span>
              </Link>
              <Link to="/capabilities" className={route === '/capabilities' ? 'active' : ''}>
                <IconCheckCircle size={15} />
                <span>{t.nav.capabilities}</span>
              </Link>
              <span className="topbar-sep" aria-hidden="true" />
              <Link to="/benchmark" className={route === '/benchmark' ? 'active' : ''}>
                <IconTarget size={15} />
                <span>{t.nav.benchmark}</span>
              </Link>
            </nav>
          </div>

          <div className="topbar-right">
            <a href="/demo/sample-screen" target="_blank" rel="noreferrer" className="topbar-demo-link">
              <IconPlay size={13} className="icon-nudge-play" />
              <span>{t.nav.demoLink}</span>
              <IconExternalLink size={12} className="icon-nudge-ext" />
            </a>
            <div className="lang-switch" role="group" aria-label="Language">
              <button type="button" className={locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')}>
                EN
              </button>
              <button type="button" className={locale === 'pt' ? 'active' : ''} onClick={() => setLocale('pt')}>
                PT
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className={`main-container${reportId ? ' wide' : ''}`}>
        <div key={routeKey} className="page-stage">
          {reportId ? (
            <ReportDetailPage key={reportId} id={reportId} />
          ) : route === '/reports' ? (
            <ReportsPage />
          ) : route === '/benchmark' ? (
            <BenchmarkPage />
          ) : route === '/guide' ? (
            <GuidePage />
          ) : route === '/capabilities' ? (
            <CapabilitiesPage />
          ) : (
            <ValidatePage />
          )}
        </div>
      </main>
    </div>
  );
}
