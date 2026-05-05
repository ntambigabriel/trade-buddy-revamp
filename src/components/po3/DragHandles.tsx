import { useEffect, useRef, useState } from "react";
import type { ISeriesApi } from "lightweight-charts";
import type { OpenManualTrade } from "./ManualTradePanel";

interface Props {
  containerRef: React.RefObject<HTMLDivElement>;
  seriesRef: React.RefObject<ISeriesApi<"Candlestick"> | null>;
  trades: OpenManualTrade[];
  currentPrice: number;
  leverage: number;
  onUpdate: (id: string, sl?: number, tp?: number) => void;
}

type Drag = {
  id: string;
  kind: "SL" | "TP";
  trade: OpenManualTrade;
  startY: number;
  startPrice: number;
  currentPrice: number;
} | null;

export default function DragHandles({ containerRef, seriesRef, trades, currentPrice, leverage, onUpdate }: Props) {
  const [, setTick] = useState(0);
  const dragRef = useRef<Drag>(null);
  const [drag, setDrag] = useState<Drag>(null);

  // Repaint on every animation frame so handles follow chart pan/zoom.
  useEffect(() => {
    if (!trades.length) return;
    let raf = 0;
    const loop = () => {
      setTick((t) => (t + 1) % 1000000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [trades.length]);

  // Global pointer move/up while dragging
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || !seriesRef.current) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const y = e.clientY - rect.top;
      const price = seriesRef.current.coordinateToPrice(y);
      if (price == null) return;
      const next = { ...d, currentPrice: Number(price) };
      dragRef.current = next;
      setDrag(next);
    };
    const onUp = () => {
      const d = dragRef.current;
      if (d) {
        if (d.kind === "SL") onUpdate(d.id, d.currentPrice, undefined);
        else onUpdate(d.id, undefined, d.currentPrice);
      }
      dragRef.current = null;
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [containerRef, seriesRef, onUpdate]);

  if (!trades.length || !seriesRef.current) return null;
  const series = seriesRef.current;

  const startDrag = (e: React.PointerEvent, trade: OpenManualTrade, kind: "SL" | "TP") => {
    e.stopPropagation();
    e.preventDefault();
    const startPrice = kind === "SL" ? trade.sl : trade.tp;
    const d: Drag = { id: trade.id, kind, trade, startY: e.clientY, startPrice, currentPrice: startPrice };
    dragRef.current = d;
    setDrag(d);
  };

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 7 }}>
      {trades.map((t) => {
        const isDrag = drag?.id === t.id;
        const slPrice = isDrag && drag?.kind === "SL" ? drag.currentPrice : t.sl;
        const tpPrice = isDrag && drag?.kind === "TP" ? drag.currentPrice : t.tp;

        const slY = series.priceToCoordinate(slPrice);
        const tpY = series.priceToCoordinate(tpPrice);
        const sign = t.type === "BUY" ? 1 : -1;

        // PnL if price hits SL / TP from entry
        const slPnl = sign * (slPrice - t.entry) * t.lotSize * leverage;
        const tpPnl = sign * (tpPrice - t.entry) * t.lotSize * leverage;
        const livePnl = sign * (currentPrice - t.entry) * t.lotSize * leverage;

        const handleStyle = (color: string, y: number | null, active: boolean): React.CSSProperties => ({
          position: "absolute",
          left: 0, right: 60,
          top: y ?? -9999,
          height: active ? 22 : 16,
          marginTop: active ? -11 : -8,
          background: active ? `${color}33` : "transparent",
          borderTop: `${active ? 2 : 1}px ${active ? "solid" : "dashed"} ${color}`,
          borderBottom: active ? `${1}px dashed ${color}88` : "none",
          cursor: "ns-resize",
          pointerEvents: "auto",
          touchAction: "none",
        });

        const labelStyle = (color: string, bg: string): React.CSSProperties => ({
          position: "absolute",
          right: 4,
          background: bg,
          color: "#fff",
          padding: "1px 6px",
          borderRadius: 3,
          fontSize: 10,
          fontFamily: "ui-monospace, monospace",
          fontWeight: 600,
          border: `1px solid ${color}`,
          whiteSpace: "nowrap",
          pointerEvents: "none",
          transform: "translateY(-50%)",
        });

        return (
          <div key={t.id}>
            {/* SL handle */}
            {slY != null && (
              <>
                <div
                  onPointerDown={(e) => startDrag(e, t, "SL")}
                  style={handleStyle("#ef5350", slY, isDrag && drag?.kind === "SL")}
                />
                <div style={{ ...labelStyle("#ef5350", "rgba(239,83,80,0.95)"), top: slY }}>
                  SL {slPrice.toFixed(2)} {slPnl >= 0 ? "+" : ""}${slPnl.toFixed(2)}
                </div>
              </>
            )}
            {/* TP handle */}
            {tpY != null && (
              <>
                <div
                  onPointerDown={(e) => startDrag(e, t, "TP")}
                  style={handleStyle("#26a69a", tpY, isDrag && drag?.kind === "TP")}
                />
                <div style={{ ...labelStyle("#26a69a", "rgba(38,166,154,0.95)"), top: tpY }}>
                  TP {tpPrice.toFixed(2)} {tpPnl >= 0 ? "+" : ""}${tpPnl.toFixed(2)}
                </div>
              </>
            )}
            {/* Live PnL pill near entry */}
            {(() => {
              const eY = series.priceToCoordinate(t.entry);
              if (eY == null) return null;
              return (
                <div
                  style={{
                    position: "absolute",
                    left: 6,
                    top: eY - 22,
                    background: livePnl >= 0 ? "rgba(38,166,154,0.9)" : "rgba(239,83,80,0.9)",
                    color: "#fff",
                    padding: "2px 8px",
                    borderRadius: 3,
                    fontSize: 10,
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 700,
                    pointerEvents: "none",
                  }}
                >
                  {t.type} {t.lotSize} · {livePnl >= 0 ? "+" : ""}${livePnl.toFixed(2)}
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}
