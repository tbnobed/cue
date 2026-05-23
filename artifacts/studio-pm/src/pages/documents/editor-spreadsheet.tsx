import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import Papa from "papaparse";
import {
  Bold, Italic, Underline as UnderlineIcon,
  AlignLeft, AlignCenter, AlignRight,
  Undo2, Redo2, Trash2, Sigma,
  ArrowUpDown, ArrowUp, ArrowDown,
  Plus, Minus, Download,
  DollarSign, Percent, Hash, Calendar,
  Palette, Type,
} from "lucide-react";

// ───────────────────────────────────────────────────────────────────────────
// Types and helpers
// ───────────────────────────────────────────────────────────────────────────

type CellFmt = {
  b?: 1;       // bold
  i?: 1;       // italic
  u?: 1;       // underline
  a?: "l" | "c" | "r"; // align
  bg?: string; // background color
  fg?: string; // text color
  nf?: "num" | "cur" | "pct" | "date"; // number format
};

function key(r: number, c: number): string { return `${r}:${c}`; }
function parseKey(k: string): [number, number] {
  const [r, c] = k.split(":").map(Number);
  return [r, c];
}

function colLabel(c: number): string {
  let s = ""; let n = c;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

function colFromLabel(s: string): number {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function cellRef(r: number, c: number): string { return `${colLabel(c)}${r + 1}`; }

function parseCellRef(ref: string): [number, number] | null {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref.trim());
  if (!m) return null;
  return [parseInt(m[2], 10) - 1, colFromLabel(m[1])];
}

// ── Formula evaluator (small spreadsheet language) ─────────────────────────

function getNumeric(getRaw: (r: number, c: number) => string, r: number, c: number): number | null {
  const v = evalCell(getRaw, r, c, new Set());
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }
  return null;
}

function collectRange(getRaw: (r: number, c: number) => string, a: string, b: string): number[] {
  const A = parseCellRef(a); const B = parseCellRef(b);
  if (!A || !B) return [];
  const [r1, c1] = A; const [r2, c2] = B;
  const out: number[] = [];
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
      const n = getNumeric(getRaw, r, c);
      if (n !== null) out.push(n);
    }
  }
  return out;
}

function evalExpr(getRaw: (r: number, c: number) => string, expr: string, stack: Set<string>): number | string {
  // Replace function calls first: SUM(A1:B3), AVG/AVERAGE, MIN, MAX, COUNT
  const fnRe = /(SUM|AVERAGE|AVG|MIN|MAX|COUNT)\s*\(\s*([A-Z]+\d+)\s*:\s*([A-Z]+\d+)\s*\)/gi;
  expr = expr.replace(fnRe, (_m, fn: string, a: string, b: string) => {
    const nums = collectRange(getRaw, a, b);
    let v = 0;
    switch (fn.toUpperCase()) {
      case "SUM": v = nums.reduce((s, n) => s + n, 0); break;
      case "AVERAGE":
      case "AVG": v = nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0; break;
      case "MIN": v = nums.length ? Math.min(...nums) : 0; break;
      case "MAX": v = nums.length ? Math.max(...nums) : 0; break;
      case "COUNT": v = nums.length; break;
    }
    return `(${v})`;
  });
  // Replace cell refs with their numeric values
  expr = expr.replace(/[A-Z]+\d+/gi, (ref) => {
    const pos = parseCellRef(ref);
    if (!pos) return "0";
    const k = key(pos[0], pos[1]);
    if (stack.has(k)) return "0";
    const n = getNumeric(getRaw, pos[0], pos[1]);
    return n === null ? "0" : `(${n})`;
  });
  // Sanitize: only allow digits, ops, parens, dots, spaces
  if (!/^[\d+\-*/().,\s]+$/.test(expr)) return "#ERR";
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict"; return (${expr});`);
    const r = fn();
    if (typeof r === "number" && isFinite(r)) return r;
    return "#ERR";
  } catch {
    return "#ERR";
  }
}

function evalCell(getRaw: (r: number, c: number) => string, r: number, c: number, stack: Set<string>): string | number {
  const raw = getRaw(r, c);
  if (!raw) return "";
  if (!raw.startsWith("=")) return raw;
  const k = key(r, c);
  if (stack.has(k)) return "#CYCLE";
  stack.add(k);
  const result = evalExpr(getRaw, raw.slice(1), stack);
  stack.delete(k);
  return result;
}

