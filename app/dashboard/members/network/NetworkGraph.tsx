"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface Node {
  id: string;
  name: string;
  email: string;
  totalPrickles: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

interface Edge {
  source: string;
  target: string;
  weight: number;
  normalizedWeight: number;
}

interface NetworkGraphProps {
  nodes: Node[];
  edges: Edge[];
}

export default function NetworkGraph({ nodes: initialNodes, edges }: NetworkGraphProps) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const canvasRef = useRef<SVGSVGElement>(null);
  const animationRef = useRef<number | undefined>(undefined);

  const width = 1200;
  const height = 800;

  // Initialize node positions
  useEffect(() => {
    const initializedNodes = initialNodes.map((node, i) => ({
      ...node,
      x: width / 2 + Math.random() * 200 - 100,
      y: height / 2 + Math.random() * 200 - 100,
      vx: 0,
      vy: 0,
    }));
    setNodes(initializedNodes);
  }, [initialNodes]);

  // Simple force simulation
  useEffect(() => {
    if (nodes.length === 0) return;

    const simulate = () => {
      setNodes(prevNodes => {
        const newNodes = prevNodes.map(node => ({ ...node }));

        // Apply forces
        for (let i = 0; i < newNodes.length; i++) {
          const node = newNodes[i];
          if (!node.x || !node.y) continue;

          // Center force
          const centerX = width / 2;
          const centerY = height / 2;
          const toCenterX = (centerX - node.x) * 0.001;
          const toCenterY = (centerY - node.y) * 0.001;
          node.vx! += toCenterX;
          node.vy! += toCenterY;

          // Repulsion from other nodes
          for (let j = 0; j < newNodes.length; j++) {
            if (i === j) continue;
            const other = newNodes[j];
            if (!other.x || !other.y) continue;

            const dx = node.x - other.x;
            const dy = node.y - other.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;

            if (dist < 200) {
              const force = 50 / (dist * dist);
              node.vx! += (dx / dist) * force;
              node.vy! += (dy / dist) * force;
            }
          }

          // Attraction along edges
          edges.forEach(edge => {
            let other: Node | undefined;
            let isSource = false;

            if (edge.source === node.id) {
              other = newNodes.find(n => n.id === edge.target);
              isSource = true;
            } else if (edge.target === node.id) {
              other = newNodes.find(n => n.id === edge.source);
            }

            if (other && other.x && other.y && node.x && node.y) {
              const dx = other.x - node.x;
              const dy = other.y - node.y;
              const dist = Math.sqrt(dx * dx + dy * dy) || 1;

              // Stronger edges pull nodes closer
              const force = (edge.weight / 100) * 0.01;
              node.vx! += (dx / dist) * force;
              node.vy! += (dy / dist) * force;
            }
          });

          // Apply velocity with damping
          node.vx! *= 0.9;
          node.vy! *= 0.9;
          node.x += node.vx!;
          node.y += node.vy!;

          // Keep in bounds
          node.x = Math.max(50, Math.min(width - 50, node.x));
          node.y = Math.max(50, Math.min(height - 50, node.y));
        }

        return newNodes;
      });

      animationRef.current = requestAnimationFrame(simulate);
    };

    animationRef.current = requestAnimationFrame(simulate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [edges, nodes.length]);

  // Filter nodes and edges based on search/selection
  const filteredNodes = nodes.filter(node =>
    node.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const highlightedNodeIds = new Set<string>();
  if (selectedNodeId) {
    highlightedNodeIds.add(selectedNodeId);
    edges.forEach(edge => {
      if (edge.source === selectedNodeId) highlightedNodeIds.add(edge.target);
      if (edge.target === selectedNodeId) highlightedNodeIds.add(edge.source);
    });
  }

  const visibleEdges = edges.filter(edge => {
    // Only show edges connected to selected node, or top edges if no selection
    if (selectedNodeId) {
      return edge.source === selectedNodeId || edge.target === selectedNodeId;
    }
    // Show top 50 strongest connections by default
    return edges.indexOf(edge) < 50;
  });

  const getNodeSize = (node: Node) => {
    const base = 8;
    const scale = Math.min(node.totalPrickles / 10, 3);
    return base + scale * 3;
  };

  const getEdgeWidth = (edge: Edge) => {
    return Math.max(1, Math.min(edge.weight / 10, 5));
  };

  const getEdgeOpacity = (edge: Edge) => {
    if (selectedNodeId) {
      return edge.source === selectedNodeId || edge.target === selectedNodeId ? 0.6 : 0.1;
    }
    return 0.3;
  };

  const handleNodeClick = (nodeId: string) => {
    setSelectedNodeId(selectedNodeId === nodeId ? null : nodeId);
  };

  const selectedNode = nodes.find(n => n.id === selectedNodeId);
  const connections = selectedNodeId
    ? edges.filter(e => e.source === selectedNodeId || e.target === selectedNodeId)
        .map(e => ({
          ...e,
          otherNodeId: e.source === selectedNodeId ? e.target : e.source,
        }))
        .sort((a, b) => b.weight - a.weight)
    : [];

  return (
    <div className="space-y-4">
      {/* Search and Controls */}
      <div className="flex items-center gap-4">
        <input
          type="text"
          placeholder="Search members..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
        />
        {selectedNodeId && (
          <button
            onClick={() => setSelectedNodeId(null)}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600"
          >
            Clear Selection
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Graph */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-lg shadow p-4">
          <svg
            ref={canvasRef}
            width={width}
            height={height}
            className="border border-slate-200 dark:border-slate-700 rounded"
          >
            {/* Edges */}
            <g>
              {visibleEdges.map((edge, i) => {
                const sourceNode = nodes.find(n => n.id === edge.source);
                const targetNode = nodes.find(n => n.id === edge.target);
                if (!sourceNode?.x || !targetNode?.x) return null;

                return (
                  <line
                    key={i}
                    x1={sourceNode.x}
                    y1={sourceNode.y}
                    x2={targetNode.x}
                    y2={targetNode.y}
                    stroke="#94a3b8"
                    strokeWidth={getEdgeWidth(edge)}
                    opacity={getEdgeOpacity(edge)}
                  />
                );
              })}
            </g>

            {/* Nodes */}
            <g>
              {filteredNodes.map(node => {
                if (!node.x || !node.y) return null;
                const isHighlighted = highlightedNodeIds.has(node.id);
                const isSelected = node.id === selectedNodeId;

                return (
                  <g
                    key={node.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => handleNodeClick(node.id)}
                  >
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={getNodeSize(node)}
                      fill={isSelected ? "#3b82f6" : isHighlighted ? "#60a5fa" : "#64748b"}
                      stroke={isSelected ? "#1e40af" : "none"}
                      strokeWidth={isSelected ? 3 : 0}
                      opacity={searchTerm && !node.name.toLowerCase().includes(searchTerm.toLowerCase()) ? 0.2 : 1}
                    />
                    {(isSelected || isHighlighted) && (
                      <text
                        x={node.x}
                        y={node.y - getNodeSize(node) - 5}
                        textAnchor="middle"
                        fontSize="12"
                        fill="#1e293b"
                        className="dark:fill-slate-100"
                      >
                        {node.name}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        {/* Details Panel */}
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4">
          <h3 className="font-semibold text-lg mb-4">
            {selectedNode ? selectedNode.name : "Network Overview"}
          </h3>

          {selectedNode ? (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">{selectedNode.email}</p>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  {selectedNode.totalPrickles} total prickles
                </p>
                <button
                  onClick={() => router.push(`/dashboard/members/${selectedNode.id}`)}
                  className="mt-2 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
                >
                  View profile →
                </button>
              </div>

              <div>
                <h4 className="font-medium text-sm mb-2">
                  Top Connections ({connections.length})
                </h4>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {connections.slice(0, 20).map(conn => {
                    const otherNode = nodes.find(n => n.id === conn.otherNodeId);
                    if (!otherNode) return null;

                    return (
                      <div
                        key={conn.otherNodeId}
                        className="p-2 bg-slate-50 dark:bg-slate-800 rounded cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700"
                        onClick={() => handleNodeClick(conn.otherNodeId)}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{otherNode.name}</span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {conn.weight} prickles
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {conn.normalizedWeight}% of attendance overlap
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Click on any member to see their connections.
              </p>
              <div className="text-sm">
                <p className="font-medium mb-1">Network Stats</p>
                <p className="text-slate-600 dark:text-slate-400">
                  {nodes.length} active members
                </p>
                <p className="text-slate-600 dark:text-slate-400">
                  {edges.length} connections
                </p>
                <p className="text-slate-600 dark:text-slate-400 text-xs mt-2">
                  Showing top 50 strongest connections
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
