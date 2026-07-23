"use client";
/**
 * TransferFlowDiagram — SVG flow visualization between providers.
 *
 * A simplified alluvial/Sankey diagram showing money movement between
 * bKash, Nagad, and Rocket. Each provider is a node; flow width is
 * proportional to the transfer amount.
 *
 * Since we have exactly 3 providers, the layout is fixed:
 *   bKash (left)  →  Nagad (center)  →  Rocket (right)
 * Flows go from one node to another with curved paths whose stroke
 * width encodes the amount.
 *
 * Features:
 *  - Node circles with provider colors and labels
 *  - Curved flow arcs with width = proportional to amount
 *  - Tooltip showing exact amount and count
 *  - Legend shows total flow out of each provider
 */

import { useMemo, useState } from "react";
import { formatBDT } from "@/lib/time";
import { PROVIDER_HEX, PROVIDER_LABEL, type Provider } from "@/features/wallet/types";
import type { TransferFlow } from "./types";

interface TransferFlowDiagramProps {
  flows: TransferFlow[];
  height?: number;
}

interface FlowArc {
  fromProvider: Provider;
  toProvider: Provider;
  amount: number;
  count: number;
  /** 0..1 weight for stroke width */
  weight: number;
  /** SVG path for the curved arc */
  path: string;
}

