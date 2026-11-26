/**
 * A report's output stock drawn to proportion: a label size in the report name ("4x6", "4 x 6")
 * becomes a small label of that shape with barcode bars; anything else is a document page.
 */
export type PaperFormat = { kind: "label"; width: number; height: number; text: string } | { kind: "document"; text: string };

export function paperFormat(name: string): PaperFormat {
  const match = name.match(/(?:^|[^\d.])(\d{1,2}(?:\.\d+)?)\s*[x×]\s*(\d{1,2}(?:\.\d+)?)(?![\d.])/i);
  const width = match ? Number(match[1]) : 0;
  const height = match ? Number(match[2]) : 0;
  if (width > 0 && height > 0 && width <= 24 && height <= 24)
    return { kind: "label", width, height, text: `${match![1]} × ${match![2]} in label` };
  return { kind: "document", text: "Document" };
}

export function ReportGlyph({ name, size = 32 }: { name: string; size?: number }) {
  const format = paperFormat(name);
  if (format.kind === "document") {
    return <svg className="report-glyph-art document" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path className="stock" d="M8.5 3.5h10.5l5.5 5.5v19.5h-16z" />
      <path className="fold" d="M19 3.5v5.5h5.5" />
      <path className="ink" d="M12 14h9M12 18h9M12 22h6" />
    </svg>;
  }
  // Fit the label's proportions inside a 24 × 26 frame, centred.
  const scale = Math.min(24 / format.width, 26 / format.height);
  const w = format.width * scale;
  const h = format.height * scale;
  const x = (32 - w) / 2;
  const y = (32 - h) / 2;
  const bars = [0, 2, 3, 5, 7, 8, 10, 12, 13, 15];
  const barTop = y + h * 0.56;
  const barHeight = h * 0.28;
  const barStart = x + w * 0.18;
  const barUnit = (w * 0.64) / 16;
  return <svg className="report-glyph-art label" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect className="stock" x={x} y={y} width={w} height={h} rx={2.2} />
    <path className="ink" d={`M${x + w * 0.18} ${y + h * 0.24}h${w * 0.5}M${x + w * 0.18} ${y + h * 0.38}h${w * 0.34}`} />
    {bars.map(bar => <rect key={bar} className="bar" x={barStart + bar * barUnit} y={barTop}
      width={bar % 3 === 0 ? barUnit * 1.2 : barUnit * 0.6} height={barHeight} />)}
  </svg>;
}
