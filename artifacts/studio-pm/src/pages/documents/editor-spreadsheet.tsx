import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import Papa from "papaparse";

function useCellValue(ymap: Y.Map<string>, key: string): [string, (v: string) => void] {
  const [val, setVal] = useState<string>(() => ymap.get(key) ?? "");
  useEffect(() => {
    setVal(ymap.get(key) ?? "");
    const handler = (event: Y.YMapEvent<string>) => {
      if (event.keysChanged.has(key)) setVal(ymap.get(key) ?? "");
    };
    ymap.observe(handler);
    return () => ymap.unobserve(handler);
  }, [ymap, key]);
  return [val, (v: string) => ymap.set(key, v)];
}

function Cell({ ymap, r, c }: { ymap: Y.Map<string>; r: number; c: number }) {
  const key = `${r}:${c}`;
  const [val, setVal] = useCellValue(ymap, key);
  return (
    <input
      value={val}
      onChange={(e) => setVal(e.target.value)}
      className="w-full h-7 px-2 bg-transparent border-0 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary focus:bg-primary/5"
      spellCheck={false}
    />
  );
}

function colLabel(c: number): string {
  // 0 → A, 25 → Z, 26 → AA, ...
  let s = "";
  let n = c;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function SpreadsheetEditor({
  ydoc,
  seedText,
}: {
  ydoc: Y.Doc;
  seedText: string | null;
}) {
  const ymap = useMemo(() => ydoc.getMap<string>("cells"), [ydoc]);
  const meta = useMemo(() => ydoc.getMap<string>("meta"), [ydoc]);

  const [dims, setDims] = useState(() => ({
    rows: parseInt(meta.get("rows") ?? "0", 10) || 0,
    cols: parseInt(meta.get("cols") ?? "0", 10) || 0,
  }));

  // Track meta changes from any client
  useEffect(() => {
    const handler = () => {
      setDims({
        rows: parseInt(meta.get("rows") ?? "0", 10) || 0,
        cols: parseInt(meta.get("cols") ?? "0", 10) || 0,
      });
    };
    meta.observe(handler);
    return () => meta.unobserve(handler);
  }, [meta]);

  // Seed CSV text into cells on first open (server-side atomicity ensures one-time)
  useEffect(() => {
    if (!seedText) return;
    if (ymap.size > 0) return;
    const parsed = Papa.parse<string[]>(seedText, { skipEmptyLines: false });
    const rows = parsed.data.filter(r => Array.isArray(r));
    let maxCols = 0;
    ydoc.transact(() => {
      rows.forEach((row, r) => {
        row.forEach((cell, c) => {
          if (cell !== "" && cell != null) ymap.set(`${r}:${c}`, String(cell));
          if (c + 1 > maxCols) maxCols = c + 1;
        });
      });
      meta.set("rows", String(rows.length));
      meta.set("cols", String(maxCols));
    });
  }, [seedText, ymap, meta, ydoc]);

  const displayRows = Math.max(dims.rows + 5, 25);
  const displayCols = Math.max(dims.cols + 2, 10);

  function addRows(n: number) {
    meta.set("rows", String(dims.rows + n));
  }
  function addCols(n: number) {
    meta.set("cols", String(dims.cols + n));
  }

  function exportCsv() {
    const rowsOut: string[][] = [];
    for (let r = 0; r < dims.rows; r++) {
      const row: string[] = [];
      for (let c = 0; c < dims.cols; c++) {
        row.push(ymap.get(`${r}:${c}`) ?? "");
      }
      rowsOut.push(row);
    }
    const csv = Papa.unparse(rowsOut);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "export.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-2">
        <button
          onClick={() => addRows(10)}
          className="text-[11px] font-mono text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:bg-muted"
        >
          + 10 rows
        </button>
        <button
          onClick={() => addCols(3)}
          className="text-[11px] font-mono text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:bg-muted"
        >
          + 3 columns
        </button>
        <span className="text-[11px] font-mono text-muted-foreground ml-auto">
          {dims.rows} rows × {dims.cols} cols
        </span>
        <button
          onClick={exportCsv}
          className="text-[11px] font-mono text-primary hover:text-primary/80 px-2 py-1 rounded border border-primary/40 hover:bg-primary/10"
        >
          Export CSV
        </button>
      </div>

      <div className="overflow-auto bg-card border border-border rounded-lg max-h-[70vh]">
        <table className="border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="bg-muted border border-border w-12 h-7 text-[10px] font-mono text-muted-foreground sticky left-0 z-20" />
              {Array.from({ length: displayCols }, (_, c) => (
                <th
                  key={c}
                  className="bg-muted border border-border h-7 px-2 text-[10px] font-mono text-muted-foreground min-w-[140px] text-center"
                >
                  {colLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: displayRows }, (_, r) => (
              <tr key={r}>
                <td className="bg-muted/60 border border-border w-12 h-7 px-2 text-[10px] font-mono text-muted-foreground text-center sticky left-0 z-10">
                  {r + 1}
                </td>
                {Array.from({ length: displayCols }, (_, c) => (
                  <td key={c} className="border border-border/40 p-0 h-7">
                    <Cell ymap={ymap} r={r} c={c} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
