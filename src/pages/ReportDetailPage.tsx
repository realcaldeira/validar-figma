import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type PointerEvent,
} from 'react';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBox,
  IconCheck,
  IconCheckCircle,
  IconColumns,
  IconCopy,
  IconDownload,
  IconExternalLink,
  IconFigma,
  IconFigmaColor,
  IconGrid,
  IconImage,
  IconInfo,
  IconLayers,
  IconPalette,
  IconRefresh,
  IconSearch,
  IconSliders,
  IconSplit,
  IconTarget,
  IconType,
  IconXCircle,
} from '../components/Icons.tsx';
import { ScoreRing } from '../components/ScoreRing.tsx';
import { CountUp } from '../components/CountUp.tsx';
import { RollingNumber } from '../components/RollingNumber.tsx';
import { classifyVisibility, computeMatchScore, headlineScore, type Visibility } from '../engine/compare.ts';
import type { CheckResult, CheckStatus, Dimensions, Rect, RegionReport, ValidationReport } from '../engine/types.ts';
import { localizeMessage, localizeReportMarkdown } from '../i18n/messages.ts';
import type { Locale } from '../i18n/types.ts';
import { useI18n } from '../i18n/useI18n.ts';
import { Link } from '../router.tsx';
import { apiRequest } from '../utils/api.ts';
import { generateCssFix } from '../utils/cssFix.ts';
import { computeImagePixelDiff, precisionToPixelThreshold, type PixelDiffResult } from '../utils/pixelDiff.ts';
import {
  extractCssColor,
  formatFriendlyDelta,
  getFriendlyPropertyLabel,
  groupRegionResults,
  type PropertyCategory,
} from '../utils/propertyLabels.ts';
import './report.css';

interface ReportMeta {
  id: string;
  name: string;
  url: string;
  figmaUrl: string | null;
  figmaFrame: Dimensions | null;
  figmaImage: string | null;
  screenImage: string | null;
  precision?: number | null;
  createdAt: string;
}

type FilterMode = 'differences' | 'warnings' | 'all';
type SeenMode = Visibility | 'all';
const visibilityOf = (x: CheckResult): Visibility => x.visibility ?? classifyVisibility(x);
type CategoryFilter = 'all' | PropertyCategory;
type ViewMode = 'sideBySide' | 'overlay' | 'split' | 'pixelDiff' | 'figmaOnly' | 'screenOnly';
type ZoomMode = 'fit' | 1 | 1.5;

const regionStatus = (r: RegionReport): CheckStatus =>
  r.results.some((x) => x.status === 'fail')
    ? 'fail'
    : r.results.some((x) => x.status !== 'pass')
      ? 'warn'
      : 'pass';

