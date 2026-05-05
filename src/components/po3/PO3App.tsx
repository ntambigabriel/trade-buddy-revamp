import { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  LineStyle,
  CrosshairMode,
  UTCTimestamp,
  SeriesMarker,
  Time,
} from "lightweight-charts";
import { COLORS, SPEED_MS, STATE_COLOR, STATE_LABEL } from "./constants";
import { Bar, fetchKlines, buildH1Map, H1Candle } from "@/lib/binance";
import { StrategyEngine, DEFAULT_PARAMS, StrategyParams, Snapshot, StrategyEvent } from "@/lib/strategy";
import Dashboard from "./Dashboard";
import Demo, { DemoState } from "./Demo";
import BacktestPanel, { BacktestResults } from "./BacktestPanel";
import ManualTradePanel, { ManualDemoState, ManualTrade, OpenManualTrade } from "./ManualTradePanel";

const todayStr = () => new Date().toISOString().slice(0, 10);
const sevenDaysAgo = () => new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

const SpeedBtn = ({ s, speed, setSpeed }: { s: keyof typeof SPEED_MS; speed: keyof typeof SPEED_MS; setSpeed: (s: keyof typeof SPEED_MS) => void }) => (
  <button
    onClick={() => setSpeed(s)}
    style={{
      background: speed === s ? COLORS.cyan : COLORS.pill,
      color: speed === s ? "#0b0f19" : COLORS.textDim,
      border: "none", padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11, marginLeft: 2,
    }}
  >
    {s}
  </button>
);

const PillBtn = ({ children, onClick, active }: { children: any; onClick: () => void; active?: boolean }) => (
  <button
    onClick={onClick}
    style={{
      background: active ? COLORS.pillHover : COLORS.pill,
      color: COLORS.textDim, border: "none", padding: "6px 10px",
      borderRadius: 4, cursor: "pointer", fontSize: 11, marginLeft: 4,
      transition: "background 0.15s",
    }}
  >
    {children}
  </button>
);

const Sep = () => <span style={{ width: 1, height: 24, background: COLORS.border, margin: "0 8px", display: "inline-block" }} />;

const DEFAULT_MANUAL: ManualDemoState = {
  startBalance: 10000,
  balance: 10000,
  lotSize: 0.01,
  leverage: 10,
  openTrades: [],
  log: [],
  totalPnl: 0,
};

