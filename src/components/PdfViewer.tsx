import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minus, Plus } from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

/** pdf.js is loaded the first time a report is shown, not with the rest of the app. */
async function loadPdfJs() {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

type Size = { width: number; height: number };
const zoomSteps = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/**
 * The report's pages drawn on a quiet canvas, with a slim toolbar (page, zoom, fit to width) in the
 * app's own style instead of the browser's PDF viewer. Pages are drawn as they scroll into view, so
 * long runs of labels stay quick.
 */
export function PdfViewer({ url, title }: { url: string; title: string }) {
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [sizes, setSizes] = useState<Size[]>([]);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [current, setCurrent] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | undefined;
    setDocument(undefined);
    setFailed(false);
    void loadPdfJs().then(pdfjs => pdfjs.getDocument({ url }).promise).then(async pdf => {
      loaded = pdf;
      // Every page's size up front, so the scroll height is right before any page is drawn.
      const all = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
        const viewport = (await pdf.getPage(index + 1)).getViewport({ scale: 1 });
        return { width: viewport.width, height: viewport.height };
      }));
      if (cancelled) return;
      setSizes(all);
      setDocument(pdf);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; void loaded?.destroy(); };
  }, [url]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setArea({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // "Fit" fills the width, but a small page such as a 4 x 6 label is shown whole rather than blown up;
  // a full-size document never opens below 100%.
  const widest = Math.max(1, ...sizes.map(size => size.width));
  const tallest = Math.max(1, ...sizes.map(size => size.height));
  const byWidth = area.width ? (area.width - 48) / widest : 1;
  const byHeight = area.height ? (area.height - 48) / tallest : 1;
  const fitScale = Math.min(Math.max(Math.min(byWidth, Math.max(byHeight, 1)), 0.25), 2);
  const scale = zoom === "fit" ? fitScale : zoom;

  // The page number follows whichever page fills most of the view.
  useEffect(() => {
    const root = scroller.current;
    if (!root || !document) return;
    const visible = new Map<number, number>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) visible.set(Number((entry.target as HTMLElement).dataset.page), entry.intersectionRatio);
      const best = [...visible.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] > 0) setCurrent(best[0]);
    }, { root, threshold: [0, 0.25, 0.5, 0.75, 1] });
    pageRefs.current.forEach(page => page && observer.observe(page));
    return () => observer.disconnect();
  }, [document, scale]);

  const goTo = (page: number) => {
    const target = Math.min(Math.max(page, 1), sizes.length);
    pageRefs.current[target - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const step = (direction: 1 | -1) => {
    const now = scale;
    const next = direction > 0 ? zoomSteps.find(value => value > now + 0.01) : [...zoomSteps].reverse().find(value => value < now - 0.01);
    if (next) setZoom(next);
  };

  return <div className="pdfv">
    <div className="pdfv-toolbar" role="toolbar" aria-label={`${title} pages`}>
      <div className="pdfv-group">
        <button type="button" className="pdfv-button" aria-label="Previous page" disabled={!document || current <= 1}
          onClick={() => goTo(current - 1)}><ChevronLeft size={16} /></button>
        <span className="pdfv-pages" aria-live="polite">
          {document ? <>Page <strong>{current}</strong> of {sizes.length}</> : "Loading…"}</span>
        <button type="button" className="pdfv-button" aria-label="Next page" disabled={!document || current >= sizes.length}
          onClick={() => goTo(current + 1)}><ChevronRight size={16} /></button>
      </div>
      <div className="pdfv-group">
        <button type="button" className="pdfv-button" aria-label="Zoom out" disabled={!document || scale <= zoomSteps[0]}
          onClick={() => step(-1)}><Minus size={15} /></button>
        <span className="pdfv-zoom">{Math.round(scale * 100)}%</span>
        <button type="button" className="pdfv-button" aria-label="Zoom in" disabled={!document || scale >= zoomSteps.at(-1)!}
          onClick={() => step(1)}><Plus size={15} /></button>
        <button type="button" className={`pdfv-button pdfv-fit${zoom === "fit" ? " active" : ""}`} aria-pressed={zoom === "fit"}
          disabled={!document} onClick={() => setZoom("fit")}><Maximize2 size={14} /> Fit</button>
      </div>
    </div>
    <div className="pdfv-canvas" ref={scroller} tabIndex={0} aria-label={`${title}, ${sizes.length || ""} pages`}>
      {failed ? <p className="pdfv-message">The pages couldn't be shown here. Use PDF to download the report instead.</p>
        : !document ? <div className="pdfv-opening" role="status">
            <div className="pdfv-loading" aria-hidden="true"><span /></div>
            <p>Opening the pages…</p>
          </div>
        : sizes.map((size, index) => <div key={index} className="pdfv-page" data-page={index + 1}
            ref={element => { pageRefs.current[index] = element; }}
            style={{ width: size.width * scale, height: size.height * scale }}>
            <PdfPage document={document} number={index + 1} scale={scale} root={scroller} />
          </div>)}
    </div>
  </div>;
}

function PdfPage({ document, number, scale, root }: {
  document: PDFDocumentProxy; number: number; scale: number; root: React.RefObject<HTMLDivElement | null>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = canvas.current?.parentElement;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setNear(true); },
      { root: root.current, rootMargin: "800px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);
  const ratio = useMemo(() => Math.min(window.devicePixelRatio || 1, 2), []);
  useEffect(() => {
    if (!near) return;
    let task: RenderTask | undefined;
    let cancelled = false;
    void document.getPage(number).then(page => {
      const target = canvas.current;
      if (cancelled || !target) return;
      const viewport = page.getViewport({ scale: scale * ratio });
      target.width = Math.floor(viewport.width);
      target.height = Math.floor(viewport.height);
      task = page.render({ canvasContext: target.getContext("2d")!, viewport });
      return task.promise;
    }).catch(() => undefined);
    return () => { cancelled = true; task?.cancel(); };
  }, [document, number, scale, near, ratio]);
  return <canvas ref={canvas} className="pdfv-sheet" aria-label={`Page ${number}`} role="img" />;
}