function formatNumber(n: number, fmt: CellFmt["nf"]): string {
  if (fmt === "cur") return "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (fmt === "pct") return (n * 100).toFixed(2) + "%";
  if (fmt === "num") return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (fmt === "date") {
    const d = new Date(n);
    return isNaN(d.getTime()) ? String(n) : d.toLocaleDateString();
  }
  // General: trim trailing zeros
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(10)));
}

function displayValue(getRaw: (r: number, c: number) => string, r: number, c: number, fmt: CellFmt | null): string {
  const v = evalCell(getRaw, r, c, new Set());
  if (typeof v === "number") return formatNumber(v, fmt?.nf);
  return String(v);
}

// ───────────────────────────────────────────────────────────────────────────
// Main editor
// ───────────────────────────────────────────────────────────────────────────

const FILL_PALETTE = [
  "", "#7f1d1d", "#9a3412", "#854d0e", "#3f6212", "#065f46",
  "#155e75", "#1e3a8a", "#581c87", "#831843", "#3f3f46", "#0a0a0a",
];
const TEXT_PALETTE = [
  "", "#fecaca", "#fed7aa", "#fef08a", "#bef264", "#86efac",
  "#5eead4", "#93c5fd", "#c4b5fd", "#f9a8d4", "#e5e7eb", "#ffffff",
];

