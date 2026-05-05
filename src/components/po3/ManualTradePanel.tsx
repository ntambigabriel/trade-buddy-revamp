import { useState } from "react";
import Draggable from "./Draggable";
import { COLORS } from "./constants";

export interface OpenManualTrade {
  id: string;
  type: "BUY" | "SELL";
  entry: number;
  sl: number;
  tp: number;
  lotSize: number;
  openTime: number;
}

export interface ManualTrade {
  id: string;
  type: "BUY" | "SELL";
  entry: number;
  exit: number;
  sl: number;
  tp: number;
  lotSize: number;
  openTime: number;
  closeTime: number;
  result: "TP" | "SL" | "MANUAL";
  pnl: number;
}

export interface ManualDemoState {
  startBalance: number;
  balance: number;
  lotSize: number;
  leverage: number;
  openTrades: OpenManualTrade[];
  log: ManualTrade[];
  totalPnl: number;
}

interface Props {
  state: ManualDemoState;
  onUpdate: (d: Partial<ManualDemoState>) => void;
  onBuy: (lot: number, riskPts: number, rr: number) => void;
  onSell: (lot: number, riskPts: number, rr: number) => void;
  onCloseTrade: (id: string) => void;
  onUpdateTrade: (id: string, sl?: number, tp?: number) => void;
  onReset: () => void;
  onClose: () => void;
}