const isHttpUrl = (u: string | null | undefined): u is string => Boolean(u && /^https?:\/\//i.test(u));

function useContainerWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

function ColorSwatch({ value }: { value: string }) {
  const color = extractCssColor(value);
  if (!color) return null;
  return (
    <span className="color-swatch" aria-hidden="true">
      <span style={{ background: color }} />
    </span>
  );
}

function RegionBoxes({
  regions,
  scale,
  rectKey,
  stageSize,
  selected,
  hovered,
  onSelect,
  onHover,
  statusLabels,
  allMatchText,
  locale,
}: {
  regions: { r: RegionReport; n: number; status: CheckStatus }[];
  scale: number;
  rectKey: 'rect' | 'figmaRect';
  stageSize: Dimensions;
  selected: number | null;
  hovered: number | null;
  onSelect: (n: number) => void;
  onHover: (n: number | null) => void;
  statusLabels: Record<CheckStatus, string>;
  allMatchText: string;
  locale: Locale;
}) {
  return (
    <div className="rd-markers-layer">
      {regions.map(({ r, n, status }) => {
        const raw: Rect | null | undefined = r[rectKey];
        if (!raw || !scale) return null;
        // A imagem mostra só o tamanho do frame: a marcação é recortada nela (uma região que passa da borda
        // não pode empurrar o painel e criar rolagem); a que fica toda fora da imagem não é desenhada.
        let rect: Rect = raw;
        if (stageSize.width > 0 && stageSize.height > 0) {
          const x0 = Math.max(0, raw.x);
          const y0 = Math.max(0, raw.y);
          const x1 = Math.min(stageSize.width, raw.x + raw.width);
          const y1 = Math.min(stageSize.height, raw.y + raw.height);
          if (x1 - x0 < 2 || y1 - y0 < 2) return null;
          rect = { ...raw, x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
        }
        const diffs = r.results.filter((x) => x.status !== 'pass');
        const isContainer = regions.some(({ r: other, n: m }) => {
          const b = other[rectKey];
          return (
            m !== n &&
            b &&
            b.x >= rect.x &&
            b.y >= rect.y &&
            b.x + b.width <= rect.x + rect.width + 1 &&
            b.y + b.height <= rect.y + rect.height + 1
          );
        });
        const flipX = stageSize.width > 0 && rect.x / stageSize.width > 0.65;
        const flipY = stageSize.height > 0 && rect.y / stageSize.height > 0.65;

        return (
          <button
            key={n}
            type="button"
            data-n={n}
            className={`rd-box ${status}${selected === n ? ' selected' : ''}${hovered === n ? ' hovered' : ''}${isContainer ? ' container' : ''}`}
            style={{
              left: rect.x * scale,
              top: rect.y * scale,
              width: Math.max(8, rect.width * scale),
              height: Math.max(8, rect.height * scale),
            }}
            onMouseEnter={() => onHover(n)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onSelect(n)}
            aria-label={`${n}. ${localizeMessage(r.name, locale)}: ${statusLabels[status]}`}
          >
            <span className="rd-num">{n}</span>
            <span className={`rd-tip${flipX ? ' flip-x' : ''}${flipY ? ' flip-y' : ''}`} role="tooltip">
              <strong>
                {n}. {localizeMessage(r.name, locale)}
              </strong>
              {diffs.length ? (
                diffs.slice(0, 6).map((d, i) => (
                  <span key={i}>
                    {getFriendlyPropertyLabel(d.property, locale)}: <b>{localizeMessage(d.expected, locale)}</b> →{' '}
                    <b>{localizeMessage(d.actual, locale)}</b>
                  </span>
                ))
              ) : (
                <span>{allMatchText}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function ReportDetailPage({ id }: { id: string }) {
  const { locale, t } = useI18n();
  const [data, setData] = useState<{ meta: ReportMeta; report: ValidationReport; hasScreenHtml: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initialView = useMemo<ViewMode>(() => {
    const q = new URLSearchParams(location.search).get('view');
    if (q === 'overlay' || q === 'split' || q === 'pixelDiff' || q === 'figmaOnly' || q === 'screenOnly') return q;
    return 'sideBySide';
  }, []);

  const [view, setView] = useState<ViewMode>(initialView);
  const [filter, setFilter] = useState<FilterMode>('differences');
  const [seen, setSeen] = useState<SeenMode>('visible');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [draggingSplit, setDraggingSplit] = useState(false);
  const [showMarkers, setShowMarkers] = useState(true);
  const [syncScroll, setSyncScroll] = useState(true);
  const [zoom, setZoom] = useState<ZoomMode>('fit');

  const [overlayOpacity, setOverlayOpacity] = useState(60);
  const [differenceBlend, setDifferenceBlend] = useState(false);
  const [splitPct, setSplitPct] = useState(50);
  const [pixelPrecision, setPixelPrecision] = useState(85);
  const [pixelResultState, setPixelResultState] = useState<{
    key: string;
    result: PixelDiffResult | null;
    error: string | null;
  } | null>(null);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [assetVersion, setAssetVersion] = useState(0);
  const [figmaNatural, setFigmaNatural] = useState<Dimensions | null>(null);
  const [screenNatural, setScreenNatural] = useState<Dimensions | null>(null);

  const [refFigmaStage, figmaStageWidth] = useContainerWidth<HTMLDivElement>();
  const [refScreenStage, screenStageWidth] = useContainerWidth<HTMLDivElement>();
  const [refSingleStage, singleStageWidth] = useContainerWidth<HTMLDivElement>();
  const figmaScrollRef = useRef<HTMLDivElement>(null);
  const screenScrollRef = useRef<HTMLDivElement>(null);
  const splitStageRef = useRef<HTMLDivElement>(null);
  const syncingScrollRef = useRef(false);
  const draggingSplitRef = useRef(false);
  const initialLoadedRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const copyTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copyTimerRef.current), []);

  const applyLoadedReport = useCallback(
    (res: { meta: ReportMeta; report: ValidationReport; hasScreenHtml: boolean }) => {
      setData(res);
      if (!initialLoadedRef.current) {
        initialLoadedRef.current = true;
        const p = res.meta.precision ?? res.report.precision;
        if (typeof p === 'number') setPixelPrecision(p);
        if (!new URLSearchParams(location.search).get('view')) {
          if (res.report.regions.length === 0 && res.meta.screenImage) setView('pixelDiff');
          else if (res.report.regions.length === 0) setView('split');
        }
      }
    },
    [],
  );

  const reloadReport = useCallback(async () => {
    try {
      setError(null);
      const res = await apiRequest<{ meta: ReportMeta; report: ValidationReport; hasScreenHtml: boolean }>(
        `/api/reports/${id}`,
      );
      applyLoadedReport(res);
    } catch (err) {
      setError((err as Error).message || t.reportDetail.notFound);
    }
  }, [applyLoadedReport, id, t.reportDetail.notFound]);

  useEffect(() => {
    initialLoadedRef.current = false;
    let active = true;
    apiRequest<{ meta: ReportMeta; report: ValidationReport; hasScreenHtml: boolean }>(`/api/reports/${id}`)
      .then((res) => {
        if (active) {
          setError(null);
          applyLoadedReport(res);
        }
      })
      .catch((err) => {
        if (active) setError((err as Error).message || t.reportDetail.notFound);
      });
    return () => {
      active = false;
    };
  }, [applyLoadedReport, id, t.reportDetail.notFound]);

  const activePixelKey =
    data?.meta.figmaImage && data?.meta.screenImage
      ? `${data.meta.id}:${data.meta.figmaImage}:${data.meta.screenImage}:${pixelPrecision}:${assetVersion}`
      : null;

  useEffect(() => {
    if (!data?.meta.figmaImage || !data?.meta.screenImage || !activePixelKey) return;
    let active = true;
    const key = activePixelKey;
    const bust = assetVersion ? `?v=${assetVersion}` : '';
    const figmaSrc = `/api/reports/${data.meta.id}/assets/${data.meta.figmaImage}${bust}`;
    const screenSrc = `/api/reports/${data.meta.id}/assets/${data.meta.screenImage}${bust}`;
    const threshold = precisionToPixelThreshold(pixelPrecision);
    computeImagePixelDiff(figmaSrc, screenSrc, threshold)
      .then((result) => {
        if (active) setPixelResultState({ key, result, error: null });
      })
      .catch((err) => {
        if (active) setPixelResultState({ key, result: null, error: (err as Error).message });
      });
    return () => {
      active = false;
    };
  }, [activePixelKey, assetVersion, data?.meta.id, data?.meta.figmaImage, data?.meta.screenImage, pixelPrecision]);

  const pixelLoading = Boolean(activePixelKey && pixelResultState?.key !== activePixelKey);
  const pixelDiff = activePixelKey && pixelResultState?.key === activePixelKey ? pixelResultState.result : null;
  const pixelError = activePixelKey && pixelResultState?.key === activePixelKey ? pixelResultState.error : null;

  const allRegions = useMemo(
    () => (data?.report.regions ?? []).map((r, i) => ({ r, n: i + 1, status: regionStatus(r) })),
    [data],
  );

  const seenOk = useCallback(
    (x: CheckResult, mode: SeenMode) => {
      if (filter === 'all' || mode === 'all') return true;
      if (x.status === 'pass') return false;
      if (x.status !== 'fail') return filter === 'warnings' && mode === 'visible';
      return visibilityOf(x) === mode;
    },
    [filter],
  );
  const regionInSeen = useCallback(
    (r: RegionReport, mode: SeenMode) => filter === 'all' || mode === 'all' || r.results.some((x) => seenOk(x, mode)),
    [filter, seenOk],
  );

  const visibleRegions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRegions
      .filter(({ r, status }) => {
        const statusOk = filter === 'all' ? true : filter === 'warnings' ? status !== 'pass' : status === 'fail';
        if (!statusOk) return false;
        if (!regionInSeen(r, seen)) return false;
        if (!q) return true;
        return (
          r.name.toLowerCase().includes(q) ||
          localizeMessage(r.name, locale).toLowerCase().includes(q) ||
          r.selector.toLowerCase().includes(q) ||
          r.results.some(
            (res) =>
              res.property.toLowerCase().includes(q) ||
              getFriendlyPropertyLabel(res.property, locale).toLowerCase().includes(q),
          )
        );
      })
      .map((entry) => {
        const filteredChecks = entry.r.results.filter((x) =>
          entry.status === 'pass' ? true : x.status !== 'pass' && (filter === 'all' || seen === 'all' || seenOk(x, seen)),
        );
        const groupedRows = groupRegionResults(filteredChecks, locale);
        return { ...entry, groupedRows };
      });
  }, [allRegions, filter, locale, regionInSeen, search, seen, seenOk]);

  const seenCounts = useMemo(() => {
    const base = allRegions.filter(({ status }) => (filter === 'warnings' ? status !== 'pass' : status === 'fail'));
    return {
      visible: base.filter(({ r }) => regionInSeen(r, 'visible')).length,
      css: base.filter(({ r }) => regionInSeen(r, 'css')).length,
      all: base.length,
    };
  }, [allRegions, filter, regionInSeen]);

  const categoryCounts = useMemo(() => {
    const counts: Record<PropertyCategory, number> = {
      color: 0,
      typography: 0,
      spacing: 0,
      border: 0,
      layout: 0,
      other: 0,
    };
    for (const item of visibleRegions) {
      for (const row of item.groupedRows) {
        counts[row.category] += 1;
      }
    }
    return counts;
  }, [visibleRegions]);

  const activeCategoryCount = (Object.keys(categoryCounts) as PropertyCategory[]).filter(
    (k) => categoryCounts[k] > 0,
  ).length;

  const displayedRegions = useMemo(() => {
    if (categoryFilter === 'all') return visibleRegions;
    return visibleRegions
      .map((entry) => ({
        ...entry,
        groupedRows: entry.groupedRows.filter((row) => row.category === categoryFilter),
      }))
      .filter((entry) => entry.groupedRows.length > 0);
  }, [categoryFilter, visibleRegions]);

  const selectRegion = useCallback((n: number) => {
    setSelected(n);
    requestAnimationFrame(() => {
      document
        .querySelectorAll<HTMLElement>(`.rd-panel [data-n="${n}"]`)
        .forEach((el) => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }));
      listRef.current
        ?.querySelector<HTMLElement>(`[data-row="${n}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (!displayedRegions.length) return;
      const idx = displayedRegions.findIndex((v) => v.n === selected);
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        selectRegion(displayedRegions[(idx + 1) % displayedRegions.length].n);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        selectRegion(displayedRegions[(idx - 1 + displayedRegions.length) % displayedRegions.length].n);
      } else if (e.key === 'Escape') {
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [displayedRegions, selected, selectRegion]);

  const uploadAsset = async (kind: 'figma' | 'screen', file: File) => {
    setActionError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      await apiRequest(`/api/reports/${id}/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      });
      setAssetVersion((v) => v + 1);
      await reloadReport();
    } catch (err) {
      setActionError((err as Error).message);
    }
  };

  const handlePaste = async (e: ClipboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (!file || !data) return;
    e.preventDefault();
    if (!data.meta.figmaImage) await uploadAsset('figma', file);
    else if (!data.meta.screenImage) await uploadAsset('screen', file);
  };

  const handleSyncScroll = (source: 'figma' | 'screen') => {
    if (!syncScroll || syncingScrollRef.current) return;
    const srcEl = source === 'figma' ? figmaScrollRef.current : screenScrollRef.current;
    const dstEl = source === 'figma' ? screenScrollRef.current : figmaScrollRef.current;
    if (!srcEl || !dstEl) return;
    syncingScrollRef.current = true;
    const maxSrcY = Math.max(1, srcEl.scrollHeight - srcEl.clientHeight);
    const maxDstY = Math.max(0, dstEl.scrollHeight - dstEl.clientHeight);
    dstEl.scrollTop = (srcEl.scrollTop / maxSrcY) * maxDstY;
    const maxSrcX = Math.max(1, srcEl.scrollWidth - srcEl.clientWidth);
    const maxDstX = Math.max(0, dstEl.scrollWidth - dstEl.clientWidth);
    dstEl.scrollLeft = (srcEl.scrollLeft / maxSrcX) * maxDstX;
    requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
  };

  const updateSplitFromPointer = (clientX: number) => {
    const box = splitStageRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    const pct = Math.max(0, Math.min(100, ((clientX - box.left) / box.width) * 100));
    setSplitPct(Math.round(pct));
  };

  const onSplitPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    draggingSplitRef.current = true;
    setDraggingSplit(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    updateSplitFromPointer(e.clientX);
  };

  const onSplitPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingSplitRef.current) return;
    updateSplitFromPointer(e.clientX);
  };

  const onSplitPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    draggingSplitRef.current = false;
    setDraggingSplit(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const copyWithFeedback = async (key: string, text: string) => {
    setActionError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 2000);
    } catch (err) {
      setActionError((err as Error).message || 'Clipboard unavailable');
    }
  };

  const downloadJson = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data.report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.meta.id}-report.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div className="card">
        <p className="notice error" style={{ marginTop: 0 }}>
          {localizeMessage(error, locale)}
        </p>
        <Link to="/reports">{t.reportDetail.backToReports}</Link>
      </div>
    );
  }
  if (!data) return <p className="notice">{t.reportDetail.loading}</p>;

  const { meta, report, hasScreenHtml } = data;
  const dateLocale = locale === 'pt' ? 'pt-BR' : 'en-US';
  const counts = {
    fail: allRegions.filter((r) => r.status === 'fail').length,
    warn: allRegions.filter((r) => r.status === 'warn').length,
    pass: allRegions.filter((r) => r.status === 'pass').length,
  };
  const statusLabels: Record<CheckStatus, string> = {
    fail: t.reportDetail.failChip,
    warn: t.reportDetail.warnChip,
    pass: t.reportDetail.passChip,
  };

  const pageWidth = report.page?.width || report.viewport?.width || 1440;
  const pageHeight = report.page?.height || report.viewport?.height || 900;
  const frame = meta.figmaFrame ?? report.figmaFrame ?? null;
  const frameWidth = frame?.width || figmaNatural?.width || pageWidth;
  const frameHeight = frame?.height || figmaNatural?.height || pageHeight;

  // Lado da tela: a captura mostra só a área visível medida (o tamanho do frame), não a página inteira.
  // As marcações e a escala usam esse tamanho; a página inteira só vale quando a tela é mostrada ao vivo (iframe).
  const screenAssetIsShot = !hasScreenHtml && Boolean(meta.screenImage);
  const screenWidth = screenAssetIsShot ? report.viewport?.width || frameWidth : pageWidth;
  const screenHeight = screenAssetIsShot
    ? screenNatural && screenNatural.width > 0
      ? Math.round((screenWidth * screenNatural.height) / screenNatural.width)
      : report.viewport?.height || frameHeight
    : pageHeight;

  const figmaScale =
    zoom === 'fit' ? (figmaStageWidth ? figmaStageWidth / frameWidth : 0) : zoom;
  const screenScale =
    zoom === 'fit' ? (screenStageWidth ? screenStageWidth / screenWidth : 0) : zoom;
  const singleScale =
    zoom === 'fit' ? (singleStageWidth ? singleStageWidth / frameWidth : 0) : zoom;

  const missingCoords = allRegions.filter((r) => !r.r.figmaRect).length;
  const measuredW = report.viewport?.width;
  const measuredH = report.viewport?.height;
  const resolutionOff =
    frame && measuredW && measuredH && (Math.abs(measuredW - frame.width) > 1 || Math.abs(measuredH - frame.height) > 1)
      ? t.reportDetail.panels.resolutionMismatch
          .replace('{sw}', String(measuredW))
          .replace('{sh}', String(measuredH))
          .replace('{fw}', String(frame.width))
          .replace('{fh}', String(frame.height))
      : null;
  const pixelTone: 'pass' | 'warn' | 'fail' = pixelDiff
    ? pixelDiff.matchPercent >= 99
      ? 'pass'
      : pixelDiff.matchPercent >= 90
        ? 'warn'
        : 'fail'
    : 'pass';
  const isPixelOnly = allRegions.length === 0 && Boolean(pixelDiff);
  const verdictClass: 'pass' | 'warn' | 'fail' = isPixelOnly
    ? pixelTone
    : counts.fail
      ? 'fail'
      : counts.warn
        ? 'warn'
        : 'pass';

  const s = report.summary;
  const failCssCount =
    s?.failCss ?? report.regions.reduce((n, r) => n + r.results.filter((x) => x.status === 'fail' && visibilityOf(x) === 'css').length, 0);
  const cssScore = s ? headlineScore(s, failCssCount) : null;
  const strictScore = s ? (s.score ?? computeMatchScore(s.pass, s.fail, s.warn)) : null;
  const fidelityScore = cssScore ?? (pixelDiff ? pixelDiff.matchPercent : null);
  const precisionUsed = meta.precision ?? report.precision ?? null;
  const scoreTone =
    fidelityScore === null
      ? verdictClass
      : fidelityScore >= 98 && (s ? s.fail - failCssCount : counts.fail) === 0
        ? 'pass'
        : fidelityScore >= 75
          ? 'warn'
          : 'fail';

  const cacheBust = assetVersion ? `?v=${assetVersion}` : '';
  const figmaAssetUrl = meta.figmaImage ? `/api/reports/${meta.id}/assets/${meta.figmaImage}${cacheBust}` : null;
  const screenAssetUrl = meta.screenImage ? `/api/reports/${meta.id}/assets/${meta.screenImage}${cacheBust}` : null;
  const screenHtmlUrl = hasScreenHtml ? `/api/reports/${meta.id}/assets/screen.html` : null;

  const renderUploadDropzone = (kind: 'figma' | 'screen', label: string, emptyMessage: string) => (
    <div className="rd-empty-box">
      <p style={{ marginTop: 0 }}>{emptyMessage}</p>
      <label className="btn secondary small" style={{ position: 'relative', overflow: 'hidden' }}>
        {label}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.currentTarget.value = '';
            if (f) void uploadAsset(kind, f);
          }}
        />
      </label>
    </div>
  );

  const renderCompositeScreenLayer = (scale: number) => {
    if (screenAssetUrl) {
      return <img src={screenAssetUrl} alt={meta.name} style={{ width: '100%', height: 'auto', display: 'block' }} />;
    }
    if (screenHtmlUrl) {
      const iframeScale = pageWidth > 0 ? scale * (frameWidth / pageWidth) : 0;
      return (
        <iframe
          title="Captured screen overlay"
          src={screenHtmlUrl}
          tabIndex={-1}
          style={{ width: pageWidth, height: pageHeight, transform: `scale(${iframeScale})` }}
        />
      );
    }
    return null;
  };

  const viewTabs: { id: ViewMode; label: string; icon: typeof IconColumns }[] = [
    { id: 'sideBySide', label: t.reportDetail.views.sideBySide, icon: IconColumns },
    { id: 'overlay', label: t.reportDetail.views.overlay, icon: IconLayers },
    { id: 'split', label: t.reportDetail.views.split, icon: IconSplit },
    { id: 'pixelDiff', label: t.reportDetail.views.pixelDiff, icon: IconGrid },
    { id: 'figmaOnly', label: t.reportDetail.views.figmaOnly, icon: IconFigma },
    { id: 'screenOnly', label: t.reportDetail.views.screenOnly, icon: IconImage },
  ];

  const categoryItems: { id: PropertyCategory; label: string; icon: typeof IconPalette }[] = [
    { id: 'color', label: t.reportDetail.categories.color, icon: IconPalette },
    { id: 'typography', label: t.reportDetail.categories.typography, icon: IconType },
    { id: 'spacing', label: t.reportDetail.categories.spacing, icon: IconSliders },
    { id: 'border', label: t.reportDetail.categories.border, icon: IconBox },
    { id: 'layout', label: t.reportDetail.categories.layout, icon: IconLayers },
    { id: 'other', label: t.reportDetail.categories.other, icon: IconInfo },
  ];

  return (
    <div onPaste={(e) => void handlePaste(e)}>
      {actionError && (
        <div className="banner error" role="alert">
          <span>{localizeMessage(actionError, locale)}</span>
          <button type="button" className="btn secondary small" onClick={() => setActionError(null)}>
            ✕
          </button>
        </div>
      )}
      <div className="rd-header">
        <div>
          <Link to="/reports" className="rd-back">
            <IconArrowLeft size={14} />
            <span>{t.reportDetail.backToReports}</span>
          </Link>
          <h1>{meta.name}</h1>
          <div className="rd-meta-line">
            <span>{new Date(meta.createdAt).toLocaleString(dateLocale)}</span>
            {precisionUsed !== null && (
              <span className="badge accent">
                {t.reportDetail.precisionUsed}: <CountUp value={precisionUsed} suffix="%" />
              </span>
            )}
            {isHttpUrl(meta.url) && (
              <a href={meta.url} target="_blank" rel="noreferrer" className="rd-meta-link">
                <span>{t.reportDetail.openScreen}</span>
                <IconExternalLink size={12} />
              </a>
            )}
            {isHttpUrl(meta.figmaUrl) && (
              <a href={meta.figmaUrl} target="_blank" rel="noreferrer" className="rd-meta-link">
                <span>{t.reportDetail.openFigma}</span>
                <IconExternalLink size={12} />
              </a>
            )}
          </div>
        </div>

        <div className="rd-verdict-group">
          {pixelDiff && (
            <div className={`rd-verdict ${pixelTone}`} style={{ minWidth: 225 }}>
              <ScoreRing score={pixelDiff.matchPercent} tone={pixelTone} size={64} strokeWidth={6} />
              <div className="rd-verdict-body">
                <span className="rd-verdict-title">{t.reportDetail.controls.pixelMatch}</span>
                <span className="rd-verdict-hint">
                  <CountUp value={pixelDiff.diffPixels} localeFormat /> {t.reportDetail.controls.diffPixels}
                </span>
              </div>
            </div>
          )}

          <div className={`rd-verdict ${verdictClass}`}>
            {fidelityScore !== null && <ScoreRing score={fidelityScore} tone={scoreTone} size={74} strokeWidth={6.5} />}
            <div className="rd-verdict-body">
              <span className="rd-verdict-title">
                {isPixelOnly && pixelDiff ? (
                  pixelTone === 'pass' ? (
                    t.reportDetail.verdictMatch
                  ) : (
                    `${t.reportDetail.controls.pixelMatch}: ${pixelDiff.matchPercent}%`
                  )
                ) : counts.fail ? (
                  <>
                    <CountUp value={counts.fail} />{' '}
                    {counts.fail === 1 ? t.reportDetail.verdictDiffSingular : t.reportDetail.verdictDiffPlural}
                  </>
                ) : counts.warn ? (
                  t.reportDetail.verdictWarn
                ) : (
                  t.reportDetail.verdictMatch
                )}
              </span>
              <span className="rd-verdict-hint">
                {verdictClass === 'pass' ? t.reportDetail.verdictPerfectHint : t.reportDetail.verdictFixHint}
              </span>
              {s && (
                <div className="rd-verdict-pills">
                  <span className="badge ok">
                    <CountUp value={s.pass} /> {t.reportDetail.passChip.toLowerCase()}
                  </span>
                  {s.fail > 0 && (
                    <span className="badge fail">
                      <CountUp value={s.fail} /> {t.reportDetail.failChip.toLowerCase()}
                    </span>
                  )}
                  {s.fail > 0 && failCssCount > 0 && (
                    <span className="badge" title={t.reportDetail.seen.hint}>
                      <CountUp value={s.fail - failCssCount} /> {t.reportDetail.seen.pillVisible} · <CountUp value={failCssCount} />{' '}
                      {t.reportDetail.seen.pillCss}
                    </span>
                  )}
                  {strictScore !== null && cssScore !== null && strictScore !== cssScore && (
                    <span className="badge" title={t.reportDetail.seen.hint}>
                      {t.reportDetail.seen.strictScore.replace('{pct}', String(strictScore))}
                    </span>
                  )}
                  {s.warn > 0 && (
                    <span className="badge warn">
                      <CountUp value={s.warn} /> {t.reportDetail.warnChip.toLowerCase()}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {resolutionOff && (
        <p className="notice warn" role="status" style={{ marginTop: 0 }}>
          {resolutionOff}
        </p>
      )}

      <div className="rd-toolbar">
        <div className="rd-segments" role="group">
          {viewTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                className={view === tab.id ? 'active' : ''}
                onClick={() => setView(tab.id)}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="rd-toolbar-group">
          <div className="rd-segments" role="group">
            <button type="button" className={zoom === 'fit' ? 'active' : ''} onClick={() => setZoom('fit')}>
              {t.reportDetail.controls.zoomFit}
            </button>
            <button type="button" className={zoom === 1 ? 'active' : ''} onClick={() => setZoom(1)}>
              100%
            </button>
            <button type="button" className={zoom === 1.5 ? 'active' : ''} onClick={() => setZoom(1.5)}>
              150%
            </button>
          </div>

          <button
            type="button"
            className={`btn small ${showMarkers ? '' : 'secondary'}`}
            onClick={() => setShowMarkers((v) => !v)}
          >
            <IconTarget size={14} />
            <span>{t.reportDetail.controls.markers}</span>
          </button>

          {view === 'sideBySide' && (
            <button
              type="button"
              className={`btn small ${syncScroll ? '' : 'secondary'}`}
              onClick={() => setSyncScroll((v) => !v)}
            >
              <IconRefresh size={13} />
              <span>{t.reportDetail.controls.syncScroll}</span>
            </button>
          )}

          <button
            type="button"
            className={`btn secondary small${copiedKey === 'md' ? ' copied' : ''}`}
            onClick={() =>
              void copyWithFeedback(
                'md',
                report.markdown ? localizeReportMarkdown(report.markdown, locale) : JSON.stringify(report.summary),
              )
            }
          >
            {copiedKey === 'md' ? <IconCheck size={14} /> : <IconCopy size={14} />}
            <span>{copiedKey === 'md' ? t.reportDetail.controls.copied : t.reportDetail.controls.copyMarkdown}</span>
          </button>

          <button type="button" className="btn secondary small" onClick={downloadJson}>
            <IconDownload size={14} />
            <span>{t.reportDetail.controls.downloadJson}</span>
          </button>
        </div>
      </div>

      {view === 'overlay' && (
        <div className="rd-subbar">
          <div className="rd-subbar-controls">
            <label className="rd-slider-label">
              <span>
                {t.reportDetail.controls.opacity}: <RollingNumber value={overlayOpacity} suffix="%" fast rollOnMount={false} />
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={overlayOpacity}
                onChange={(e) => setOverlayOpacity(Number(e.target.value))}
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={differenceBlend}
                onChange={(e) => setDifferenceBlend(e.target.checked)}
              />
              <span>{t.reportDetail.controls.differenceBlend}</span>
            </label>
          </div>
          <span className="rd-subbar-help">
            <IconInfo size={14} />
            <span>{t.reportDetail.viewHelp.overlay}</span>
          </span>
        </div>
      )}

      {view === 'split' && (
        <div className="rd-subbar">
          <div className="rd-subbar-controls">
            <label className="rd-slider-label">
              <span>
                {t.reportDetail.controls.splitPosition}: <RollingNumber value={splitPct} suffix="%" fast rollOnMount={false} />
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={splitPct}
                onChange={(e) => setSplitPct(Number(e.target.value))}
              />
            </label>
          </div>
          <span className="rd-subbar-help">
            <IconInfo size={14} />
            <span>{t.reportDetail.viewHelp.split}</span>
          </span>
        </div>
      )}

      {view === 'pixelDiff' && (
        <div className="rd-subbar">
          <div className="rd-subbar-controls">
            <label className="rd-slider-label">
              <span>
                {t.reportDetail.controls.precisionPixel}: <RollingNumber value={pixelPrecision} suffix="%" fast rollOnMount={false} />
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={pixelPrecision}
                onChange={(e) => setPixelPrecision(Number(e.target.value))}
              />
            </label>
            {pixelDiff && (
              <>
                <span className={`badge ${pixelDiff.matchPercent >= 99 ? 'ok' : pixelDiff.matchPercent >= 90 ? 'warn' : 'fail'}`}>
                  {t.reportDetail.controls.pixelMatch}: <CountUp value={pixelDiff.matchPercent} suffix="%" />
                </span>
                <span className="notice" style={{ margin: 0 }}>
                  <CountUp value={pixelDiff.diffPixels} localeFormat /> / <CountUp value={pixelDiff.totalPixels} localeFormat />{' '}
                  {t.reportDetail.controls.diffPixels}
                </span>
                {pixelDiff.dimensionMismatch && (
                  <span className="badge warn">
                    {t.reportDetail.controls.dimensionMismatch
                      .replace('{fw}', String(pixelDiff.figmaSize.width))
                      .replace('{fh}', String(pixelDiff.figmaSize.height))
                      .replace('{sw}', String(pixelDiff.screenSize.width))
                      .replace('{sh}', String(pixelDiff.screenSize.height))}
                  </span>
                )}
              </>
            )}
          </div>
          <span className="rd-subbar-help">
            <IconInfo size={14} />
            <span>{t.reportDetail.viewHelp.pixelDiff}</span>
          </span>
        </div>
      )}

      {(view === 'sideBySide' || view === 'figmaOnly' || view === 'screenOnly') && (
        <div key={view} className={`rd-panels${view !== 'sideBySide' ? ' single' : ''}`}>
          {view !== 'screenOnly' && (
            <section className="rd-panel">
              <div className="rd-panel-head">
                <div className="rd-panel-title">
                  <span className="rd-panel-dot figma" aria-hidden="true" />
                  <IconFigmaColor size={14} />
                  <h2>{t.reportDetail.panels.figma}</h2>
                </div>
                <span className="badge">
                  <CountUp value={frameWidth} /> × <CountUp value={frameHeight} />
                </span>
              </div>
              <div className="rd-scroll" ref={figmaScrollRef} onScroll={() => handleSyncScroll('figma')}>
                <div
                  ref={refFigmaStage}
                  className="rd-stage"
                  style={zoom !== 'fit' ? { width: frameWidth * zoom } : undefined}
                >
                  {figmaAssetUrl ? (
                    <>
                      <div className="rd-media-frame">
                        <img
                          src={figmaAssetUrl}
                          alt={t.reportDetail.panels.figma}
                          onLoad={(e) =>
                            setFigmaNatural({
                              width: e.currentTarget.naturalWidth,
                              height: e.currentTarget.naturalHeight,
                            })
                          }
                        />
                      </div>
                      {showMarkers && (
                        <RegionBoxes
                          regions={displayedRegions}
                          scale={figmaScale}
                          rectKey="figmaRect"
                          stageSize={{ width: frameWidth, height: frameHeight }}
                          selected={selected}
                          hovered={hovered}
                          onSelect={selectRegion}
                          onHover={setHovered}
                          statusLabels={statusLabels}
                          allMatchText={t.reportDetail.list.tooltipAllMatch}
                          locale={locale}
                        />
                      )}
                    </>
                  ) : (
                    renderUploadDropzone(
                      'figma',
                      t.reportDetail.panels.uploadFigmaBtn,
                      t.reportDetail.panels.missingFigmaImage,
                    )
                  )}
                </div>
              </div>
              {figmaAssetUrl && missingCoords > 0 && (
                <p className="notice">
                  {missingCoords} {t.reportDetail.panels.missingCoordsNote}
                </p>
              )}
            </section>
          )}

          {view !== 'figmaOnly' && (
            <section className="rd-panel">
              <div className="rd-panel-head">
                <div className="rd-panel-title">
                  <span className="rd-panel-dot screen" aria-hidden="true" />
                  <h2>{t.reportDetail.panels.screen}</h2>
                </div>
                <span className="badge">
                  <CountUp value={screenWidth} /> × <CountUp value={screenHeight} />
                </span>
              </div>
              <div className="rd-scroll" ref={screenScrollRef} onScroll={() => handleSyncScroll('screen')}>
                <div
                  ref={refScreenStage}
                  className="rd-stage"
                  style={{
                    width: zoom !== 'fit' ? screenWidth * zoom : undefined,
                    height: screenScale ? screenHeight * screenScale : undefined,
                  }}
                >
                  {screenHtmlUrl ? (
                    <>
                      <div className="rd-media-frame">
                        <iframe
                          title={t.reportDetail.panels.screen}
                          src={screenHtmlUrl}
                          tabIndex={-1}
                          style={{ width: pageWidth, height: pageHeight, transform: `scale(${screenScale})` }}
                        />
                      </div>
                      {showMarkers && (
                        <RegionBoxes
                          regions={displayedRegions}
                          scale={screenScale}
                          rectKey="rect"
                          stageSize={{ width: screenWidth, height: screenHeight }}
                          selected={selected}
                          hovered={hovered}
                          onSelect={selectRegion}
                          onHover={setHovered}
                          statusLabels={statusLabels}
                          allMatchText={t.reportDetail.list.tooltipAllMatch}
                          locale={locale}
                        />
                      )}
                    </>
                  ) : screenAssetUrl ? (
                    <>
                      <div className="rd-media-frame">
                        <img
                          src={screenAssetUrl}
                          alt={t.reportDetail.panels.screen}
                          onLoad={(e) => setScreenNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
                        />
                      </div>
                      {showMarkers && (
                        <RegionBoxes
                          regions={displayedRegions}
                          scale={screenScale}
                          rectKey="rect"
                          stageSize={{ width: screenWidth, height: screenHeight }}
                          selected={selected}
                          hovered={hovered}
                          onSelect={selectRegion}
                          onHover={setHovered}
                          statusLabels={statusLabels}
                          allMatchText={t.reportDetail.list.tooltipAllMatch}
                          locale={locale}
                        />
                      )}
                    </>
                  ) : (
                    renderUploadDropzone(
                      'screen',
                      t.reportDetail.panels.uploadScreenBtn,
                      t.reportDetail.panels.missingScreenHtml,
                    )
                  )}
                </div>
              </div>
            </section>
          )}
        </div>
      )}

      {view === 'overlay' && (
        <section className="rd-panel">
          <div className="rd-panel-head">
            <h2>
              {t.reportDetail.views.overlay}: {t.reportDetail.panels.figma} × {t.reportDetail.panels.screen}
            </h2>
          </div>
          <div className="rd-scroll">
            <div
              ref={refSingleStage}
              className="rd-stage"
              style={{
                width: zoom !== 'fit' ? frameWidth * zoom : undefined,
                height: singleScale ? frameHeight * singleScale : undefined,
              }}
            >
              {figmaAssetUrl && (screenAssetUrl || screenHtmlUrl) ? (
                <>
                  <div className="rd-media-frame">
                    <img
                      src={figmaAssetUrl}
                      alt={t.reportDetail.panels.figma}
                      onLoad={(e) =>
                        setFigmaNatural({
                          width: e.currentTarget.naturalWidth,
                          height: e.currentTarget.naturalHeight,
                        })
                      }
                    />
                    <div
                      className="rd-overlay-layer"
                      style={{
                        opacity: overlayOpacity / 100,
                        mixBlendMode: differenceBlend ? 'difference' : 'normal',
                      }}
                    >
                      {renderCompositeScreenLayer(singleScale)}
                    </div>
                  </div>
                  {showMarkers && (
                    <RegionBoxes
                      regions={displayedRegions}
                      scale={singleScale}
                      rectKey="figmaRect"
                      stageSize={{ width: frameWidth, height: frameHeight }}
                      selected={selected}
                      hovered={hovered}
                      onSelect={selectRegion}
                      onHover={setHovered}
                      statusLabels={statusLabels}
                      allMatchText={t.reportDetail.list.tooltipAllMatch}
                      locale={locale}
                    />
                  )}
                </>
              ) : !figmaAssetUrl ? (
                renderUploadDropzone('figma', t.reportDetail.panels.uploadFigmaBtn, t.reportDetail.panels.missingFigmaImage)
              ) : (
                renderUploadDropzone('screen', t.reportDetail.panels.uploadScreenBtn, t.reportDetail.panels.missingScreenHtml)
              )}
            </div>
          </div>
        </section>
      )}

      {view === 'split' && (
        <section className="rd-panel">
          <div className="rd-panel-head">
            <h2>
              {t.reportDetail.views.split}: {t.reportDetail.panels.figma} (<RollingNumber value={splitPct} suffix="%" fast rollOnMount={false} />) | {t.reportDetail.panels.screen}
            </h2>
          </div>
          <div className="rd-scroll">
            <div
              ref={(node) => {
                refSingleStage(node);
                splitStageRef.current = node;
              }}
              className="rd-stage"
              style={{
                width: zoom !== 'fit' ? frameWidth * zoom : undefined,
                height: singleScale ? frameHeight * singleScale : undefined,
              }}
            >
              {figmaAssetUrl && (screenAssetUrl || screenHtmlUrl) ? (
                <div className="rd-media-frame">
                  <img
                    src={figmaAssetUrl}
                    alt={t.reportDetail.panels.figma}
                    style={{ clipPath: `inset(0 ${100 - splitPct}% 0 0)` }}
                    onLoad={(e) =>
                      setFigmaNatural({
                        width: e.currentTarget.naturalWidth,
                        height: e.currentTarget.naturalHeight,
                      })
                    }
                  />
                  <div
                    className="rd-split-layer"
                    style={{ clipPath: `inset(0 0 0 ${splitPct}%)` }}
                  >
                    {renderCompositeScreenLayer(singleScale)}
                  </div>
                  <div
                    className={`rd-split-handle${draggingSplit ? ' dragging' : ''}`}
                    style={{ left: `${splitPct}%` }}
                    onPointerDown={onSplitPointerDown}
                    onPointerMove={onSplitPointerMove}
                    onPointerUp={onSplitPointerUp}
                    onPointerCancel={onSplitPointerUp}
                  >
                    <div className="rd-split-line" />
                    <div className="rd-split-knob">↔</div>
                    <span className="rd-split-badge">
                      <RollingNumber value={splitPct} suffix="%" fast rollOnMount={false} />
                    </span>
                  </div>
                </div>
              ) : !figmaAssetUrl ? (
                renderUploadDropzone('figma', t.reportDetail.panels.uploadFigmaBtn, t.reportDetail.panels.missingFigmaImage)
              ) : (
                renderUploadDropzone('screen', t.reportDetail.panels.uploadScreenBtn, t.reportDetail.panels.missingScreenHtml)
              )}
            </div>
          </div>
        </section>
      )}

      {view === 'pixelDiff' && (
        <section className="rd-panel">
          <div className="rd-panel-head">
            <h2>{t.reportDetail.views.pixelDiff}</h2>
            {screenAssetUrl && (
              <label className="btn secondary small" style={{ position: 'relative', overflow: 'hidden' }}>
                {t.reportDetail.panels.uploadScreenBtn}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.currentTarget.value = '';
                    if (f) void uploadAsset('screen', f);
                  }}
                />
              </label>
            )}
          </div>
          <div className="rd-scroll">
            {!figmaAssetUrl ? (
              renderUploadDropzone('figma', t.reportDetail.panels.uploadFigmaBtn, t.reportDetail.panels.missingFigmaImage)
            ) : !screenAssetUrl ? (
              renderUploadDropzone(
                'screen',
                t.reportDetail.panels.uploadScreenBtn,
                t.reportDetail.panels.missingScreenForPixel,
              )
            ) : pixelLoading ? (
              <div className="rd-empty-box">{t.reportDetail.panels.computingPixelDiff}</div>
            ) : pixelError ? (
              <div className="rd-empty-box">{localizeMessage(pixelError, locale)}</div>
            ) : pixelDiff ? (
              <div
                className="rd-stage"
                style={zoom !== 'fit' ? { width: pixelDiff.figmaSize.width * zoom } : undefined}
              >
                <div className="rd-media-frame">
                  <img src={pixelDiff.diffDataUrl} alt={t.reportDetail.views.pixelDiff} />
                </div>
              </div>
            ) : null}
          </div>
        </section>
      )}

      <div className="rd-issues-bar">
        <div className="rd-issues-left">
          <h2 className="rd-issues-title">{t.reportDetail.sectionIssues}</h2>
          <div className="rd-segments" role="group">
            {(
              [
                ['differences', t.reportDetail.filters.differences, counts.fail],
                ['warnings', t.reportDetail.filters.warnings, counts.fail + counts.warn],
                ['all', t.reportDetail.filters.all, allRegions.length],
              ] as const
            ).map(([val, label, num]) => (
              <button
                key={val}
                type="button"
                className={filter === val ? 'active' : ''}
                onClick={() => {
                  setFilter(val);
                  setCategoryFilter('all');
                }}
              >
                {label} (<RollingNumber value={num} fast rollOnMount={false} />)
              </button>
            ))}
          </div>
          {filter !== 'all' && seenCounts.all > 0 && (
            <div className="rd-segments rd-seen" role="group" aria-label={t.reportDetail.seen.groupLabel} title={t.reportDetail.seen.hint}>
              {(
                [
                  ['visible', t.reportDetail.seen.visible, seenCounts.visible],
                  ['css', t.reportDetail.seen.css, seenCounts.css],
                  ['all', t.reportDetail.seen.all, seenCounts.all],
                ] as const
              ).map(([val, label, num]) => (
                <button key={val} type="button" className={seen === val ? 'active' : ''} onClick={() => setSeen(val)}>
                  {label} (<RollingNumber value={num} fast rollOnMount={false} />)
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rd-issues-right">
          <div className="rd-search-wrap">
            <span className="rd-search-icon">
              <IconSearch size={15} />
            </span>
            <input
              className="rd-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.reportDetail.filters.searchPlaceholder}
            />
            {search && (
              <button type="button" className="rd-search-clear" aria-label="Clear search" onClick={() => setSearch('')}>
                ✕
              </button>
            )}
          </div>
          <span className="rd-kbd-hint" title={t.reportDetail.controls.keyboardHint}>
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            <kbd>Esc</kbd>
          </span>
        </div>
      </div>

      {(activeCategoryCount > 1 || categoryFilter !== 'all') && (
        <div className="rd-cat-bar" role="group">
          <button
            type="button"
            className={`rd-cat-chip${categoryFilter === 'all' ? ' active' : ''}`}
            onClick={() => setCategoryFilter('all')}
          >
            <span>{t.reportDetail.categories.all}</span>
          </button>
          {categoryItems.map((cat) => {
            const count = categoryCounts[cat.id];
            if (count === 0) return null;
            const Icon = cat.icon;
            return (
              <button
                key={cat.id}
                type="button"
                className={`rd-cat-chip${categoryFilter === cat.id ? ' active' : ''}`}
                onClick={() => setCategoryFilter((cur) => (cur === cat.id ? 'all' : cat.id))}
              >
                <Icon size={13} />
                <span>
                  {cat.label} (<RollingNumber value={count} fast rollOnMount={false} />)
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="rd-list" ref={listRef}>
        {!displayedRegions.length && (
          <p className="notice ok" style={{ margin: '14px 18px' }}>
            {filter !== 'all' && seen === 'visible' && seenCounts.css > 0 && !search
              ? t.reportDetail.seen.emptyVisible
              : `${t.reportDetail.list.emptyFilter} ${filter === 'differences' && counts.fail === 0 ? t.reportDetail.list.allMatch : ''}`}
          </p>
        )}
        {displayedRegions.map(({ r, n, status, groupedRows }) => {
          const cssFix = generateCssFix(r.results);
          const regPass = r.results.filter((x) => x.status === 'pass').length;
          const regFail = r.results.filter((x) => x.status === 'fail').length;
          const regWarn = r.results.filter((x) => x.status !== 'pass' && x.status !== 'fail').length;
          const regionScore = computeMatchScore(regPass, regFail, regWarn);
          const [regionPre, regionPost] = t.reportDetail.list.regionMatch.split('{pct}');
          return (
            <div
              key={n}
              data-row={n}
              className={`rd-row ${status}${selected === n ? ' selected' : ''}${hovered === n ? ' hovered' : ''}`}
              role="button"
              tabIndex={0}
              onMouseEnter={() => setHovered(n)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => selectRegion(n)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  selectRegion(n);
                }
              }}
            >
              <span className={`rd-dot ${status}`}>{n}</span>
              <div className="rd-row-body">
                <div className="rd-row-head">
                  <div className="rd-row-tags">
                    <strong>{localizeMessage(r.name, locale)}</strong>
                    <span className={`badge ${status === 'pass' ? 'ok' : status}`}>{statusLabels[status]}</span>
                    {regionScore !== null && (
                      <span className={`badge ${regionScore === 100 ? 'ok' : regionScore >= 75 ? 'warn' : 'fail'}`}>
                        {regionPre}
                        <CountUp value={regionScore} />
                        {regionPost ?? ''}
                      </span>
                    )}
                    {r.state && <span className="badge">{r.state}</span>}
                    {!r.figmaRect && <span className="badge">{t.reportDetail.list.noFigmaCoords}</span>}
                    {!r.rect && <span className="badge warn">{t.reportDetail.list.notFoundOnScreen}</span>}
                  </div>
                  {cssFix && (
                    <button
                      type="button"
                      className={`btn secondary small${copiedKey === `css-${n}` ? ' copied' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void copyWithFeedback(`css-${n}`, cssFix);
                      }}
                    >
                      {copiedKey === `css-${n}` ? <IconCheck size={13} /> : <IconCopy size={13} />}
                      <span>{copiedKey === `css-${n}` ? t.reportDetail.list.cssCopied : t.reportDetail.list.copyCssFix}</span>
                    </button>
                  )}
                </div>
                <ul className="rd-prop-list">
                  {groupedRows.map((row) => {
                    const itemStatus = row.status === 'fail' ? 'fail' : row.status === 'pass' ? 'pass' : 'warn';
                    const expectedText = localizeMessage(row.expected, locale);
                    const actualText = localizeMessage(row.actual, locale);
                    const friendlyDelta = formatFriendlyDelta(row.delta, locale);

                    return (
                      <li key={row.key} className="rd-prop-item">
                        <span className={`rd-prop-icon ${itemStatus}`}>
                          {itemStatus === 'fail' ? (
                            <IconXCircle size={15} />
                          ) : itemStatus === 'warn' ? (
                            <IconAlertTriangle size={15} />
                          ) : (
                            <IconCheckCircle size={15} />
                          )}
                        </span>
                        <span className="rd-prop-label">{row.friendlyLabel}</span>
                        <code className="rd-prop-code">{row.codeTag}</code>

                        <span className="rd-prop-values">
                          <span className="rd-val-chip figma">
                            <span className="rd-val-tag">{t.reportDetail.expectedLabel}:</span>
                            <ColorSwatch value={expectedText} />
                            <strong>{expectedText}</strong>
                          </span>
                          <span aria-hidden="true" style={{ color: 'var(--muted)' }}>
                            →
                          </span>
                          <span className="rd-val-chip screen">
                            <span className="rd-val-tag">{t.reportDetail.actualLabel}:</span>
                            <ColorSwatch value={actualText} />
                            <strong>{actualText}</strong>
                          </span>
                        </span>

                        {friendlyDelta && <span className="rd-delta-pill">{friendlyDelta}</span>}
                        {row.visibility === 'css' && (
                          <span className="badge rd-css-only" title={t.reportDetail.seen.hint}>
                            {t.reportDetail.seen.badge}
                          </span>
                        )}
                        {row.note && (
                          <span className="notice" style={{ margin: 0 }}>
                            — {localizeMessage(row.note, locale)}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