export default function PO3App() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const overlaySeriesRef = useRef<{ [key: string]: any }>({});

  const barsRef = useRef<Bar[]>([]);
  const h1MapRef = useRef<Map<number, H1Candle>>(new Map());
  const engineRef = useRef<StrategyEngine>(new StrategyEngine(DEFAULT_PARAMS));

  const [params, setParams] = useState<StrategyParams>(DEFAULT_PARAMS);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const [showBacktest, setShowBacktest] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [showDates, setShowDates] = useState(false);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const [speed, setSpeed] = useState<keyof typeof SPEED_MS>("5x");
  const [startDate, setStartDate] = useState(sevenDaysAgo());
  const [endDate, setEndDate] = useState(todayStr());
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState({ fetched: 0, total: 0 });
  const [loadingMessage, setLoadingMessage] = useState("Fetching BTCUSDT 1m data...");
  const [results, setResults] = useState<BacktestResults | null>(null);
  const [running, setRunning] = useState(false);
  const [currentBarIndex, setCurrentBarIndex] = useState(0);

  const playRef = useRef<number | null>(null);
  const idxRef = useRef(0);

  const allMarkersRef = useRef<SeriesMarker<Time>[]>([]);

  // Persistent strategy trade boxes
  interface TradeBox {
    id: string;
    type: "BUY" | "SELL";
    startTime: number;
    endTime: number | null;
    entry: number;
    sl: number;
    tp: number;
    mid?: number;
    midTouched?: boolean;
    result?: "WIN" | "LOSS" | "INVALIDATED" | "CONVERTED";
    manual?: boolean;
  }
  const tradeBoxesRef = useRef<TradeBox[]>([]);
  const activeBuyBoxRef = useRef<TradeBox | null>(null);
  const activeSellBoxesRef = useRef<Map<string, TradeBox>>(new Map());

  const [scissorsMode, setScissorsMode] = useState(false);
  const scissorsModeRef = useRef(false);
  useEffect(() => { scissorsModeRef.current = scissorsMode; }, [scissorsMode]);

  // Strategy demo (auto)
  const [demo, setDemo] = useState<DemoState>({
    startBalance: 10000,
    balance: 10000,
    riskMode: "pct",
    riskPct: 1,
    riskDollar: 100,
    leverage: 1,
    openTrades: [],
    log: [],
    totalR: 0,
  });
  const demoRef = useRef(demo);
  useEffect(() => { demoRef.current = demo; }, [demo]);

  // Manual demo (separate account for manual trades in replay)
  const [manual, setManual] = useState<ManualDemoState>(DEFAULT_MANUAL);
  const manualRef = useRef(manual);
  useEffect(() => { manualRef.current = manual; }, [manual]);

  // Init chart
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const chart = createChart(chartContainerRef.current, {
      layout: { background: { color: COLORS.bg }, textColor: COLORS.axis },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: COLORS.crosshair }, horzLine: { color: COLORS.crosshair } },
      rightPriceScale: { borderColor: COLORS.border },
      timeScale: { borderColor: COLORS.border, timeVisible: true, secondsVisible: false },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
    });
    const series = chart.addCandlestickSeries({
      upColor: COLORS.green, downColor: COLORS.red,
      borderUpColor: COLORS.green, borderDownColor: COLORS.red,
      wickUpColor: COLORS.green, wickDownColor: COLORS.red,
    });
    chartRef.current = chart;
    candleSeriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.resize(chartContainerRef.current.clientWidth, chartContainerRef.current.clientHeight);
      }
    });
    ro.observe(chartContainerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
    };
  }, []);

  const clearOverlays = useCallback(() => {
    if (!chartRef.current) return;
    Object.values(overlaySeriesRef.current).forEach((s) => {
      try { chartRef.current!.removeSeries(s); } catch {}
    });
    overlaySeriesRef.current = {};
  }, []);

  // Transparent overlays:
  // - No opaque area fills behind the candles.
  // - Edges are clipped strictly to [startTime, endTime] so visuals never extend past their lifespan.
  const drawOverlays = useCallback((snap: Snapshot, currentBar: Bar) => {
    if (!chartRef.current) return;
    clearOverlays();
    const chart = chartRef.current;
    const futureTime = (currentBar.time + 500 * 60) as UTCTimestamp;

    const addLine = (
      key: string,
      color: string,
      style: LineStyle,
      points: { time: UTCTimestamp; value: number }[],
      width = 1,
    ) => {
      const s = chart.addLineSeries({
        color, lineWidth: width as any, lineStyle: style,
        priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      s.setData(points);
      overlaySeriesRef.current[key] = s;
    };

    // P1 line (active setup only)
    if ((snap.state === 1 || snap.state === 2 || snap.state === 3) && snap.p1 !== null) {
      const startTime = (snap.p1Bar !== null && barsRef.current[snap.p1Bar])
        ? (barsRef.current[snap.p1Bar].time as UTCTimestamp)
        : (currentBar.time as UTCTimestamp);
      addLine("p1", "#ffffff66", LineStyle.Dashed, [
        { time: startTime, value: snap.p1 },
        { time: futureTime, value: snap.p1 },
      ]);
    }

    // Render each trade as TRANSPARENT edge lines only (no area fills) so
    // the candles behind a buy/sell setup remain fully visible. Visuals are
    // strictly clipped to [startTime, endTime] — never extend past the close.
    tradeBoxesRef.current.forEach((tb, i) => {
      const t0 = tb.startTime as UTCTimestamp;
      const tEnd = tb.endTime ?? currentBar.time;
      // Don't extend past current bar even for active trades.
      const t1 = Math.min(tEnd, currentBar.time) as UTCTimestamp;
      if ((t1 as number) <= (t0 as number)) return;

      const dashStyle = tb.manual ? LineStyle.Solid : LineStyle.Dashed;

      if (tb.type === "BUY") {
        const tpColor = tb.manual ? "#26a69a" : "#26a69aaa";
        const slColor = tb.manual ? "#ef5350" : "#4488FFcc";
        const entryColor = tb.manual ? "#ffffffcc" : "#88bbffcc";
        addLine(`buyTP_${i}`, tpColor, dashStyle, [{ time: t0, value: tb.tp }, { time: t1, value: tb.tp }], 2);
        addLine(`buyEntry_${i}`, entryColor, LineStyle.Solid, [{ time: t0, value: tb.entry }, { time: t1, value: tb.entry }], 1);
        addLine(`buySL_${i}`, slColor, dashStyle, [{ time: t0, value: tb.sl }, { time: t1, value: tb.sl }], 2);
        if (tb.mid !== undefined) {
          addLine(`buyMid_${i}`, tb.midTouched ? "#ff333399" : "#ffd70099", LineStyle.Dotted,
            [{ time: t0, value: tb.mid }, { time: t1, value: tb.mid }], 1);
        }
      } else {
        const tpColor = tb.manual ? "#26a69a" : "#00d060cc";
        const slColor = tb.manual ? "#ef5350" : "#ff3333cc";
        const entryColor = tb.manual ? "#ffffffcc" : "#ffd700cc";
        addLine(`sellE_${i}`, entryColor, LineStyle.Solid, [{ time: t0, value: tb.entry }, { time: t1, value: tb.entry }], 1);
        addLine(`sellSL_${i}`, slColor, dashStyle, [{ time: t0, value: tb.sl }, { time: t1, value: tb.sl }], 2);
        addLine(`sellTP_${i}`, tpColor, dashStyle, [{ time: t0, value: tb.tp }, { time: t1, value: tb.tp }], 2);
      }
    });
  }, [clearOverlays]);

  const applyEventsToDemo = useCallback((events: StrategyEvent[]) => {
    let d = { ...demoRef.current };
    let mutated = false;
    for (const ev of events) {
      if (ev.type === "SELL_ENTRY") {
        d.openTrades = [...d.openTrades, { type: "SELL", entry: ev.entry, sl: ev.sl, tp: ev.tp }];
        mutated = true;
      } else if (ev.type === "SELL_WIN" || ev.type === "SELL_LOSS") {
        const tr = ev.trade;
        const idx = d.openTrades.findIndex((t) => t.entry === tr.entry && t.sl === tr.sl);
        if (idx >= 0) d.openTrades = d.openTrades.filter((_, i) => i !== idx);
        const riskAmt = d.riskMode === "pct" ? d.balance * (d.riskPct / 100) : d.riskDollar;
        const r = ev.type === "SELL_WIN" ? params.sellTpR : -1;
        const pnl = riskAmt * r * d.leverage;
        d.balance = d.balance + pnl;
        d.totalR += r;
        d.log = [
          { type: "SELL" as const, entry: tr.entry, sl: tr.sl, tp: tr.tp, time: ev.bar.time, result: (ev.type === "SELL_WIN" ? "WIN" : "LOSS") as "WIN" | "LOSS", r, pnl },
          ...d.log,
        ].slice(0, 200);
        mutated = true;
      }
    }
    if (mutated) setDemo(d);
  }, [params.sellTpR]);

  // Process manual trades against a bar — close any whose TP/SL was hit.
  const evaluateManualTrades = useCallback((bar: Bar) => {
    const m = { ...manualRef.current };
    if (!m.openTrades.length) return;
    const stillOpen: OpenManualTrade[] = [];
    let mutated = false;
    for (const t of m.openTrades) {
      let exit: number | null = null;
      let result: "TP" | "SL" | null = null;
      if (t.type === "BUY") {
        if (bar.low <= t.sl) { exit = t.sl; result = "SL"; }
        else if (bar.high >= t.tp) { exit = t.tp; result = "TP"; }
      } else {
        if (bar.high >= t.sl) { exit = t.sl; result = "SL"; }
        else if (bar.low <= t.tp) { exit = t.tp; result = "TP"; }
      }
      if (exit !== null && result !== null) {
        // PnL: lot * (exit - entry) for BUY ; lot * (entry - exit) for SELL
        const sign = t.type === "BUY" ? 1 : -1;
        const pnl = sign * (exit - t.entry) * t.lotSize * m.leverage;
        m.balance += pnl;
        m.totalPnl += pnl;
        m.log = [
          { id: t.id, type: t.type, entry: t.entry, exit, sl: t.sl, tp: t.tp, lotSize: t.lotSize,
            openTime: t.openTime, closeTime: bar.time, result, pnl },
          ...m.log,
        ].slice(0, 300);
        // mark trade box closed
        const tb = tradeBoxesRef.current.find((b) => b.id === t.id);
        if (tb) { tb.endTime = bar.time; tb.result = result === "TP" ? "WIN" : "LOSS"; }
        mutated = true;
      } else {
        stillOpen.push(t);
      }
    }
    if (mutated) {
      m.openTrades = stillOpen;
      setManual(m);
    }
  }, []);

  const fullMarkersRebuild = useCallback(() => {
    if (candleSeriesRef.current) candleSeriesRef.current.setMarkers(allMarkersRef.current);
  }, []);

  const collectMarkers = useCallback((events: StrategyEvent[]) => {
    for (const ev of events) {
      const time = ev.bar.time as UTCTimestamp;
      if (ev.type === "BUY_ENTRY") {
        allMarkersRef.current.push({ time, position: "belowBar", color: "#26a69a", shape: "arrowUp", text: "BUY" });
        const tb: TradeBox = {
          id: `buy_${ev.bar.time}`, type: "BUY", startTime: ev.bar.time, endTime: null,
          entry: ev.buyEntry, sl: ev.buySL, tp: ev.buyTP, mid: ev.buyMid, midTouched: false,
        };
        tradeBoxesRef.current.push(tb);
        activeBuyBoxRef.current = tb;
      } else if (ev.type === "MID_TOUCHED") {
        allMarkersRef.current.push({ time, position: "belowBar", color: "#ffd700", shape: "circle" });
        if (activeBuyBoxRef.current) activeBuyBoxRef.current.midTouched = true;
      } else if (ev.type === "BUY_WIN") {
        if (activeBuyBoxRef.current) {
          activeBuyBoxRef.current.endTime = ev.bar.time;
          activeBuyBoxRef.current.result = "WIN";
          activeBuyBoxRef.current = null;
        }
      } else if (ev.type === "BUY_INVALIDATED") {
        if (activeBuyBoxRef.current) {
          activeBuyBoxRef.current.endTime = ev.bar.time;
          activeBuyBoxRef.current.result = "INVALIDATED";
          activeBuyBoxRef.current = null;
        }
      } else if (ev.type === "SELL_ENTRY") {
        allMarkersRef.current.push({ time, position: "aboveBar", color: "#ffd700", shape: "arrowDown", text: "SELL" });
        if (activeBuyBoxRef.current) {
          activeBuyBoxRef.current.endTime = ev.bar.time;
          activeBuyBoxRef.current.result = "CONVERTED";
          activeBuyBoxRef.current = null;
        }
        const sb: TradeBox = {
          id: `sell_${ev.bar.time}_${ev.entry}`, type: "SELL",
          startTime: ev.bar.time, endTime: null, entry: ev.entry, sl: ev.sl, tp: ev.tp,
        };
        tradeBoxesRef.current.push(sb);
        activeSellBoxesRef.current.set(`${ev.entry}_${ev.sl}`, sb);
      } else if (ev.type === "SELL_WIN") {
        allMarkersRef.current.push({ time, position: "belowBar", color: "#00d060", shape: "circle", text: "TP ✓" });
        const k = `${ev.trade.entry}_${ev.trade.sl}`;
        const sb = activeSellBoxesRef.current.get(k);
        if (sb) { sb.endTime = ev.bar.time; sb.result = "WIN"; activeSellBoxesRef.current.delete(k); }
      } else if (ev.type === "SELL_LOSS") {
        allMarkersRef.current.push({ time, position: "aboveBar", color: "#ff8800", shape: "circle", text: "SL ✗" });
        const k = `${ev.trade.entry}_${ev.trade.sl}`;
        const sb = activeSellBoxesRef.current.get(k);
        if (sb) { sb.endTime = ev.bar.time; sb.result = "LOSS"; activeSellBoxesRef.current.delete(k); }
      }
    }
  }, []);

  const resetManual = useCallback(() => {
    setManual((m) => ({
      ...m,
      balance: m.startBalance,
      openTrades: [],
      log: [],
      totalPnl: 0,
    }));
    // Drop manual trade boxes
    tradeBoxesRef.current = tradeBoxesRef.current.filter((b) => !b.manual);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadingMessage("Fetching BTCUSDT 1m data...");
    playingRef.current = false;
    setPlaying(false);
    if (playRef.current) {
      clearInterval(playRef.current);
      playRef.current = null;
    }
    try {
      const start = new Date(startDate).getTime();
      const end = new Date(endDate).getTime() + 86399000;
      const bars = await fetchKlines(start, end, (f, t) => setLoadProgress({ fetched: f, total: t }));
      barsRef.current = bars;
      h1MapRef.current = buildH1Map(bars);

      if (candleSeriesRef.current) {
        candleSeriesRef.current.setData(bars.map((b) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })));
        candleSeriesRef.current.setMarkers([]);
      }
      allMarkersRef.current = [];
      tradeBoxesRef.current = [];
      activeBuyBoxRef.current = null;
      activeSellBoxesRef.current = new Map();

      setDemo(d => ({ ...d, balance: d.startBalance, openTrades: [], log: [], totalR: 0 }));
      // Reset manual demo when loading fresh data / live edge
      resetManual();

      engineRef.current = new StrategyEngine(params);
      let snap: Snapshot | null = null;
      for (const b of bars) {
        snap = engineRef.current.processBar(b, h1MapRef.current);
        collectMarkers(engineRef.current.events);
        applyEventsToDemo(engineRef.current.events);
      }
      setSnapshot(snap);
      idxRef.current = bars.length - 1;
      setCurrentBarIndex(bars.length - 1);
      fullMarkersRebuild();
      if (snap && bars.length) drawOverlays(snap, bars[bars.length - 1]);
      chartRef.current?.timeScale().fitContent();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, params, applyEventsToDemo, collectMarkers, drawOverlays, fullMarkersRebuild, resetManual]);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!playing) {
      if (playRef.current) {
        clearInterval(playRef.current);
        playRef.current = null;
      }
      return;
    }
    playingRef.current = true;
    const TICK_MS = 33;
    const barsPerTick = Math.max(1, Math.round(TICK_MS / SPEED_MS[speed]));

    playRef.current = window.setInterval(() => {
      if (!playingRef.current) {
        if (playRef.current) clearInterval(playRef.current);
        playRef.current = null;
        return;
      }
      const bars = barsRef.current;
      let snap: Snapshot | null = null;
      let lastBar: Bar | null = null;
      let advanced = 0;
      for (let i = 0; i < barsPerTick; i++) {
        if (idxRef.current >= bars.length - 1) break;
        idxRef.current++;
        const bar = bars[idxRef.current];
        snap = engineRef.current.processBar(bar, h1MapRef.current);
        collectMarkers(engineRef.current.events);
        applyEventsToDemo(engineRef.current.events);
        evaluateManualTrades(bar);
        lastBar = bar;
        advanced++;
        if (candleSeriesRef.current) {
          candleSeriesRef.current.update({ time: bar.time as UTCTimestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
        }
      }
      if (advanced === 0) {
        playingRef.current = false;
        setPlaying(false);
        return;
      }
      fullMarkersRebuild();
      setSnapshot(snap);
      setCurrentBarIndex(idxRef.current);
      if (snap && lastBar) drawOverlays(snap, lastBar);
    }, TICK_MS);
    return () => {
      if (playRef.current) {
        clearInterval(playRef.current);
        playRef.current = null;
      }
    };
  }, [playing, speed, drawOverlays, applyEventsToDemo, collectMarkers, fullMarkersRebuild, evaluateManualTrades]);

  const handlePause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    if (playRef.current) {
      clearInterval(playRef.current);
      playRef.current = null;
    }
  }, []);

  const handlePlayPause = useCallback(() => {
    if (playingRef.current) {
      playingRef.current = false;
      setPlaying(false);
      if (playRef.current) { clearInterval(playRef.current); playRef.current = null; }
    } else {
      if (idxRef.current >= barsRef.current.length - 1) return;
      playingRef.current = true;
      setPlaying(true);
    }
  }, []);

  const stepForward = useCallback(() => {
    handlePause();
    const bars = barsRef.current;
    if (idxRef.current >= bars.length - 1) return;
    idxRef.current++;
    const bar = bars[idxRef.current];
    const snap = engineRef.current.processBar(bar, h1MapRef.current);
    collectMarkers(engineRef.current.events);
    applyEventsToDemo(engineRef.current.events);
    evaluateManualTrades(bar);
    if (candleSeriesRef.current) {
      candleSeriesRef.current.update({ time: bar.time as UTCTimestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
    }
    fullMarkersRebuild();
    setSnapshot(snap);
    setCurrentBarIndex(idxRef.current);
    drawOverlays(snap, bar);
  }, [handlePause, applyEventsToDemo, collectMarkers, drawOverlays, fullMarkersRebuild, evaluateManualTrades]);

  const rewindTo = useCallback((targetIdx: number) => {
    handlePause();
    const bars = barsRef.current;
    if (!bars.length) return;
    const idx = Math.max(0, Math.min(bars.length - 1, targetIdx));
    engineRef.current = new StrategyEngine(params);
    allMarkersRef.current = [];
    tradeBoxesRef.current = [];
    activeBuyBoxRef.current = null;
    activeSellBoxesRef.current = new Map();
    setDemo((d) => ({ ...d, balance: d.startBalance, openTrades: [], log: [], totalR: 0 }));
    resetManual();
    let snap: Snapshot | null = null;
    for (let i = 0; i <= idx; i++) {
      snap = engineRef.current.processBar(bars[i], h1MapRef.current);
      collectMarkers(engineRef.current.events);
      applyEventsToDemo(engineRef.current.events);
    }
    if (candleSeriesRef.current) {
      candleSeriesRef.current.setData(bars.slice(0, idx + 1).map((b) => ({
        time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close,
      })));
    }
    idxRef.current = idx;
    setCurrentBarIndex(idx);
    fullMarkersRebuild();
    setSnapshot(snap);
    if (snap) drawOverlays(snap, bars[idx]);
  }, [params, handlePause, applyEventsToDemo, collectMarkers, drawOverlays, fullMarkersRebuild, resetManual]);

  const reset = () => rewindTo(0);
  // "Live" — go to live edge AND reset manual trade history
  const goToEnd = () => {
    rewindTo(barsRef.current.length - 1);
    // rewindTo already resets manual; also re-process all bars to live
  };

  // Place a manual trade at the current candle.
  // riskPts = SL distance in price points; rr controls TP distance.
  const placeManualTrade = useCallback((type: "BUY" | "SELL", lotSize: number, riskPts = 100, rr = 1.5) => {
    const bars = barsRef.current;
    if (!bars.length) return;
    const bar = bars[idxRef.current];
    const price = bar.close;
    const sl = type === "BUY" ? price - riskPts : price + riskPts;
    const tp = type === "BUY" ? price + riskPts * rr : price - riskPts * rr;
    const id = `manual_${type}_${bar.time}_${Math.random().toString(36).slice(2, 7)}`;
    const trade: OpenManualTrade = {
      id, type, entry: price, sl, tp, lotSize, openTime: bar.time,
    };
    setManual((m) => ({ ...m, openTrades: [...m.openTrades, trade] }));
    tradeBoxesRef.current.push({
      id, type, startTime: bar.time, endTime: null,
      entry: price, sl, tp, manual: true,
    });
    if (snapshot) drawOverlays(snapshot, bar);
  }, [snapshot, drawOverlays]);

  const closeManualTrade = useCallback((id: string) => {
    const bars = barsRef.current;
    if (!bars.length) return;
    const bar = bars[idxRef.current];
    const m = { ...manualRef.current };
    const t = m.openTrades.find((x) => x.id === id);
    if (!t) return;
    const exit = bar.close;
    const sign = t.type === "BUY" ? 1 : -1;
    const pnl = sign * (exit - t.entry) * t.lotSize * m.leverage;
    m.balance += pnl;
    m.totalPnl += pnl;
    m.openTrades = m.openTrades.filter((x) => x.id !== id);
    m.log = [{
      id: t.id, type: t.type, entry: t.entry, exit, sl: t.sl, tp: t.tp,
      lotSize: t.lotSize, openTime: t.openTime, closeTime: bar.time,
      result: "MANUAL" as const, pnl,
    }, ...m.log].slice(0, 300);
    setManual(m);
    const tb = tradeBoxesRef.current.find((b) => b.id === id);
    if (tb) { tb.endTime = bar.time; tb.result = pnl >= 0 ? "WIN" : "LOSS"; }
    if (snapshot) drawOverlays(snapshot, bar);
  }, [snapshot, drawOverlays]);

  // Scissors click handler
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const handler = (param: any) => {
      if (!scissorsModeRef.current) return;
      if (!param.time) return;
      const t = param.time as number;
      const idx = barsRef.current.findIndex((b) => b.time === t);
      if (idx >= 0) {
        rewindTo(idx);
        setScissorsMode(false);
      }
    };
    chart.subscribeClick(handler);
    return () => { chart.unsubscribeClick(handler); };
  }, [rewindTo]);

  const runBacktest = useCallback(async () => {
    setRunning(true);
    setLoading(true);
    setLoadingMessage("Running backtest...");
    try {
      const start = new Date(startDate).getTime();
      const end = new Date(endDate).getTime() + 86399000;
      const have = barsRef.current;
      if (!have.length || have[0].time * 1000 > start + 60000 || have[have.length - 1].time * 1000 < end - 86400000) {
        const bars = await fetchKlines(start, end, (f, t) => setLoadProgress({ fetched: f, total: t }));
        barsRef.current = bars;
        h1MapRef.current = buildH1Map(bars);
      }
      const bars = barsRef.current;
      const eng = new StrategyEngine(params);
      const allEvents: StrategyEvent[] = [];
      const equity: { time: number; r: number }[] = [];
      let cumR = 0;
      let peak = 0;
      let maxDD = 0;
      const dayMap = new Map<string, number>();
      const monthMap = new Map<string, { trades: number; wins: number; r: number }>();
      for (let i = 0; i < bars.length; i++) {
        eng.processBar(bars[i], h1MapRef.current);
        for (const ev of eng.events) {
          allEvents.push(ev);
          if (ev.type === "SELL_WIN" || ev.type === "SELL_LOSS" || ev.type === "BUY_WIN" || ev.type === "BUY_INVALIDATED") {
            const r = ev.type === "SELL_WIN" ? params.sellTpR : ev.type === "BUY_WIN" ? params.rrRatio : -1;
            cumR += r;
            peak = Math.max(peak, cumR);
            maxDD = Math.min(maxDD, cumR - peak);
            equity.push({ time: ev.bar.time, r: cumR });
            const dateStr = new Date((ev.bar.time + 3 * 3600) * 1000).toISOString().slice(0, 10);
            dayMap.set(dateStr, (dayMap.get(dateStr) ?? 0) + r);
            const monthStr = dateStr.slice(0, 7);
            const m = monthMap.get(monthStr) ?? { trades: 0, wins: 0, r: 0 };
            m.trades++;
            if (r > 0) m.wins++;
            m.r += r;
            monthMap.set(monthStr, m);
          }
        }
        if (i % 5000 === 0) {
          setLoadProgress({ fetched: i, total: bars.length });
          await new Promise((r) => requestAnimationFrame(() => r(null)));
        }
      }
      const trades = allEvents.filter((e) => e.type === "SELL_WIN" || e.type === "SELL_LOSS" || e.type === "BUY_WIN" || e.type === "BUY_INVALIDATED");
      const wins = allEvents.filter((e) => e.type === "SELL_WIN" || e.type === "BUY_WIN").length;
      const days = [...dayMap.entries()].map(([date, r]) => ({ date, r }));
      const best = days.reduce((a, b) => (b.r > a.r ? b : a), { date: "-", r: 0 });
      const worst = days.reduce((a, b) => (b.r < a.r ? b : a), { date: "-", r: 0 });
      const monthly = [...monthMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, m]) => ({ month, trades: m.trades, winRate: (m.wins / m.trades) * 100, r: m.r }));
      setResults({
        totalTrades: trades.length,
        winRate: trades.length ? (wins / trades.length) * 100 : 0,
        totalR: cumR,
        maxDrawdown: maxDD,
        avgRPerDay: days.length ? cumR / days.length : 0,
        bestDay: best,
        worstDay: worst,
        equity,
        monthly,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setRunning(false);
      setLoading(false);
    }
  }, [startDate, endDate, params]);

  return (
    <div style={{ position: "fixed", inset: 0, background: COLORS.bg, color: "#ddd", display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* TOOLBAR */}
      <div style={{ minHeight: 44, background: COLORS.toolbar, borderBottom: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, padding: "6px 12px", flexShrink: 0 }}>
        <div style={{ color: COLORS.cyan, fontFamily: "ui-monospace, monospace", fontSize: 12, fontWeight: 700, letterSpacing: 1, fontVariant: "small-caps" }}>
          PO3 MODEL A
        </div>
        <div style={{ flex: 1, display: "flex", justifyContent: "center", gap: 4 }}>
          <span style={{ background: COLORS.pillBadgeBg, color: COLORS.pillBadgeText, padding: "4px 10px", borderRadius: 12, fontSize: 11, fontFamily: "ui-monospace, monospace" }}>BTCUSDT</span>
          <span style={{ background: COLORS.pillBadgeBg, color: COLORS.pillBadgeText, padding: "4px 10px", borderRadius: 12, fontSize: 11, fontFamily: "ui-monospace, monospace" }}>1m</span>
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          <PillBtn onClick={() => setShowStats((v) => !v)} active={showStats}>📊 Stats</PillBtn>
          <PillBtn onClick={() => setShowDemo((v) => !v)} active={showDemo}>💼 Auto Demo</PillBtn>
          <PillBtn onClick={() => setShowManual((v) => !v)} active={showManual}>🎯 Manual</PillBtn>
          <PillBtn onClick={() => setShowBacktest((v) => !v)} active={showBacktest}>⚡ Backtest</PillBtn>
          <Sep />
          <PillBtn onClick={reset}>◀◀</PillBtn>
          <PillBtn onClick={handlePlayPause} active={playing}>{playing ? "⏸ Pause" : "▶ Play"}</PillBtn>
          <PillBtn onClick={stepForward}>⏭ Step</PillBtn>
          <PillBtn onClick={() => setScissorsMode((v) => !v)} active={scissorsMode}>✂ Scissors</PillBtn>
          <PillBtn onClick={goToEnd}>▶▶ Live</PillBtn>
          <Sep />
          <span style={{ marginLeft: 4, color: COLORS.textDim, fontSize: 11 }}>Speed:</span>
          {(["1x", "5x", "10x", "50x"] as const).map((s) => <SpeedBtn key={s} s={s} speed={speed} setSpeed={setSpeed} />)}
          <Sep />
          <span style={{ color: COLORS.textDim, fontSize: 11 }}>From</span>
          <input
            type="date"
            value={startDate}
            min="2020-01-01"
            max={endDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{ background: COLORS.pill, color: COLORS.textDim, border: `1px solid ${COLORS.border}`, padding: "4px 6px", borderRadius: 4, fontSize: 11, marginLeft: 4 }}
          />
          <span style={{ color: COLORS.textDim, fontSize: 11, marginLeft: 6 }}>To</span>
          <input
            type="date"
            value={endDate}
            min="2020-01-01"
            max={todayStr()}
            onChange={(e) => setEndDate(e.target.value)}
            style={{ background: COLORS.pill, color: COLORS.textDim, border: `1px solid ${COLORS.border}`, padding: "4px 6px", borderRadius: 4, fontSize: 11, marginLeft: 4 }}
          />
          <button
            onClick={loadData}
            style={{ marginLeft: 6, background: COLORS.cyan, color: "#0b0f19", border: "none", padding: "6px 12px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontWeight: 600 }}
          >
            Load Data
          </button>
        </div>
      </div>

      {/* MAIN AREA */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div ref={chartContainerRef} style={{ flex: 1, position: "relative", minWidth: 0, cursor: scissorsMode ? "crosshair" : "default" }}>
          {scissorsMode && (
            <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", background: "rgba(0,200,224,0.15)", border: `1px solid ${COLORS.cyan}`, color: COLORS.cyan, padding: "4px 10px", borderRadius: 4, fontSize: 11, zIndex: 20, pointerEvents: "none" }}>
              ✂ Click any candle to cut & rewind to that point
            </div>
          )}
          {loading && (
            <div style={{ position: "absolute", inset: 0, background: "rgba(11,15,25,0.85)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 50, color: "#ddd" }}>
              <div style={{ width: 40, height: 40, border: `3px solid ${COLORS.cyan}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
              <div style={{ marginTop: 16, color: COLORS.cyan, fontFamily: "ui-monospace, monospace" }}>{loadingMessage}</div>
              <div style={{ marginTop: 8, color: COLORS.textDim, fontSize: 12 }}>
                {loadProgress.fetched.toLocaleString()} / {loadProgress.total.toLocaleString()} bars
              </div>
              <div style={{ marginTop: 8, width: 240, height: 4, background: COLORS.border, borderRadius: 2 }}>
                <div style={{ width: `${Math.min(100, (loadProgress.fetched / Math.max(1, loadProgress.total)) * 100)}%`, height: "100%", background: COLORS.cyan, borderRadius: 2 }} />
              </div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}
          {snapshot && (
            <div style={{ position: "absolute", left: 8, top: 8, background: "rgba(8,11,16,0.7)", padding: "4px 8px", borderRadius: 4, fontSize: 10, fontFamily: "ui-monospace,monospace", color: COLORS.textDim, zIndex: 5 }}>
              <span>State: <span style={{ color: STATE_COLOR[snapshot.state] }}>{STATE_LABEL[snapshot.state]}</span></span>
              <span style={{ marginLeft: 12 }}>Bar {currentBarIndex + 1}/{barsRef.current.length}</span>
              {snapshot.inBuyTrade && (
                <span style={{ marginLeft: 12, color: "#26a69a" }}>
                  IN TRADE | Mid: {snapshot.midTouched ? <span style={{ color: "#ff3333" }}>TOUCHED</span> : <span style={{ color: "#ffd700" }}>WAITING</span>}
                </span>
              )}
              {snapshot.openSells.length > 0 && (
                <span style={{ marginLeft: 12, color: "#ffd700" }}>
                  SELLS OPEN: {snapshot.openSells.length}
                </span>
              )}
            </div>
          )}

          {/* Legend */}
          <div style={{ position: "absolute", right: 8, bottom: 8, background: "rgba(8,11,16,0.8)", padding: "6px 10px", borderRadius: 4, fontSize: 10, fontFamily: "ui-monospace,monospace", zIndex: 5, display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 20, height: 0, borderTop: "2px dashed #4488FFcc", display: "inline-block" }}></span>
              <span style={{ color: COLORS.textDim }}>Buy SL</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 20, height: 0, borderTop: "2px dashed #26a69aaa", display: "inline-block" }}></span>
              <span style={{ color: COLORS.textDim }}>Buy TP</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 20, height: 0, borderTop: "1px dotted #ffd70099", display: "inline-block" }}></span>
              <span style={{ color: COLORS.textDim }}>Midpoint / Sell Entry</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, paddingTop: 2, borderTop: `1px solid ${COLORS.border}` }}>
              <span style={{ color: "#fff" }}>Manual</span>
              <span style={{ color: COLORS.textDim }}>= solid lines</span>
            </div>
          </div>
        </div>
        {showBacktest && (
          <BacktestPanel
            params={params}
            onParamsChange={setParams}
            startDate={startDate}
            endDate={endDate}
            onStartDate={setStartDate}
            onEndDate={setEndDate}
            onRun={runBacktest}
            results={results}
            running={running}
            onClose={() => setShowBacktest(false)}
          />
        )}
      </div>

      {showStats && <Dashboard snapshot={snapshot} onClose={() => setShowStats(false)} />}
      {showDemo && (
        <Demo
          demo={demo}
          onUpdate={(d) => setDemo((prev) => ({ ...prev, ...d, balance: d.startBalance !== undefined ? d.startBalance : prev.balance }))}
          onReset={() => setDemo((d) => ({ ...d, balance: d.startBalance, openTrades: [], log: [], totalR: 0 }))}
          onClose={() => setShowDemo(false)}
        />
      )}
      {showManual && (
        <ManualTradePanel
          state={manual}
          onUpdate={(d) => setManual((prev) => ({ ...prev, ...d }))}
          onBuy={(lot, riskPts, rr) => placeManualTrade("BUY", lot, riskPts, rr)}
          onSell={(lot, riskPts, rr) => placeManualTrade("SELL", lot, riskPts, rr)}
          onCloseTrade={closeManualTrade}
          onReset={resetManual}
          onClose={() => setShowManual(false)}
        />
      )}
    </div>
  );
}
