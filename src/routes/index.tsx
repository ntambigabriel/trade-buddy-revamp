import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

// Charts depend on `window`; load only on the client.
const PO3App = lazy(() => import("@/components/po3/PO3App"));

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <Suspense
      fallback={
        <div style={{ position: "fixed", inset: 0, background: "#0b0f19", color: "#8aaabb", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "ui-monospace,monospace" }}>
          Loading PO3…
        </div>
      }
    >
      <PO3App />
    </Suspense>
  );
}
