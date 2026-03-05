"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { drag } from "d3-drag";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomTransform } from "d3-zoom";

type GraphNode = {
  id: string;
  fid: number;
  username: string | null;
  display_name: string | null;
  pfp_url: string | null;
};

type GraphEdge = {
  source: string;
  target: string;
  weight: number;
  label: string;
};

type MentionGraphResponse = {
  graph_type: string;
  semantics: string;
  seed: {
    fid: number;
    username: string | null;
    display_name: string | null;
    pfp_url: string | null;
  };
  degree: number | null;
  path: string[] | null;
  stats: {
    node_count: number;
    edge_count: number;
    expanded_users: number;
    crawl_depth: number;
    casts_per_user: number;
  };
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type SimNode = GraphNode & SimulationNodeDatum;
type SimLink = SimulationLinkDatum<SimNode> & {
  source: string | SimNode;
  target: string | SimNode;
  weight: number;
  label: string;
};

function nodeLabel(node: GraphNode) {
  return node.username ? `@${node.username}` : `fid:${node.fid}`;
}

function initials(node: GraphNode) {
  const base = node.display_name || node.username || String(node.fid);
  const trimmed = base.trim();
  if (!trimmed) return "?";
  return trimmed.slice(0, 2).toUpperCase();
}

export default function MentionGraphClient() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageCacheRef = useRef<Record<string, HTMLImageElement>>({});
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const [graphSize, setGraphSize] = useState({ width: 1000, height: 640 });

  const [source, setSource] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MentionGraphResponse | null>(null);
  const [activityOnly, setActivityOnly] = useState(true);

  const activityGraphData = useMemo(() => {
    if (!data) return null;

    if (!activityOnly) {
      return { nodes: data.nodes, links: data.edges };
    }

    const focusId = String(data.seed.fid);
    const focusLinks = data.edges.filter((edge) => edge.source === focusId || edge.target === focusId);
    const nodeIds = new Set<string>([focusId]);

    for (const edge of focusLinks) {
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    }

    const links = data.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
    const nodes = data.nodes.filter((node) => nodeIds.has(node.id));
    return { nodes, links };
  }, [activityOnly, data]);

  const activityCounts = useMemo(() => {
    if (!data) return { outgoing: 0, incoming: 0 };

    const focusId = String(data.seed.fid);
    let outgoing = 0;
    let incoming = 0;

    for (const edge of data.edges) {
      if (edge.source === focusId) outgoing += edge.weight;
      if (edge.target === focusId) incoming += edge.weight;
    }

    return { outgoing, incoming };
  }, [data]);

  useEffect(() => {
    if (!data) return;

    for (const node of data.nodes) {
      if (!node.pfp_url) continue;
      if (imageCacheRef.current[node.id]) continue;

      const img = new Image();
      img.src = node.pfp_url;
      imageCacheRef.current[node.id] = img;
    }
  }, [data]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setGraphSize({
        width: Math.max(320, rect.width),
        height: Math.max(420, rect.height),
      });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!data || !activityGraphData) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = graphSize.width;
    const height = graphSize.height;
    const dpr = window.devicePixelRatio || 1;
    const focusId = String(data.seed.fid);

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const context = canvas.getContext("2d");
    if (!context) return;

    const nodes: SimNode[] = activityGraphData.nodes.map((node) => ({ ...node }));
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const links: SimLink[] = [];
    for (const edge of activityGraphData.links) {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) continue;
      links.push({ ...edge, source, target });
    }

    const draw = () => {
      const t = transformRef.current;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      context.save();
      context.translate(t.x, t.y);
      context.scale(t.k, t.k);

      for (const link of links) {
        const source = link.source as SimNode;
        const target = link.target as SimNode;
        if (!Number.isFinite(source.x) || !Number.isFinite(source.y) || !Number.isFinite(target.x) || !Number.isFinite(target.y)) {
          continue;
        }

        const sourceId = source.id;
        const targetId = target.id;
        let stroke = "#94a3b8";
        if (sourceId === focusId) stroke = "#2563eb";
        else if (targetId === focusId) stroke = "#f59e0b";

        context.strokeStyle = stroke;
        context.lineWidth = Math.min(4, 1 + link.weight * 0.4) / Math.sqrt(t.k);
        context.beginPath();
        context.moveTo(source.x!, source.y!);
        context.lineTo(target.x!, target.y!);
        context.stroke();

        const angle = Math.atan2(target.y! - source.y!, target.x! - source.x!);
        const arrow = 6 / t.k;
        context.fillStyle = stroke;
        context.beginPath();
        context.moveTo(target.x!, target.y!);
        context.lineTo(target.x! - arrow * Math.cos(angle - Math.PI / 7), target.y! - arrow * Math.sin(angle - Math.PI / 7));
        context.lineTo(target.x! - arrow * Math.cos(angle + Math.PI / 7), target.y! - arrow * Math.sin(angle + Math.PI / 7));
        context.closePath();
        context.fill();
      }

      for (const node of nodes) {
        if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
        const x = node.x!;
        const y = node.y!;
        const isFocus = node.id === focusId;
        const radius = isFocus ? 18 : 14;
        const borderWidth = isFocus ? 3 : 2;
        const img = imageCacheRef.current[node.id];

        context.save();
        context.beginPath();
        context.arc(x, y, radius, 0, 2 * Math.PI, false);
        context.closePath();
        context.clip();

        if (img && img.complete && img.naturalWidth > 0) {
          context.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
        } else {
          context.fillStyle = isFocus ? "#0f766e" : "#3b82f6";
          context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
          context.fillStyle = "#ffffff";
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.font = `${Math.max(10, radius * 0.75)}px sans-serif`;
          context.fillText(initials(node), x, y);
        }
        context.restore();

        context.beginPath();
        context.arc(x, y, radius, 0, 2 * Math.PI, false);
        context.strokeStyle = isFocus ? "#0f766e" : "#ffffff";
        context.lineWidth = borderWidth;
        context.stroke();

        context.fillStyle = "#111";
        context.textAlign = "left";
        context.textBaseline = "middle";
        context.font = `${Math.max(10, 11 / t.k)}px sans-serif`;
        context.fillText(nodeLabel(node), x + radius + 6, y);
      }

      context.restore();
    };

    const simulation = forceSimulation(nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((node) => node.id)
          .distance(130)
          .strength(0.18)
      )
      .force("charge", forceManyBody<SimNode>().strength(-380))
      .force("collide", forceCollide<SimNode>().radius((node) => (node.id === focusId ? 36 : 30)))
      .force("center", forceCenter(width / 2, height / 2))
      .alpha(1);

    const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.25, 5])
      .on("zoom", (event) => {
        transformRef.current = event.transform;
        draw();
      });

    const selection = select(canvas);
    selection.call(zoomBehavior as never);
    selection.on("dblclick.zoom", null);

    const dragBehavior = drag<HTMLCanvasElement, unknown>()
      .subject((event) => {
        const [gx, gy] = transformRef.current.invert([event.x, event.y]);
        return simulation.find(gx, gy, 32 / transformRef.current.k) ?? null;
      })
      .on("start", (event) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        const node = event.subject as SimNode;
        node.fx = node.x;
        node.fy = node.y;
      })
      .on("drag", (event) => {
        const node = event.subject as SimNode;
        const [gx, gy] = transformRef.current.invert([event.x, event.y]);
        node.fx = gx;
        node.fy = gy;
      })
      .on("end", (event) => {
        if (!event.active) simulation.alphaTarget(0);
        const node = event.subject as SimNode;
        node.fx = null;
        node.fy = null;
      });

    selection.call(dragBehavior as never);

    const fitToView = () => {
      if (nodes.length === 0) return;
      const valid = nodes.filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y));
      if (valid.length === 0) return;

      const xs = valid.map((node) => node.x!);
      const ys = valid.map((node) => node.y!);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const padding = 120;

      const graphW = Math.max(1, maxX - minX);
      const graphH = Math.max(1, maxY - minY);
      const k = Math.min((width - padding) / graphW, (height - padding) / graphH, 1.5);
      const tx = width / 2 - (minX + maxX) * 0.5 * k;
      const ty = height / 2 - (minY + maxY) * 0.5 * k;
      const next = zoomIdentity.translate(tx, ty).scale(k);

      transformRef.current = next;
      selection.call(zoomBehavior.transform as never, next);
      draw();
    };

    simulation.on("tick", draw);
    simulation.on("end", () => {
      fitToView();
      draw();
    });
    draw();

    return () => {
      simulation.stop();
      selection.on(".zoom", null);
      selection.on(".drag", null);
    };
  }, [activityGraphData, data, graphSize.height, graphSize.width]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/mention-graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to build graph");
      }

      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell shell-overlay">
      <section className="graph graph-full" ref={containerRef}>
        <div className="floating-panel">
          <h1>Farcaster Mention Graph</h1>
          <p>
            Directed graph where <code>B -&gt; A</code> means user B mentioned user A.
          </p>

          <form onSubmit={onSubmit} className="controls controls-floating">
            <label>
              Source
              <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="dwr or 3" required />
            </label>

            <button type="submit" disabled={loading}>
              {loading ? "Building..." : "Build Graph"}
            </button>
          </form>

          {error ? <p className="error">{error}</p> : null}

          {data ? (
            <div className="stats">
              <span>nodes: {data.stats.node_count}</span>
              <span>edges: {data.stats.edge_count}</span>
              <span>outgoing tags: {activityCounts.outgoing}</span>
              <span>incoming mentions: {activityCounts.incoming}</span>
            </div>
          ) : null}

          {data ? (
            <div className="legend">
              <label>
                <input type="checkbox" checked={activityOnly} onChange={(e) => setActivityOnly(e.target.checked)} />
                show only selected account activity
              </label>
              <span>
                <i className="swatch swatch-out" /> outgoing = they tagged someone
              </span>
              <span>
                <i className="swatch swatch-in" /> incoming = they got mentioned
              </span>
            </div>
          ) : null}
        </div>

        {data && activityGraphData ? (
          <canvas ref={canvasRef} className="graph-canvas" aria-label="Mention graph canvas" />
        ) : (
          <div className="placeholder">Build a graph to render interactive visualization.</div>
        )}
      </section>
    </main>
  );
}
