import { useEffect, useRef, useState, ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

interface Props {
  initial: { x: number; y: number };
  width: number;
  zIndex?: number;
  children: (handle: { onMouseDown: (e: React.MouseEvent | React.TouchEvent) => void }) => ReactNode;
}

export default function Draggable({ initial, width, zIndex = 100, children }: Props) {
  const isMobile = useIsMobile();
  const [pos, setPos] = useState(initial);
  const dragRef = useRef<{ ox: number; oy: number; sx: number; sy: number } | null>(null);

  useEffect(() => {
    const getPoint = (e: MouseEvent | TouchEvent) => {
      if ("touches" in e) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
      return { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY };
    };
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragRef.current) return;
      const { ox, oy, sx, sy } = dragRef.current;
      const p = getPoint(e);
      setPos({ x: ox + (p.x - sx), y: oy + (p.y - sy) });
    };
    const onUp = () => { dragRef.current = null; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
    };
  }, []);

  const onMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    const p = "touches" in e
      ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
      : { x: e.clientX, y: e.clientY };
    dragRef.current = { ox: pos.x, oy: pos.y, sx: p.x, sy: p.y };
  };

  // On mobile, dock as full-width bottom sheet — ignore drag pos.
  const style: React.CSSProperties = isMobile
    ? {
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        width: "100%",
        maxHeight: "55vh",
        overflowY: "auto",
        zIndex,
      }
    : {
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width,
        zIndex,
      };

  return <div style={style}>{children({ onMouseDown })}</div>;
}