export function TransferFlowDiagram({ flows, height = 200 }: TransferFlowDiagramProps) {
  const [hoveredFlow, setHoveredFlow] = useState<string | null>(null);

  const { arcs, maxAmount, totalFlow } = useMemo(() => {
    let max = 0;
    let total = 0;
    for (const f of flows) {
      if (f.totalBdt > max) max = f.totalBdt;
      total += f.totalBdt;
    }
    const a: FlowArc[] = flows.map((f) => ({
      fromProvider: f.fromProvider,
      toProvider: f.toProvider,
      amount: f.totalBdt,
      count: f.count,
      weight: max > 0 ? f.totalBdt / max : 0,
      path: "",
    }));
    return { arcs: a, maxAmount: max, totalFlow: total };
  }, [flows]);

  if (flows.length === 0) return null;

  const w = 500;
  const h = height;
  const nodeY: Record<Provider, number> = {
    bkash: h * 0.2,
    nagad: h * 0.5,
    rocket: h * 0.8,
  };

  const nodeX = w * 0.15;
  const nodeX2 = w * 0.85;

  const minStroke = 2;
  const maxStroke = 32;

  // Compute paths for each arc
  const arcsWithPaths = useMemo(() => {
    return arcs.map((a) => {
      const y1 = nodeY[a.fromProvider];
      const y2 = nodeY[a.toProvider];
      const strokeW = minStroke + a.weight * (maxStroke - minStroke);
      const midX = (nodeX + nodeX2) / 2;
      const midY = (y1 + y2) / 2;
      // Quadratic bezier: start (nodeX, y1) -> control (midX, midY) -> end (nodeX2, y2)
      const path = `M${nodeX},${y1} Q${midX},${midY} ${nodeX2},${y2}`;
      return { ...a, path, strokeW };
    });
  }, [arcs, nodeY]);

  const providerOutflow = useMemo(() => {
    const out: Record<Provider, number> = { bkash: 0, nagad: 0, rocket: 0 };
    for (const f of flows) {
      out[f.fromProvider] += f.totalBdt;
    }
    return out;
  }, [flows]);

  const providerInflow = useMemo(() => {
    const in_: Record<Provider, number> = { bkash: 0, nagad: 0, rocket: 0 };
    for (const f of flows) {
      in_[f.toProvider] += f.totalBdt;
    }
    return in_;
  }, [flows]);

  const hoveredArc = hoveredFlow
    ? arcsWithPaths.find((a) => `${a.fromProvider}-${a.toProvider}` === hoveredFlow)
    : null;

  return (
    <section className="rounded-2xl border border-border bg-surface shadow-card">
      <div className="border-b border-border px-4 py-2.5">
        <span className="eyebrow">Transfer Flow</span>
      </div>
      <div className="relative p-3 sm:p-4">
        <svg
          role="img"
          aria-label="Transfer flow diagram"
          viewBox={`0 0 ${w} ${h}`}
          className="w-full motion-respects"
          style={{ height }}
        >
          {/* Flow arcs */}
          {arcsWithPaths.map((a) => {
            const key = `${a.fromProvider}-${a.toProvider}`;
            const isHovered = hoveredFlow === key;
            return (
              <g key={key}>
                {/* Invisible wide hit area */}
                <path
                  d={a.path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={maxStroke + 12}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHoveredFlow(key)}
                  onMouseLeave={() => setHoveredFlow(null)}
                />
                {/* Visible arc */}
                <path
                  d={a.path}
                  fill="none"
                  stroke={PROVIDER_HEX[a.fromProvider]}
                  strokeWidth={isHovered ? a.strokeW + 6 : a.strokeW}
                  strokeLinecap="round"
                  opacity={isHovered ? 0.9 : 0.5}
                  className="transition-all duration-200"
                />
                {/* Arrow dots along the path */}
                <circle cx={(nodeX + (nodeX + nodeX2) / 2) / 2 + (nodeX2 - nodeX) * 0.15} cy={nodeY[a.fromProvider] + (nodeY[a.toProvider] - nodeY[a.fromProvider]) * 0.3} r={isHovered ? 3 : 2} fill={PROVIDER_HEX[a.toProvider]} opacity={isHovered ? 0.9 : 0.6} />
              </g>
            );
          })}

          {/* Node circles + labels */}
          {(Object.keys(nodeY) as Provider[]).map((prov) => (
            <g key={prov}>
              <circle
                cx={nodeX}
                cy={nodeY[prov]}
                r={16}
                fill={PROVIDER_HEX[prov]}
                opacity={0.15}
              />
              <circle
                cx={nodeX}
                cy={nodeY[prov]}
                r={8}
                fill={PROVIDER_HEX[prov]}
              />
              <text
                x={nodeX}
                y={nodeY[prov] + 24}
                textAnchor="middle"
                fill="var(--color-ink)"
                fontSize="10"
                fontWeight="600"
              >
                {PROVIDER_LABEL[prov]}
              </text>
              <text
                x={nodeX}
                y={nodeY[prov] + 36}
                textAnchor="middle"
                fill="var(--color-muted)"
                fontSize="8"
                className="num"
              >
                Out: {formatBDT(providerOutflow[prov])}
              </text>
            </g>
          ))}

          {/* Destination nodes */}
          {(Object.keys(nodeY) as Provider[]).map((prov) => (
            <g key={`dst-${prov}`}>
              <circle
                cx={nodeX2}
                cy={nodeY[prov]}
                r={16}
                fill={PROVIDER_HEX[prov]}
                opacity={0.15}
              />
              <circle
                cx={nodeX2}
                cy={nodeY[prov]}
                r={8}
                fill={PROVIDER_HEX[prov]}
              />
              <text
                x={nodeX2}
                y={nodeY[prov] + 24}
                textAnchor="middle"
                fill="var(--color-ink)"
                fontSize="10"
                fontWeight="600"
              >
                {PROVIDER_LABEL[prov]}
              </text>
              <text
                x={nodeX2}
                y={nodeY[prov] + 36}
                textAnchor="middle"
                fill="var(--color-muted)"
                fontSize="8"
                className="num"
              >
                In: {formatBDT(providerInflow[prov])}
              </text>
            </g>
          ))}
        </svg>

        {/* Tooltip */}
        {hoveredArc && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-border bg-surface px-3 py-2 shadow-card"
            style={{ left: "50%", top: "0", transform: "translate(-50%, 0)" }}
          >
            <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: PROVIDER_HEX[hoveredArc.fromProvider] }} />
              {PROVIDER_LABEL[hoveredArc.fromProvider]}
              <span className="text-muted">→</span>
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: PROVIDER_HEX[hoveredArc.toProvider] }} />
              {PROVIDER_LABEL[hoveredArc.toProvider]}
            </p>
            <p className="num mt-1 text-xs text-ink">
              {formatBDT(hoveredArc.amount)}
              <span className="text-muted ml-1">· {hoveredArc.count} transfer{hoveredArc.count !== 1 ? "s" : ""}</span>
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