export default function ManualTradePanel({ state, onUpdate, onBuy, onSell, onCloseTrade, onUpdateTrade, onReset, onClose }: Props) {
  const [open, setOpen] = useState(true);
  const [riskPts, setRiskPts] = useState(100);
  const [rr, setRr] = useState(1.5);
  const pnl = state.balance - state.startBalance;
  const pnlPct = state.startBalance ? (pnl / state.startBalance) * 100 : 0;

  return (
    <Draggable
      initial={{
        x: typeof window !== "undefined" ? window.innerWidth - 360 : 100,
        y: 60,
      }}
      width={340}
      onClose={onClose}
    >
      {({ onMouseDown }) => (
        <div
          style={{
            background: COLORS.popupBg,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
            fontFamily: "ui-monospace, monospace",
            color: "#aabbcc",
            overflow: "hidden",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}
        >
          <div
            onMouseDown={onMouseDown}
            style={{
              cursor: "move",
              padding: "8px 12px",
              borderBottom: `1px solid ${COLORS.border}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "#0a0e16",
            }}
          >
            <span style={{ color: COLORS.cyan, fontSize: 12, fontWeight: 600 }}>🎯 MANUAL TRADE (REPLAY)</span>
            <button onClick={onClose} style={{ background: "none", border: "none", color: COLORS.textDim, cursor: "pointer", fontSize: 14 }}>×</button>
          </div>

          {/* Account header */}
          <div style={{ padding: "8px 12px", borderBottom: `1px solid ${COLORS.border}`, fontSize: 11, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div>Balance: <span style={{ color: "#ddd" }}>${state.balance.toFixed(2)}</span></div>
            <div>P&L: <span style={{ color: pnl >= 0 ? COLORS.rPos : COLORS.rNeg }}>{pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)</span></div>
            <div>Open: <span style={{ color: "#ddd" }}>{state.openTrades.length}</span></div>
            <div>Lev: <span style={{ color: "#ddd" }}>{state.leverage}×</span></div>
          </div>

          {/* Settings */}
          <div style={{ padding: "8px 12px", borderBottom: `1px solid ${COLORS.border}`, fontSize: 11 }}>
            <button
              onClick={() => setOpen(!open)}
              style={{ background: "none", border: "none", color: COLORS.textDim, cursor: "pointer", padding: 0, marginBottom: 6 }}
            >
              {open ? "▼" : "▶"} Settings
            </button>
            {open && (
              <div style={{ display: "grid", gap: 6 }}>
                <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  Start Balance
                  <input
                    type="number"
                    value={state.startBalance}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value) || 0;
                      onUpdate({ startBalance: v, balance: v });
                    }}
                    style={inputStyle}
                  />
                </label>
                <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  Leverage: {state.leverage}×
                  <input
                    type="range" min={1} max={100} value={state.leverage}
                    onChange={(e) => onUpdate({ leverage: parseInt(e.target.value) })}
                    style={{ width: 130 }}
                  />
                </label>
                <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  SL distance ($)
                  <input type="number" value={riskPts} onChange={(e) => setRiskPts(Math.max(1, parseFloat(e.target.value) || 0))} style={inputStyle} />
                </label>
                <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  TP : SL ratio
                  <input type="number" step="0.1" value={rr} onChange={(e) => setRr(Math.max(0.1, parseFloat(e.target.value) || 0))} style={inputStyle} />
                </label>
              </div>
            )}
          </div>

          {/* Lot size selector */}
          <div style={{ padding: "8px 12px", borderBottom: `1px solid ${COLORS.border}` }}>
            <div style={{ fontSize: 10, color: COLORS.textDim, marginBottom: 4 }}>LOT SIZE</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
              {LOT_PRESETS.map((l) => (
                <button
                  key={l}
                  onClick={() => onUpdate({ lotSize: l })}
                  style={{
                    background: state.lotSize === l ? COLORS.cyan : COLORS.pill,
                    color: state.lotSize === l ? "#0b0f19" : COLORS.textDim,
                    border: "none", padding: "4px 8px", borderRadius: 3, cursor: "pointer", fontSize: 11,
                  }}
                >
                  {l}
                </button>
              ))}
              <input
                type="number"
                step="0.01"
                value={state.lotSize}
                onChange={(e) => onUpdate({ lotSize: Math.max(0.001, parseFloat(e.target.value) || 0) })}
                style={{ ...inputStyle, width: 70 }}
              />
            </div>
          </div>

          {/* BUY / SELL buttons (TradingView-style) */}
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", gap: 8 }}>
            <button
              onClick={() => onBuy(state.lotSize, riskPts, rr)}
              style={tradeBtnStyle("#26a69a")}
            >
              ▲ BUY {state.lotSize}
            </button>
            <button
              onClick={() => onSell(state.lotSize, riskPts, rr)}
              style={tradeBtnStyle("#ef5350")}
            >
              ▼ SELL {state.lotSize}
            </button>
          </div>

          {/* Open trades */}
          <div style={{ padding: "6px 12px", fontSize: 10, color: COLORS.textDim, borderBottom: `1px solid ${COLORS.border}` }}>
            OPEN TRADES
          </div>
          <div style={{ maxHeight: 100, overflowY: "auto", fontSize: 10 }}>
            {state.openTrades.length === 0 && <div style={{ padding: "4px 12px", color: "#3a4555" }}>No open trades</div>}
            {state.openTrades.map((t) => (
              <div key={t.id} style={{ padding: "6px 12px", display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 4, alignItems: "center", borderBottom: `1px solid ${COLORS.border}` }}>
                <span style={{ color: t.type === "BUY" ? "#26a69a" : "#ef5350", fontWeight: 600 }}>{t.type} {t.lotSize}</span>
                <span style={{ color: COLORS.textDim, fontSize: 9 }}>E:{t.entry.toFixed(1)}</span>
                <button
                  onClick={() => onCloseTrade(t.id)}
                  style={{ background: COLORS.pill, color: "#ddd", border: "none", padding: "2px 6px", borderRadius: 3, cursor: "pointer", fontSize: 10 }}
                >
                  Close
                </button>
                <label style={{ gridColumn: "1 / 4", display: "flex", gap: 6, alignItems: "center", fontSize: 10 }}>
                  <span style={{ color: "#ef5350", width: 22 }}>SL</span>
                  <input
                    type="number" step="0.1" defaultValue={t.sl}
                    onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v !== t.sl) onUpdateTrade(t.id, v, undefined); }}
                    style={{ ...inputStyle, flex: 1, width: "auto" }}
                  />
                  <span style={{ color: "#26a69a", width: 22 }}>TP</span>
                  <input
                    type="number" step="0.1" defaultValue={t.tp}
                    onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v !== t.tp) onUpdateTrade(t.id, undefined, v); }}
                    style={{ ...inputStyle, flex: 1, width: "auto" }}
                  />
                </label>
              </div>
            ))}
          </div>

          {/* Trade log */}
          <div style={{ padding: "6px 12px", fontSize: 10, color: COLORS.textDim, borderTop: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>HISTORY ({state.log.length})</span>
            <button onClick={onReset} style={{ background: COLORS.pill, color: COLORS.textDim, border: "none", padding: "2px 8px", borderRadius: 3, cursor: "pointer", fontSize: 10 }}>
              Reset
            </button>
          </div>
          <div style={{ maxHeight: 180, overflowY: "auto", fontSize: 10 }}>
            {state.log.length === 0 && <div style={{ padding: "4px 12px", color: "#3a4555" }}>No trades yet</div>}
            {state.log.map((t) => (
              <div
                key={t.id}
                style={{
                  padding: "3px 12px",
                  background: t.pnl >= 0 ? "rgba(0,160,80,0.08)" : "rgba(200,40,40,0.08)",
                  display: "flex", gap: 6,
                  borderBottom: `1px solid ${COLORS.border}`,
                }}
              >
                <span style={{ color: "#5a7088" }}>{new Date(t.closeTime * 1000).toISOString().slice(5, 16).replace("T", " ")}</span>
                <span style={{ color: t.type === "BUY" ? "#26a69a" : "#ef5350" }}>{t.type}</span>
                <span>{t.lotSize}</span>
                <span style={{ color: COLORS.textDim }}>{t.result}</span>
                <span style={{ color: t.pnl >= 0 ? COLORS.rPos : COLORS.rNeg, marginLeft: "auto" }}>
                  {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Draggable>
  );
}

const inputStyle: React.CSSProperties = {
  width: 110, background: "#0a0e16", border: `1px solid ${COLORS.border}`,
  color: "#ddd", padding: "2px 6px", borderRadius: 3, fontSize: 11,
};

const tradeBtnStyle = (color: string): React.CSSProperties => ({
  flex: 1,
  background: color,
  color: "#fff",
  border: "none",
  padding: "10px 8px",
  borderRadius: 4,
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 12,
  letterSpacing: 0.5,
});