export function SpreadsheetEditor({
  ydoc,
  seedText,
}: {
  ydoc: Y.Doc;
  seedText: string | null;
}) {
  const ymap = useMemo(() => ydoc.getMap<string>("cells"), [ydoc]);
  const yfmt = useMemo(() => ydoc.getMap<string>("fmt"), [ydoc]);
  const meta = useMemo(() => ydoc.getMap<string>("meta"), [ydoc]);

  // Re-render trigger when any cell or format changes (lightweight; we read map on render)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick(t => t + 1);
    ymap.observe(h); yfmt.observe(h); meta.observe(h);
    return () => { ymap.unobserve(h); yfmt.unobserve(h); meta.unobserve(h); };
  }, [ymap, yfmt, meta]);

  const getRaw = useCallback((r: number, c: number) => ymap.get(key(r, c)) ?? "", [ymap, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const getFmt = useCallback((r: number, c: number): CellFmt | null => {
    const v = yfmt.get(key(r, c));
    if (!v) return null;
    try { return JSON.parse(v) as CellFmt; } catch { return null; }
  }, [yfmt, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Seed CSV on first open ──────────────────────────────────────────────
  useEffect(() => {
    if (!seedText) return;
    if (ymap.size > 0) return;
    const parsed = Papa.parse<string[]>(seedText, { skipEmptyLines: false });
    const rows = parsed.data.filter(r => Array.isArray(r));
    let maxCols = 0;
    ydoc.transact(() => {
      rows.forEach((row, r) => {
        row.forEach((cell, c) => {
          if (cell !== "" && cell != null) ymap.set(key(r, c), String(cell));
          if (c + 1 > maxCols) maxCols = c + 1;
        });
      });
      meta.set("rows", String(rows.length));
      meta.set("cols", String(maxCols));
    });
  }, [seedText, ymap, meta, ydoc]);

  const dataRows = parseInt(meta.get("rows") ?? "0", 10) || 0;
  const dataCols = parseInt(meta.get("cols") ?? "0", 10) || 0;
  const displayRows = Math.max(dataRows + 5, 30);
  const displayCols = Math.max(dataCols + 2, 12);

  // ── Selection state ─────────────────────────────────────────────────────
  const [sel, setSel] = useState({ r1: 0, c1: 0, r2: 0, c2: 0 });
  const [editing, setEditing] = useState<{ r: number; c: number; value: string } | null>(null);
  const dragRef = useRef<{ anchor: [number, number] } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const active = { r: sel.r1, c: sel.c1 };
  const range = {
    r1: Math.min(sel.r1, sel.r2), r2: Math.max(sel.r1, sel.r2),
    c1: Math.min(sel.c1, sel.c2), c2: Math.max(sel.c1, sel.c2),
  };

  function selectOne(r: number, c: number) {
    setSel({ r1: r, c1: c, r2: r, c2: c });
    setEditing(null);
  }
  function extendTo(r: number, c: number) {
    setSel(s => ({ ...s, r2: r, c2: c }));
  }

  // ── Cell ops ────────────────────────────────────────────────────────────
  function commitEdit() {
    if (!editing) return;
    const k = key(editing.r, editing.c);
    if (editing.value === "") ymap.delete(k);
    else ymap.set(k, editing.value);
    setEditing(null);
  }

  function setCell(r: number, c: number, value: string) {
    const k = key(r, c);
    if (value === "") ymap.delete(k);
    else ymap.set(k, value);
  }

  function setFmt(r: number, c: number, patch: Partial<CellFmt>) {
    const k = key(r, c);
    const cur = getFmt(r, c) ?? {};
    const next: CellFmt = { ...cur, ...patch };
    // Clean falsy
    (Object.keys(next) as Array<keyof CellFmt>).forEach((kk) => {
      if (next[kk] === undefined || next[kk] === "") delete next[kk];
    });
    if (Object.keys(next).length === 0) yfmt.delete(k);
    else yfmt.set(k, JSON.stringify(next));
  }

  function applyToSelection(patch: Partial<CellFmt>, toggle?: keyof CellFmt) {
    ydoc.transact(() => {
      // Decide toggle state from active cell
      let effective = patch;
      if (toggle) {
        const cur = getFmt(active.r, active.c);
        const isOn = cur && cur[toggle];
        effective = { [toggle]: isOn ? undefined : (patch[toggle] ?? 1) } as Partial<CellFmt>;
      }
      for (let r = range.r1; r <= range.r2; r++) {
        for (let c = range.c1; c <= range.c2; c++) {
          setFmt(r, c, effective);
        }
      }
    });
  }

  function clearSelection() {
    ydoc.transact(() => {
      for (let r = range.r1; r <= range.r2; r++) {
        for (let c = range.c1; c <= range.c2; c++) {
          ymap.delete(key(r, c));
        }
      }
    });
  }

  function insertRow(at: number) {
    ydoc.transact(() => {
      // shift rows >= at down by 1
      const keys = Array.from(ymap.keys());
      const cellMoves: Array<[string, string, string]> = [];
      const fmtMoves: Array<[string, string, string]> = [];
      keys.forEach(k => {
        const [r, c] = parseKey(k);
        if (r >= at) {
          const v = ymap.get(k)!;
          cellMoves.push([k, key(r + 1, c), v]);
        }
      });
      Array.from(yfmt.keys()).forEach(k => {
        const [r, c] = parseKey(k);
        if (r >= at) {
          const v = yfmt.get(k)!;
          fmtMoves.push([k, key(r + 1, c), v]);
        }
      });
      // delete then set (deepest first to avoid overwriting)
      cellMoves.sort((a, b) => parseKey(b[0])[0] - parseKey(a[0])[0]);
      cellMoves.forEach(([oldK, newK, v]) => { ymap.delete(oldK); ymap.set(newK, v); });
      fmtMoves.sort((a, b) => parseKey(b[0])[0] - parseKey(a[0])[0]);
      fmtMoves.forEach(([oldK, newK, v]) => { yfmt.delete(oldK); yfmt.set(newK, v); });
      meta.set("rows", String(dataRows + 1));
    });
  }

  function deleteRow(at: number) {
    if (dataRows === 0) return;
    ydoc.transact(() => {
      const keys = Array.from(ymap.keys());
      const cellMoves: Array<[string, string | null, string | null]> = [];
      keys.forEach(k => {
        const [r, c] = parseKey(k);
        if (r === at) cellMoves.push([k, null, null]);
        else if (r > at) cellMoves.push([k, key(r - 1, c), ymap.get(k)!]);
      });
      cellMoves.sort((a, b) => parseKey(a[0])[0] - parseKey(b[0])[0]);
      cellMoves.forEach(([oldK, newK, v]) => {
        ymap.delete(oldK);
        if (newK && v !== null) ymap.set(newK, v);
      });
      const fmtKeys = Array.from(yfmt.keys());
      const fmtMoves: Array<[string, string | null, string | null]> = [];
      fmtKeys.forEach(k => {
        const [r, c] = parseKey(k);
        if (r === at) fmtMoves.push([k, null, null]);
        else if (r > at) fmtMoves.push([k, key(r - 1, c), yfmt.get(k)!]);
      });
      fmtMoves.sort((a, b) => parseKey(a[0])[0] - parseKey(b[0])[0]);
      fmtMoves.forEach(([oldK, newK, v]) => {
        yfmt.delete(oldK);
        if (newK && v !== null) yfmt.set(newK, v);
      });
      meta.set("rows", String(Math.max(0, dataRows - 1)));
    });
  }

  function insertCol(at: number) {
    ydoc.transact(() => {
      const keys = Array.from(ymap.keys());
      const moves: Array<[string, string, string]> = [];
      keys.forEach(k => {
        const [r, c] = parseKey(k);
        if (c >= at) moves.push([k, key(r, c + 1), ymap.get(k)!]);
      });
      moves.sort((a, b) => parseKey(b[0])[1] - parseKey(a[0])[1]);
      moves.forEach(([oldK, newK, v]) => { ymap.delete(oldK); ymap.set(newK, v); });
      const fmtMoves: Array<[string, string, string]> = [];
      Array.from(yfmt.keys()).forEach(k => {
        const [r, c] = parseKey(k);
        if (c >= at) fmtMoves.push([k, key(r, c + 1), yfmt.get(k)!]);
      });
      fmtMoves.sort((a, b) => parseKey(b[0])[1] - parseKey(a[0])[1]);
      fmtMoves.forEach(([oldK, newK, v]) => { yfmt.delete(oldK); yfmt.set(newK, v); });
      meta.set("cols", String(dataCols + 1));
    });
  }

  function deleteCol(at: number) {
    if (dataCols === 0) return;
    ydoc.transact(() => {
      const moves: Array<[string, string | null, string | null]> = [];
      Array.from(ymap.keys()).forEach(k => {
        const [r, c] = parseKey(k);
        if (c === at) moves.push([k, null, null]);
        else if (c > at) moves.push([k, key(r, c - 1), ymap.get(k)!]);
      });
      moves.sort((a, b) => parseKey(a[0])[1] - parseKey(b[0])[1]);
      moves.forEach(([oldK, newK, v]) => { ymap.delete(oldK); if (newK && v !== null) ymap.set(newK, v); });
      const fmtMoves: Array<[string, string | null, string | null]> = [];
      Array.from(yfmt.keys()).forEach(k => {
        const [r, c] = parseKey(k);
        if (c === at) fmtMoves.push([k, null, null]);
        else if (c > at) fmtMoves.push([k, key(r, c - 1), yfmt.get(k)!]);
      });
      fmtMoves.sort((a, b) => parseKey(a[0])[1] - parseKey(b[0])[1]);
      fmtMoves.forEach(([oldK, newK, v]) => { yfmt.delete(oldK); if (newK && v !== null) yfmt.set(newK, v); });
      meta.set("cols", String(Math.max(0, dataCols - 1)));
    });
  }

  function sortByColumn(col: number, dir: "asc" | "desc") {
    if (dataRows < 2) return;
    // Assume row 0 is header; sort rows 1..dataRows-1 by col
    const rows: Array<{ data: Record<number, string>; fmt: Record<number, string> }> = [];
    for (let r = 1; r < dataRows; r++) {
      const data: Record<number, string> = {};
      const fmt: Record<number, string> = {};
      for (let c = 0; c < dataCols; c++) {
        const v = ymap.get(key(r, c));
        if (v !== undefined) data[c] = v;
        const f = yfmt.get(key(r, c));
        if (f !== undefined) fmt[c] = f;
      }
      rows.push({ data, fmt });
    }
    rows.sort((a, b) => {
      const av = a.data[col] ?? "";
      const bv = b.data[col] ?? "";
      const an = parseFloat(av); const bn = parseFloat(bv);
      let cmp: number;
      if (!isNaN(an) && !isNaN(bn)) cmp = an - bn;
      else cmp = av.localeCompare(bv);
      return dir === "asc" ? cmp : -cmp;
    });
    ydoc.transact(() => {
      // clear rows 1..dataRows-1
      for (let r = 1; r < dataRows; r++) {
        for (let c = 0; c < dataCols; c++) {
          ymap.delete(key(r, c));
          yfmt.delete(key(r, c));
        }
      }
      rows.forEach((row, i) => {
        const r = i + 1;
        Object.entries(row.data).forEach(([c, v]) => ymap.set(key(r, parseInt(c, 10)), v));
        Object.entries(row.fmt).forEach(([c, v]) => yfmt.set(key(r, parseInt(c, 10)), v));
      });
    });
  }

  // ── Keyboard handling ───────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (editing) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const r = active.r; const c = active.c;
      switch (e.key) {
        case "ArrowUp":    selectOne(Math.max(0, r - 1), c); e.preventDefault(); break;
        case "ArrowDown":  selectOne(Math.min(displayRows - 1, r + 1), c); e.preventDefault(); break;
        case "ArrowLeft":  selectOne(r, Math.max(0, c - 1)); e.preventDefault(); break;
        case "ArrowRight":
        case "Tab":        selectOne(r, Math.min(displayCols - 1, c + 1)); e.preventDefault(); break;
        case "Enter":      setEditing({ r, c, value: getRaw(r, c) }); e.preventDefault(); break;
        case "Delete":
        case "Backspace":  clearSelection(); e.preventDefault(); break;
        case "F2":         setEditing({ r, c, value: getRaw(r, c) }); e.preventDefault(); break;
        default:
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            setEditing({ r, c, value: e.key });
            e.preventDefault();
          }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, active.r, active.c, displayRows, displayCols, getRaw]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Status bar stats ────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const nums: number[] = [];
    let count = 0;
    for (let r = range.r1; r <= range.r2; r++) {
      for (let c = range.c1; c <= range.c2; c++) {
        const v = evalCell(getRaw, r, c, new Set());
        if (v !== "" && v !== "#ERR" && v !== "#CYCLE") count++;
        if (typeof v === "number") nums.push(v);
        else if (typeof v === "string") { const n = parseFloat(v); if (!isNaN(n)) nums.push(n); }
      }
    }
    const sum = nums.reduce((s, n) => s + n, 0);
    const avg = nums.length ? sum / nums.length : 0;
    return { count, sum, avg, numCount: nums.length };
  }, [range.r1, range.r2, range.c1, range.c2, getRaw]);

  // ── Export ──────────────────────────────────────────────────────────────
  function exportCsv() {
    const rowsOut: string[][] = [];
    for (let r = 0; r < dataRows; r++) {
      const row: string[] = [];
      for (let c = 0; c < dataCols; c++) {
        const v = evalCell(getRaw, r, c, new Set());
        row.push(typeof v === "number" ? String(v) : String(v));
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

  // ── Formula bar handling ────────────────────────────────────────────────
  const activeRaw = getRaw(active.r, active.c);
  const [fbValue, setFbValue] = useState(activeRaw);
  const [fbEditing, setFbEditing] = useState(false);
  useEffect(() => { if (!fbEditing) setFbValue(activeRaw); }, [activeRaw, fbEditing]);

  // ── Color picker popovers ───────────────────────────────────────────────
  const [openPicker, setOpenPicker] = useState<null | "bg" | "fg">(null);

  // ── Render ──────────────────────────────────────────────────────────────
  const activeFmt = getFmt(active.r, active.c);

  return (
    <div className="space-y-0 select-none" onClick={() => setOpenPicker(null)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 p-1.5 bg-card border border-border rounded-t-lg">
        {/* Undo/redo (no-op for now; Yjs has built-in undo manager support later) */}
        <ToolGroup>
          <ToolBtn title="Undo (coming soon)" disabled><Undo2 className="w-3.5 h-3.5" /></ToolBtn>
          <ToolBtn title="Redo (coming soon)" disabled><Redo2 className="w-3.5 h-3.5" /></ToolBtn>
        </ToolGroup>

        {/* Text formatting */}
        <ToolGroup>
          <ToolBtn title="Bold (Ctrl+B)" active={!!activeFmt?.b}
            onClick={() => applyToSelection({ b: 1 }, "b")}><Bold className="w-3.5 h-3.5" /></ToolBtn>
          <ToolBtn title="Italic" active={!!activeFmt?.i}
            onClick={() => applyToSelection({ i: 1 }, "i")}><Italic className="w-3.5 h-3.5" /></ToolBtn>
          <ToolBtn title="Underline" active={!!activeFmt?.u}
            onClick={() => applyToSelection({ u: 1 }, "u")}><UnderlineIcon className="w-3.5 h-3.5" /></ToolBtn>
        </ToolGroup>

        {/* Colors */}
        <ToolGroup>
          <div className="relative" onClick={e => e.stopPropagation()}>
            <ToolBtn title="Fill color" onClick={() => setOpenPicker(p => p === "bg" ? null : "bg")}>
              <Palette className="w-3.5 h-3.5" />
            </ToolBtn>
            {openPicker === "bg" && (
              <ColorPicker palette={FILL_PALETTE} onPick={(c) => { applyToSelection({ bg: c }); setOpenPicker(null); }} />
            )}
          </div>
          <div className="relative" onClick={e => e.stopPropagation()}>
            <ToolBtn title="Text color" onClick={() => setOpenPicker(p => p === "fg" ? null : "fg")}>
              <Type className="w-3.5 h-3.5" />
            </ToolBtn>
            {openPicker === "fg" && (
              <ColorPicker palette={TEXT_PALETTE} onPick={(c) => { applyToSelection({ fg: c }); setOpenPicker(null); }} />
            )}
          </div>
        </ToolGroup>

        {/* Alignment */}
        <ToolGroup>
          <ToolBtn title="Align left" active={activeFmt?.a === "l" || (!activeFmt?.a)}
            onClick={() => applyToSelection({ a: "l" })}><AlignLeft className="w-3.5 h-3.5" /></ToolBtn>
          <ToolBtn title="Align center" active={activeFmt?.a === "c"}
            onClick={() => applyToSelection({ a: "c" })}><AlignCenter className="w-3.5 h-3.5" /></ToolBtn>
          <ToolBtn title="Align right" active={activeFmt?.a === "r"}
            onClick={() => applyToSelection({ a: "r" })}><AlignRight className="w-3.5 h-3.5" /></ToolBtn>
        </ToolGroup>

        {/* Number formats */}
        <ToolGroup>
          <ToolBtn title="Number" active={activeFmt?.nf === "num"}
            onClick={() => applyToSelection({ nf: activeFmt?.nf === "num" ? undefined : "num" })}>
            <Hash className="w-3.5 h-3.5" />
          </ToolBtn>
          <ToolBtn title="Currency" active={activeFmt?.nf === "cur"}
            onClick={() => applyToSelection({ nf: activeFmt?.nf === "cur" ? undefined : "cur" })}>
            <DollarSign className="w-3.5 h-3.5" />
          </ToolBtn>
          <ToolBtn title="Percent" active={activeFmt?.nf === "pct"}
            onClick={() => applyToSelection({ nf: activeFmt?.nf === "pct" ? undefined : "pct" })}>
            <Percent className="w-3.5 h-3.5" />
          </ToolBtn>
          <ToolBtn title="Date" active={activeFmt?.nf === "date"}
            onClick={() => applyToSelection({ nf: activeFmt?.nf === "date" ? undefined : "date" })}>
            <Calendar className="w-3.5 h-3.5" />
          </ToolBtn>
        </ToolGroup>

        {/* Row/col ops */}
        <ToolGroup>
          <ToolBtn title="Insert row above" onClick={() => insertRow(active.r)}>
            <span className="flex items-center gap-0.5"><Plus className="w-3 h-3" /><span className="text-[10px] font-mono">row</span></span>
          </ToolBtn>
          <ToolBtn title="Delete row" onClick={() => deleteRow(active.r)}>
            <span className="flex items-center gap-0.5"><Minus className="w-3 h-3" /><span className="text-[10px] font-mono">row</span></span>
          </ToolBtn>
          <ToolBtn title="Insert column left" onClick={() => insertCol(active.c)}>
            <span className="flex items-center gap-0.5"><Plus className="w-3 h-3" /><span className="text-[10px] font-mono">col</span></span>
          </ToolBtn>
          <ToolBtn title="Delete column" onClick={() => deleteCol(active.c)}>
            <span className="flex items-center gap-0.5"><Minus className="w-3 h-3" /><span className="text-[10px] font-mono">col</span></span>
          </ToolBtn>
        </ToolGroup>

        {/* Sort */}
        <ToolGroup>
          <ToolBtn title="Sort column ascending" onClick={() => sortByColumn(active.c, "asc")}>
            <ArrowUp className="w-3.5 h-3.5" />
          </ToolBtn>
          <ToolBtn title="Sort column descending" onClick={() => sortByColumn(active.c, "desc")}>
            <ArrowDown className="w-3.5 h-3.5" />
          </ToolBtn>
          <ToolBtn title="Auto-sum"
            onClick={() => {
              // Find contiguous numeric run above active cell
              let r = active.r - 1; let count = 0;
              while (r >= 0) {
                const n = getNumeric(getRaw, r, active.c);
                if (n === null) break;
                r--; count++;
              }
              if (count > 0) setCell(active.r, active.c, `=SUM(${cellRef(r + 1, active.c)}:${cellRef(active.r - 1, active.c)})`);
              else setEditing({ r: active.r, c: active.c, value: "=SUM(" });
            }}>
            <Sigma className="w-3.5 h-3.5" />
          </ToolBtn>
        </ToolGroup>

        {/* Clear */}
        <ToolGroup>
          <ToolBtn title="Clear selection contents" onClick={clearSelection}>
            <Trash2 className="w-3.5 h-3.5" />
          </ToolBtn>
        </ToolGroup>

        <div className="ml-auto flex items-center gap-2 pr-1">
          <span className="text-[10px] font-mono text-muted-foreground">{dataRows}×{dataCols}</span>
          <button
            onClick={exportCsv}
            className="text-[11px] font-mono text-primary hover:text-primary/80 px-2 py-1 rounded border border-primary/40 hover:bg-primary/10 flex items-center gap-1"
          >
            <Download className="w-3 h-3" /> Export CSV
          </button>
        </div>
      </div>

      {/* Formula bar */}
      <div className="flex items-stretch gap-px bg-border border-x border-border">
        <div className="px-3 py-1.5 bg-card min-w-[80px] flex items-center">
          <span className="text-xs font-mono font-bold text-primary">{cellRef(active.r, active.c)}</span>
        </div>
        <div className="px-2 py-1.5 bg-card flex items-center text-muted-foreground">
          <span className="text-xs font-mono italic">fx</span>
        </div>
        <input
          value={fbValue}
          onChange={e => { setFbEditing(true); setFbValue(e.target.value); }}
          onFocus={() => setFbEditing(true)}
          onBlur={() => {
            if (fbEditing) {
              setCell(active.r, active.c, fbValue);
              setFbEditing(false);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setCell(active.r, active.c, fbValue);
              setFbEditing(false);
              selectOne(Math.min(displayRows - 1, active.r + 1), active.c);
              e.preventDefault();
            } else if (e.key === "Escape") {
              setFbValue(activeRaw);
              setFbEditing(false);
              e.preventDefault();
            }
          }}
          placeholder="Enter a value or formula (e.g. =SUM(A1:A10))"
          className="flex-1 px-3 py-1.5 bg-background text-sm font-mono text-foreground focus:outline-none focus:bg-card"
          spellCheck={false}
        />
      </div>

      {/* Grid */}
      <div
        ref={tableRef}
        className="overflow-auto bg-card border border-border rounded-b-lg max-h-[62vh] relative"
        onMouseUp={() => { dragRef.current = null; }}
      >
        <table className="border-collapse" style={{ borderSpacing: 0 }}>
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="bg-muted border-r border-b border-border w-10 h-6 text-[10px] font-mono text-muted-foreground sticky left-0 z-30" />
              {Array.from({ length: displayCols }, (_, c) => {
                const sel = c >= range.c1 && c <= range.c2;
                return (
                  <th
                    key={c}
                    onClick={() => setSel({ r1: 0, c1: c, r2: displayRows - 1, c2: c })}
                    className={`border-r border-b border-border h-6 px-2 text-[10px] font-mono min-w-[100px] text-center cursor-pointer hover:bg-muted/70 ${
                      sel ? "bg-primary/30 text-primary-foreground font-bold" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {colLabel(c)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: displayRows }, (_, r) => {
              const rowSel = r >= range.r1 && r <= range.r2;
              return (
                <tr key={r}>
                  <td
                    onClick={() => setSel({ r1: r, c1: 0, r2: r, c2: displayCols - 1 })}
                    className={`border-r border-b border-border w-10 h-6 px-1 text-[10px] font-mono text-center sticky left-0 z-10 cursor-pointer hover:bg-muted/70 ${
                      rowSel ? "bg-primary/30 text-primary-foreground font-bold" : "bg-muted/80 text-muted-foreground"
                    }`}
                  >
                    {r + 1}
                  </td>
                  {Array.from({ length: displayCols }, (_, c) => (
                    <CellView
                      key={c}
                      r={r}
                      c={c}
                      raw={getRaw(r, c)}
                      fmt={getFmt(r, c)}
                      isActive={r === active.r && c === active.c}
                      isInRange={r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2}
                      isEditing={editing?.r === r && editing?.c === c}
                      editValue={editing?.r === r && editing?.c === c ? editing.value : ""}
                      onMouseDown={(e) => {
                        if (e.shiftKey) {
                          extendTo(r, c);
                        } else {
                          dragRef.current = { anchor: [r, c] };
                          selectOne(r, c);
                        }
                      }}
                      onMouseEnter={() => {
                        if (dragRef.current) extendTo(r, c);
                      }}
                      onDoubleClick={() => setEditing({ r, c, value: getRaw(r, c) })}
                      onEditChange={(v) => setEditing({ r, c, value: v })}
                      onEditCommit={(direction) => {
                        commitEdit();
                        if (direction === "down") selectOne(Math.min(displayRows - 1, r + 1), c);
                        else if (direction === "right") selectOne(r, Math.min(displayCols - 1, c + 1));
                      }}
                      onEditCancel={() => setEditing(null)}
                      display={displayValue(getRaw, r, c, getFmt(r, c))}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between gap-4 px-3 py-1.5 bg-muted/40 border-x border-b border-border rounded-b-lg text-[10px] font-mono text-muted-foreground">
        <div>
          {range.r1 === range.r2 && range.c1 === range.c2
            ? <>Cell <span className="text-primary font-bold">{cellRef(active.r, active.c)}</span></>
            : <>Range <span className="text-primary font-bold">{cellRef(range.r1, range.c1)}:{cellRef(range.r2, range.c2)}</span> · {(range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1)} cells</>}
        </div>
        <div className="flex items-center gap-4">
          {stats.numCount > 0 && (
            <>
              <span>SUM: <span className="text-foreground">{stats.sum.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></span>
              <span>AVG: <span className="text-foreground">{stats.avg.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></span>
            </>
          )}
          <span>COUNT: <span className="text-foreground">{stats.count}</span></span>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Subcomponents
// ───────────────────────────────────────────────────────────────────────────

function ToolGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-0.5 px-1 border-r border-border last:border-r-0">
      {children}
    </div>
  );
}

function ToolBtn({
  children, onClick, active, title, disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onMouseDown={(e) => { e.preventDefault(); }}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      className={`h-7 min-w-[28px] px-1.5 rounded text-xs transition-colors flex items-center justify-center ${
        disabled
          ? "text-muted-foreground/30 cursor-not-allowed"
          : active
          ? "bg-primary/20 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

function ColorPicker({ palette, onPick }: { palette: string[]; onPick: (c: string) => void }) {
  return (
    <div className="absolute top-full left-0 mt-1 p-2 bg-card border border-border rounded-lg shadow-lg z-50 grid grid-cols-6 gap-1 w-[164px]">
      {palette.map((c, i) => (
        <button
          key={i}
          onClick={() => onPick(c)}
          title={c || "Reset"}
          className="w-6 h-6 rounded border border-border hover:scale-110 transition-transform flex items-center justify-center"
          style={{ backgroundColor: c || "transparent" }}
        >
          {!c && <span className="text-[10px] text-muted-foreground">×</span>}
        </button>
      ))}
    </div>
  );
}

function CellView({
  r, c, raw, fmt, isActive, isInRange, isEditing, editValue, display,
  onMouseDown, onMouseEnter, onDoubleClick, onEditChange, onEditCommit, onEditCancel,
}: {
  r: number; c: number;
  raw: string;
  fmt: CellFmt | null;
  isActive: boolean;
  isInRange: boolean;
  isEditing: boolean;
  editValue: string;
  display: string;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter: () => void;
  onDoubleClick: () => void;
  onEditChange: (v: string) => void;
  onEditCommit: (direction: "down" | "right" | "none") => void;
  onEditCancel: () => void;
}) {
  const editRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (isEditing && editRef.current) {
      editRef.current.focus();
      const len = editRef.current.value.length;
      editRef.current.setSelectionRange(len, len);
    }
  }, [isEditing]);

  const style: React.CSSProperties = {};
  if (fmt?.bg) style.backgroundColor = fmt.bg;
  if (fmt?.fg) style.color = fmt.fg;
  if (fmt?.b) style.fontWeight = "bold";
  if (fmt?.i) style.fontStyle = "italic";
  if (fmt?.u) style.textDecoration = "underline";

  // Decide alignment: explicit fmt > numeric right-align > left
  const align: "left" | "center" | "right" =
    fmt?.a === "c" ? "center" :
    fmt?.a === "r" ? "right" :
    fmt?.a === "l" ? "left" :
    (raw && (raw.startsWith("=") || !isNaN(parseFloat(raw)))) ? "right" : "left";
  style.textAlign = align;

  const cellClass = [
    "border-r border-b border-border/40 h-6 p-0 min-w-[100px] relative",
    isActive ? "outline outline-2 outline-primary outline-offset-[-2px] z-10" : "",
    !isActive && isInRange ? "bg-primary/10" : "",
  ].join(" ");

  void r; void c;

  return (
    <td
      className={cellClass}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onDoubleClick={onDoubleClick}
    >
      {isEditing ? (
        <input
          ref={editRef}
          value={editValue}
          onChange={(e) => onEditChange(e.target.value)}
          onBlur={() => onEditCommit("none")}
          onKeyDown={(e) => {
            if (e.key === "Enter") { onEditCommit("down"); e.preventDefault(); }
            else if (e.key === "Tab") { onEditCommit("right"); e.preventDefault(); }
            else if (e.key === "Escape") { onEditCancel(); e.preventDefault(); }
          }}
          style={style}
          className="w-full h-full px-2 bg-card border-0 text-xs font-mono focus:outline-none"
          spellCheck={false}
        />
      ) : (
        <div
          style={style}
          className="w-full h-full px-2 text-xs font-mono truncate flex items-center"
          title={raw.startsWith("=") ? `${raw} = ${display}` : display}
        >
          {display}
        </div>
      )}
    </td>
  );
}
