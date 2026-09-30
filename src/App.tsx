import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Blocks,
  ChevronDown,
  ChevronUp,
  Diamond,
  Focus,
  Group,
  Lightbulb,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Workflow,
} from 'lucide-react';
import {
  AiContradiction,
  AiInterviewQuestion,
  AiProposalCard,
  ElementType,
  GitCommit,
  LocaleKey,
  NegativePaletteKey,
  PlanElement,
  PositivePaletteKey,
  RelationType,
  ThemeMode,
  UnitLibraryItem,
} from './types/planager';
import {
  I18N_DICTIONARY,
  INITIAL_ELEMENTS,
  INITIAL_FILES,
  INITIAL_UNIT_LIBRARY,
  NEGATIVE_PALETTES,
  POSITIVE_PALETTES,
} from './data/initialProject';
import {
  buildAndValidateGraph,
  computeLineDiff,
  parsePgrFileContent,
  resolveInheritedFieldsForObject,
  serializeFileWithRanges,
  TYPE_HEADERS_RU,
  TYPE_PREFIXES,
} from './utils/pgrCodec';
import {
  buildRagIndex,
  generateLocalAnalysis,
  generateLocalInterviewQuestions,
  generateLocalTransformation,
} from './utils/aiEngine';

type PrimaryTab = 'kb' | 'canvas' | 'library' | 'settings';

const ELEMENT_TYPE_ICONS: Record<
  ElementType,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  system: Blocks,
  class: Group,
  object: Focus,
  component: Diamond,
  process: Workflow,
  idea: Lightbulb,
};

function stripElementPrefix(id: string): string {
  return id.replace(/^(sys|cls|obj|cmp|proc|idea)_/, '');
}

function createSnapshotMap(
  elements: PlanElement[],
  files: string[]
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of files) {
    map[f] = serializeFileWithRanges(elements, f).content;
  }
  return map;
}

// Shared topology-aware layout generator that keeps tightly coupled nodes in the core
// and pushes peripheral radicals / secondary sub-clusters (like join_faction -> factions + reputation_bound) outward
function computeClusteredGraphPositions(
  nodes: PlanElement[],
  activeEdges: ReturnType<typeof buildAndValidateGraph>['edges'],
  W: number,
  H: number,
  baseScale: number,
  spread: number,
  preferredAnchorId?: string | null,
  lockedCenters?: Record<string, { x: number; y: number }>
): Record<string, { x: number; y: number }> {
  const cx = W / 2;
  const cy = H / 2;
  const scale = baseScale * spread;
  const posMap: Record<string, { x: number; y: number }> = {};
  if (nodes.length === 0) return posMap;

  const nodeMap = new Map<string, PlanElement>();
  nodes.forEach((n) => nodeMap.set(n.id, n));

  const adj: Record<string, Set<string>> = {};
  nodes.forEach((n) => {
    adj[n.id] = new Set<string>();
  });
  activeEdges.forEach((e) => {
    if (adj[e.source] && adj[e.target] && e.source !== e.target) {
      adj[e.source].add(e.target);
      adj[e.target].add(e.source);
    }
  });

  const getClusterRoot = (el: PlanElement): string => {
    if (el.type === 'system') return el.id;
    if (el.parent && el.parent !== '-') return el.parent;
    if (el.altTo && el.altTo !== '-') return el.altTo;
    return el.fileName;
  };

  // Determine anchor node (preferredAnchorId if present, else highest-degree node)
  let anchorId =
    preferredAnchorId && nodeMap.has(preferredAnchorId)
      ? preferredAnchorId
      : nodes[0].id;
  if (!preferredAnchorId || !nodeMap.has(preferredAnchorId)) {
    let bestDeg = -1;
    nodes.forEach((n) => {
      const deg = adj[n.id]?.size || 0;
      if (deg > bestDeg) {
        bestDeg = deg;
        anchorId = n.id;
      }
    });
  }

  const anchorEl = nodeMap.get(anchorId)!;
  const anchorCluster = getClusterRoot(anchorEl);

  // BFS hop distance from anchorId
  const hopDist: Record<string, number> = {};
  nodes.forEach((n) => {
    hopDist[n.id] = Infinity;
  });
  hopDist[anchorId] = 0;
  const queue: string[] = [anchorId];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    const d = hopDist[curr];
    adj[curr].forEach((nb) => {
      if (hopDist[nb] === Infinity) {
        hopDist[nb] = d + 1;
        queue.push(nb);
      }
    });
  }

  // Identify Core Cluster vs Peripheral Radicals
  const sameSystemSet = new Set<string>();
  nodes.forEach((n) => {
    if (getClusterRoot(n) === anchorCluster) {
      sameSystemSet.add(n.id);
    }
  });

  const coreSet = new Set<string>([anchorId]);
  nodes.forEach((n) => {
    if (n.id === anchorId) return;
    if (hopDist[n.id] > 2) return;
    const inSameSystem = sameSystemSet.has(n.id);
    let linksToSameSystem = 0;
    let linksToExternal = 0;
    adj[n.id].forEach((nb) => {
      if (sameSystemSet.has(nb)) linksToSameSystem++;
      else linksToExternal++;
    });

    if (inSameSystem) {
      coreSet.add(n.id);
    } else if (linksToSameSystem >= 2 && linksToExternal === 0) {
      coreSet.add(n.id);
    }
  });

  if (coreSet.size === 1) {
    adj[anchorId].forEach((nb) => coreSet.add(nb));
  }

  const visitedNonCore = new Set<string>();
  const radicalClusters: {
    members: string[];
    bridges: string[];
    distals: string[];
    coreAttachments: string[];
  }[] = [];
  const isolatedNodes: string[] = [];

  nodes.forEach((n) => {
    if (coreSet.has(n.id) || visitedNonCore.has(n.id)) return;
    if (hopDist[n.id] === Infinity) {
      visitedNonCore.add(n.id);
      isolatedNodes.push(n.id);
      return;
    }
    const comp: string[] = [];
    const q: string[] = [n.id];
    visitedNonCore.add(n.id);
    while (q.length > 0) {
      const cur = q.shift()!;
      comp.push(cur);
      adj[cur].forEach((nb) => {
        if (!coreSet.has(nb) && !visitedNonCore.has(nb)) {
          visitedNonCore.add(nb);
          q.push(nb);
        }
      });
    }

    const bridges: string[] = [];
    const distals: string[] = [];
    const attachSet = new Set<string>();
    comp.forEach((cid) => {
      let touchesCore = false;
      adj[cid].forEach((nb) => {
        if (coreSet.has(nb)) {
          touchesCore = true;
          attachSet.add(nb);
        }
      });
      if (touchesCore) bridges.push(cid);
      else distals.push(cid);
    });

    radicalClusters.push({
      members: comp,
      bridges,
      distals,
      coreAttachments: Array.from(attachSet),
    });
  });

  const coreBridgeAttachSet = new Set<string>();
  radicalClusters.forEach((rc) => {
    rc.coreAttachments.forEach((id) => coreBridgeAttachSet.add(id));
  });

  // 1. Place Core Cluster around (cx, cy)
  posMap[anchorId] = lockedCenters?.[anchorId]
    ? { ...lockedCenters[anchorId] }
    : { x: cx, y: cy };

  const coreRing1 = nodes.filter(
    (n) => n.id !== anchorId && coreSet.has(n.id) && hopDist[n.id] === 1
  );
  const coreRing2 = nodes.filter(
    (n) => n.id !== anchorId && coreSet.has(n.id) && hopDist[n.id] > 1
  );

  const orderedRing1 = [
    ...coreRing1.filter((n) => coreBridgeAttachSet.has(n.id)),
    ...coreRing1.filter((n) => !coreBridgeAttachSet.has(n.id)),
  ];

  const r1X = 115 * scale;
  const r1Y = 102 * scale;
  orderedRing1.forEach((n, idx) => {
    if (lockedCenters?.[n.id]) {
      posMap[n.id] = { ...lockedCenters[n.id] };
      return;
    }
    const angle =
      Math.PI * 0.65 +
      (2 * Math.PI * idx) / Math.max(1, orderedRing1.length);
    posMap[n.id] = {
      x: cx + Math.cos(angle) * r1X,
      y: cy + Math.sin(angle) * r1Y,
    };
  });

  const r2X = (orderedRing1.length > 0 ? 172 : 120) * scale;
  const r2Y = (orderedRing1.length > 0 ? 148 : 105) * scale;
  coreRing2.forEach((n, idx) => {
    if (lockedCenters?.[n.id]) {
      posMap[n.id] = { ...lockedCenters[n.id] };
      return;
    }
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    adj[n.id].forEach((nb) => {
      if (posMap[nb] && nb !== anchorId) {
        sumX += posMap[nb].x - cx;
        sumY += posMap[nb].y - cy;
        count++;
      }
    });
    const baseAngle =
      count > 0
        ? Math.atan2(sumY / count, sumX / count) +
          (idx % 2 === 0 ? 1 : -1) * 0.38
        : -Math.PI / 2 + (2 * Math.PI * idx) / Math.max(1, coreRing2.length);
    posMap[n.id] = {
      x: cx + Math.cos(baseAngle) * r2X,
      y: cy + Math.sin(baseAngle) * r2Y,
    };
  });

  // 2. Place Radical Sub-clusters outward along the ray from (cx, cy) through their core attachment node
  const nodeRadicalGroup: Record<string, number> = {};
  const isDistalRadical = new Set<string>();
  const isBridgeRadical = new Set<string>();
  const radicalOutwardDir: Record<string, { ux: number; uy: number }> = {};

  radicalClusters.forEach((rc, rcIdx) => {
    let attachX = cx;
    let attachY = cy;
    if (rc.coreAttachments.length > 0) {
      attachX =
        rc.coreAttachments.reduce(
          (acc, id) => acc + (posMap[id]?.x ?? cx),
          0
        ) / rc.coreAttachments.length;
      attachY =
        rc.coreAttachments.reduce(
          (acc, id) => acc + (posMap[id]?.y ?? cy),
          0
        ) / rc.coreAttachments.length;
    }
    let dx = attachX - cx;
    let dy = attachY - cy;
    let len = Math.hypot(dx, dy);
    if (len < 1e-3) {
      const fallbackAngle = Math.PI * 0.28 + rcIdx * 1.1;
      dx = Math.cos(fallbackAngle);
      dy = Math.sin(fallbackAngle);
      len = 1;
    }
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;

    rc.members.forEach((mId) => {
      nodeRadicalGroup[mId] = rcIdx + 1;
      radicalOutwardDir[mId] = { ux, uy };
    });

    const bridgeDistFromAttach = 155 * scale;
    rc.bridges.forEach((bId, bIdx) => {
      isBridgeRadical.add(bId);
      if (lockedCenters?.[bId]) {
        posMap[bId] = { ...lockedCenters[bId] };
        return;
      }
      const lateral = (bIdx - (rc.bridges.length - 1) / 2) * 85 * scale;
      posMap[bId] = {
        x: attachX + ux * bridgeDistFromAttach + px * lateral,
        y: attachY + uy * bridgeDistFromAttach + py * lateral,
      };
    });

    const bridgeCenter =
      rc.bridges.length > 0
        ? {
            x:
              rc.bridges.reduce((a, id) => a + posMap[id].x, 0) /
              rc.bridges.length,
            y:
              rc.bridges.reduce((a, id) => a + posMap[id].y, 0) /
              rc.bridges.length,
          }
        : {
            x: attachX + ux * bridgeDistFromAttach,
            y: attachY + uy * bridgeDistFromAttach,
          };

    const distalStepOut = 135 * scale;
    const distalSpreadLat = 88 * scale;
    rc.distals.forEach((dId, dIdx) => {
      isDistalRadical.add(dId);
      if (lockedCenters?.[dId]) {
        posMap[dId] = { ...lockedCenters[dId] };
        return;
      }
      const lateralFactor =
        rc.distals.length === 1 ? 0 : dIdx - (rc.distals.length - 1) / 2;
      posMap[dId] = {
        x:
          bridgeCenter.x +
          ux * distalStepOut +
          px * lateralFactor * distalSpreadLat,
        y:
          bridgeCenter.y +
          uy * distalStepOut +
          py * lateralFactor * distalSpreadLat,
      };
    });
  });

  // 3. Place completely disconnected / isolated nodes on the outer periphery
  isolatedNodes.forEach((isoId, idx) => {
    if (lockedCenters?.[isoId]) {
      posMap[isoId] = { ...lockedCenters[isoId] };
      return;
    }
    const angle = -Math.PI * 0.78 - idx * 0.55;
    posMap[isoId] = {
      x: cx + Math.cos(angle) * 255 * scale,
      y: cy + Math.sin(angle) * 205 * scale,
    };
  });

  // 4. Force relaxation with strong inter-cluster repulsion and outward centrifugal bias for radicals
  for (let iter = 0; iter < 52; iter++) {
    const disp: Record<string, { dx: number; dy: number }> = {};
    nodes.forEach((n) => {
      disp[n.id] = { dx: 0, dy: 0 };
    });

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].id;
        const b = nodes[j].id;
        const vx = posMap[a].x - posMap[b].x;
        const vy = posMap[a].y - posMap[b].y;
        const dist = Math.max(8, Math.hypot(vx, vy));

        const aInCore = coreSet.has(a);
        const bInCore = coreSet.has(b);
        const sameRadical =
          !aInCore &&
          !bInCore &&
          nodeRadicalGroup[a] !== undefined &&
          nodeRadicalGroup[a] === nodeRadicalGroup[b];

        const minSep =
          aInCore && bInCore
            ? 122 * scale
            : sameRadical
            ? 116 * scale
            : 205 * scale;

        if (dist < minSep) {
          const strength = aInCore !== bInCore ? 0.52 : 0.42;
          const push = ((minSep - dist) / dist) * strength;
          const weightA =
            !aInCore && bInCore ? 1.55 : aInCore && !bInCore ? 0.45 : 1;
          const weightB =
            !bInCore && aInCore ? 1.55 : bInCore && !aInCore ? 0.45 : 1;
          disp[a].dx += vx * push * weightA;
          disp[a].dy += vy * push * weightA;
          disp[b].dx -= vx * push * weightB;
          disp[b].dy -= vy * push * weightB;
        }
      }
    }

    activeEdges.forEach((e) => {
      const a = e.source;
      const b = e.target;
      if (!posMap[a] || !posMap[b]) return;
      const vx = posMap[b].x - posMap[a].x;
      const vy = posMap[b].y - posMap[a].y;
      const dist = Math.max(8, Math.hypot(vx, vy));

      const aInCore = coreSet.has(a);
      const bInCore = coreSet.has(b);
      const isBridgeEdge = aInCore !== bInCore;
      const isRadicalInternal = !aInCore && !bInCore;

      const targetDist = isBridgeEdge
        ? 170 * scale
        : isRadicalInternal
        ? 118 * scale
        : a === anchorId || b === anchorId
        ? 118 * scale
        : 135 * scale;

      const pull = ((dist - targetDist) / dist) * 0.14;
      disp[a].dx += vx * pull;
      disp[a].dy += vy * pull;
      disp[b].dx -= vx * pull;
      disp[b].dy -= vy * pull;
    });

    nodes.forEach((n) => {
      const id = n.id;
      const dir = radicalOutwardDir[id];
      if (!dir) return;
      const relX = posMap[id].x - cx;
      const relY = posMap[id].y - cy;
      const proj = relX * dir.ux + relY * dir.uy;
      const minOutwardProj = isDistalRadical.has(id)
        ? 295 * scale
        : isBridgeRadical.has(id)
        ? 195 * scale
        : 0;
      if (proj < minOutwardProj) {
        const boost = (minOutwardProj - proj) * 0.22;
        disp[id].dx += dir.ux * boost;
        disp[id].dy += dir.uy * boost;
      }
    });

    nodes.forEach((n) => {
      if (lockedCenters?.[n.id]) {
        posMap[n.id].x = lockedCenters[n.id].x;
        posMap[n.id].y = lockedCenters[n.id].y;
        return;
      }
      if (n.id === anchorId) {
        posMap[n.id].x = cx;
        posMap[n.id].y = cy;
        return;
      }
      posMap[n.id].x += disp[n.id].dx;
      posMap[n.id].y += disp[n.id].dy;
    });
  }

  return posMap;
}

// Applies graph-based clustered auto-layout to Canvas elements while keeping any user-moved elements untouched
function applyCanvasAutoLayout(
  nodes: PlanElement[],
  userPositionedIds: Set<string>
): PlanElement[] {
  if (nodes.length === 0) return nodes;
  const { edges: activeEdges } = buildAndValidateGraph(nodes);

  const lockedCenters: Record<string, { x: number; y: number }> = {};
  nodes.forEach((n) => {
    if (userPositionedIds.has(n.id)) {
      lockedCenters[n.id] = {
        x: n.position.x + 85,
        y: n.position.y + 30,
      };
    }
  });

  const posMap = computeClusteredGraphPositions(
    nodes,
    activeEdges,
    1020,
    640,
    1.58,
    1.0,
    null,
    lockedCenters
  );

  // Rectangular card-collision avoidance pass so .sys-node cards (~185x75) never overlap on the Canvas
  const MIN_GAP_X = 225;
  const MIN_GAP_Y = 112;
  for (let pass = 0; pass < 28; pass++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].id;
        const b = nodes[j].id;
        const aLocked = userPositionedIds.has(a);
        const bLocked = userPositionedIds.has(b);
        if (aLocked && bLocked) continue;

        const dx = posMap[a].x - posMap[b].x;
        const dy = posMap[a].y - posMap[b].y;
        const overlapX = MIN_GAP_X - Math.abs(dx);
        const overlapY = MIN_GAP_Y - Math.abs(dy);

        if (overlapX > 0 && overlapY > 0) {
          // Push apart along the axis of smaller relative overlap
          if (overlapX / MIN_GAP_X < overlapY / MIN_GAP_Y) {
            const signX = dx >= 0 ? 1 : -1;
            const shift = overlapX * 0.55;
            if (aLocked) {
              posMap[b].x -= signX * shift * 2;
            } else if (bLocked) {
              posMap[a].x += signX * shift * 2;
            } else {
              posMap[a].x += signX * shift;
              posMap[b].x -= signX * shift;
            }
          } else {
            const signY = dy >= 0 ? 1 : -1;
            const shift = overlapY * 0.55;
            if (aLocked) {
              posMap[b].y -= signY * shift * 2;
            } else if (bLocked) {
              posMap[a].y += signY * shift * 2;
            } else {
              posMap[a].y += signY * shift;
              posMap[b].y -= signY * shift;
            }
          }
        }
      }
    }
  }

  // If no user-locked nodes exist yet, ensure the bounding box has a clean margin >= 40px from top-left
  if (userPositionedIds.size === 0) {
    let minLeft = Infinity;
    let minTop = Infinity;
    nodes.forEach((n) => {
      minLeft = Math.min(minLeft, posMap[n.id].x - 85);
      minTop = Math.min(minTop, posMap[n.id].y - 30);
    });
    const offsetX = minLeft < 40 ? 40 - minLeft : 0;
    const offsetY = minTop < 40 ? 40 - minTop : 0;
    if (offsetX > 0 || offsetY > 0) {
      nodes.forEach((n) => {
        posMap[n.id].x += offsetX;
        posMap[n.id].y += offsetY;
      });
    }
  }

  return nodes.map((n) => {
    if (userPositionedIds.has(n.id)) {
      return n;
    }
    const cx = posMap[n.id]?.x ?? n.position.x + 85;
    const cy = posMap[n.id]?.y ?? n.position.y + 30;
    return {
      ...n,
      position: {
        x: Math.max(30, Math.round((cx - 85) / 10) * 10),
        y: Math.max(30, Math.round((cy - 30) / 10) * 10),
      },
    };
  });
}

export function App() {
  const [activeTab, setActiveTab] = useState<PrimaryTab>('kb');
  const [leftPanelOpen, setLeftPanelOpen] = useState<boolean>(true);
  const [rightPanelOpen, setRightPanelOpen] = useState<boolean>(true);

  // Project files & elements (immediately initialized in graph-clustered auto-layout)
  const [files, setFiles] = useState<string[]>(INITIAL_FILES);
  const [elements, setElements] = useState<PlanElement[]>(() =>
    applyCanvasAutoLayout(INITIAL_ELEMENTS, new Set())
  );
  const [userPositionedNodeIds, setUserPositionedNodeIds] = useState<
    Set<string>
  >(() => new Set());
  const userPositionedNodeIdsRef = useRef<Set<string>>(userPositionedNodeIds);
  userPositionedNodeIdsRef.current = userPositionedNodeIds;
  const [activeFile, setActiveFile] = useState<string>('sys_inventory.pgr');
  const [selectedId, setSelectedId] = useState<string | null>('cls_item');
  const selectedIdRef = useRef<string | null>(selectedId);
  selectedIdRef.current = selectedId;

  // Knowledge Base Editor state
  const [kbEditorMode, setKbEditorMode] = useState<'structured' | 'raw_pgr'>(
    'structured'
  );
  const [cursorLine, setCursorLine] = useState<number>(13);
  const [lineRangeFilter, setLineRangeFilter] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [rangeStartInput, setRangeStartInput] = useState<string>('1');
  const [rangeEndInput, setRangeEndInput] = useState<string>('24');

  // Search & filter state
  const [kbSearch, setKbSearch] = useState<string>('');
  const [kbTypeFilter, setKbTypeFilter] = useState<ElementType | 'all'>('all');
  const [kbMvpFilter, setKbMvpFilter] = useState<'all' | 'mvp' | 'later'>('all');

  // Canvas state (with pan, wheel zoom, and non-sticking node drag)
  const [canvasZoom, setCanvasZoom] = useState<number>(100);
  const [canvasPan, setCanvasPan] = useState<{ x: number; y: number }>({
    x: 20,
    y: 20,
  });
  const [isPanningCanvas, setIsPanningCanvas] = useState<boolean>(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [expandedNodeIds, setExpandedNodeIds] = useState<
    Record<string, boolean>
  >({});
  const [visibleRelations, setVisibleRelations] = useState<
    Record<RelationType, boolean>
  >({
    contains: true,
    extends: true,
    has: true,
    instance_of: true,
    uses: true,
    notes: true,
  });
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [alignmentGuides, setAlignmentGuides] = useState<{
    verticalX: number | null;
    horizontalY: number | null;
  }>({
    verticalX: null,
    horizontalY: null,
  });
  type MoveHistoryEntry =
    | {
        kind: 'canvas_move';
        positions: Record<string, { x: number; y: number }>;
        lockedIds: string[];
        movedIds: string[];
      }
    | {
        kind: 'kb_file_move';
        fileNames: Record<string, string>;
        prevActiveFile: string;
        movedIds: string[];
      };

  const [moveHistory, setMoveHistory] = useState<MoveHistoryEntry[]>([]);
  const moveHistoryRef = useRef<MoveHistoryEntry[]>(moveHistory);
  moveHistoryRef.current = moveHistory;
  const dragStartSnapshotRef = useRef<Record<
    string,
    { x: number; y: number }
  > | null>(null);
  const draggingNodeIdRef = useRef<string | null>(null);
  const canvasMouseDownInfoRef = useRef<{
    nodeId: string;
    fileName: string;
    clientX: number;
    clientY: number;
    wasCtrl: boolean;
    wasAlreadyInMulti: boolean;
    didMove: boolean;
  } | null>(null);
  const elementsRef = useRef<PlanElement[]>(elements);
  elementsRef.current = elements;
  draggingNodeIdRef.current = draggingNodeId;

  const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
  const [mouseCanvasPos, setMouseCanvasPos] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const canvasAreaRef = useRef<HTMLDivElement>(null);

  // Mini Graph View (Obsidian-style in KB right sidebar) state
  const [miniGraphMode, setMiniGraphMode] = useState<'all' | 'local'>('all');
  const [graphSpread, setGraphSpread] = useState<number>(1.15);
  const [hoveredMiniNodeId, setHoveredMiniNodeId] = useState<string | null>(
    null
  );
  const [miniGraphView, setMiniGraphView] = useState<{
    zoom: number;
    pan: { x: number; y: number };
  }>({
    zoom: 100,
    pan: { x: 0, y: 0 },
  });
  const miniGraphZoom = miniGraphView.zoom;
  const miniGraphPan = miniGraphView.pan;
  const [miniGraphIsPanning, setMiniGraphIsPanning] = useState<boolean>(false);
  const [miniGraphPanStart, setMiniGraphPanStart] = useState<{
    x: number;
    y: number;
  }>({ x: 0, y: 0 });
  const miniGraphDownClientRef = useRef<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const miniGraphDragMovedRef = useRef<boolean>(false);
  const miniGraphRef = useRef<HTMLDivElement>(null);

  // Full Graph View inside KB main area (.editor-column) state
  const [kbMainGraphOpen, setKbMainGraphOpen] = useState<boolean>(false);
  const [mainGraphView, setMainGraphView] = useState<{
    zoom: number;
    pan: { x: number; y: number };
  }>({
    zoom: 100,
    pan: { x: 0, y: 0 },
  });
  const mainGraphZoom = mainGraphView.zoom;
  const mainGraphPan = mainGraphView.pan;
  const [mainGraphIsPanning, setMainGraphIsPanning] = useState<boolean>(false);
  const [mainGraphPanStart, setMainGraphPanStart] = useState<{
    x: number;
    y: number;
  }>({ x: 0, y: 0 });
  const mainGraphDownClientRef = useRef<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const mainGraphDragMovedRef = useRef<boolean>(false);
  const mainGraphRef = useRef<HTMLDivElement>(null);

  const commitDragSnapshotIfMoved = () => {
    const startSnap = dragStartSnapshotRef.current;
    if (startSnap) {
      const movedIds: string[] = [];
      elementsRef.current.forEach((el) => {
        const sp = startSnap[el.id];
        if (sp && (sp.x !== el.position.x || sp.y !== el.position.y)) {
          movedIds.push(el.id);
        }
      });
      if (movedIds.length > 0) {
        const prevLocked = Array.from(userPositionedNodeIdsRef.current);
        const newEntry: MoveHistoryEntry = {
          kind: 'canvas_move',
          positions: startSnap,
          lockedIds: prevLocked,
          movedIds,
        };
        const nextHistory = [...moveHistoryRef.current.slice(-49), newEntry];
        moveHistoryRef.current = nextHistory;
        setMoveHistory(nextHistory);
        // Preserve all current element positions once the user manually adjusts layout on the Canvas
        const nextLocked = new Set<string>(
          elementsRef.current.map((el) => el.id)
        );
        userPositionedNodeIdsRef.current = nextLocked;
        setUserPositionedNodeIds(nextLocked);
      }
    }
    dragStartSnapshotRef.current = null;
    draggingNodeIdRef.current = null;
  };

  // Global mouseup/blur safety so dragged nodes on Canvas never stick to cursor
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (radialMenuRef.current) {
        const chosen = radialMenuRef.current.hoveredId;
        const targetId = radialMenuRef.current.targetElementId;
        setRadialMenu(null);
        if (chosen) {
          executeRadialAiActionRef.current(chosen, targetId);
        }
      }
      commitDragSnapshotIfMoved();
      setDraggingNodeId(null);
      setConnectingFromId(null);
      setIsPanningCanvas(false);
      setAlignmentGuides({ verticalX: null, horizontalY: null });
      setMiniGraphIsPanning(false);
      setMainGraphIsPanning(false);
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('blur', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('blur', handleGlobalMouseUp);
    };
  }, []);

  // Non-passive wheel listener on Mini Graph so sidebar vertical scroll never triggers while cursor is over the graph
  useEffect(() => {
    const el = miniGraphRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const delta = e.deltaY < 0 ? 10 : -10;
      const cursorX = e.clientX - rect.left - el.clientLeft;
      const cursorY = e.clientY - rect.top - el.clientTop;
      setMiniGraphView((prev) => {
        const nextZoom = Math.min(180, Math.max(60, prev.zoom + delta));
        if (nextZoom === prev.zoom) return prev;
        const oldScale = prev.zoom / 100;
        const newScale = nextZoom / 100;
        const worldX = (cursorX - prev.pan.x) / oldScale;
        const worldY = (cursorY - prev.pan.y) / oldScale;
        return {
          zoom: nextZoom,
          pan: {
            x: cursorX - worldX * newScale,
            y: cursorY - worldY * newScale,
          },
        };
      });
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [activeTab]);

  // Non-passive wheel listener on Main Area Graph View
  useEffect(() => {
    const el = mainGraphRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const delta = e.deltaY < 0 ? 10 : -10;
      const cursorX = e.clientX - rect.left - el.clientLeft;
      const cursorY = e.clientY - rect.top - el.clientTop;
      setMainGraphView((prev) => {
        const nextZoom = Math.min(200, Math.max(50, prev.zoom + delta));
        if (nextZoom === prev.zoom) return prev;
        const oldScale = prev.zoom / 100;
        const newScale = nextZoom / 100;
        const worldX = (cursorX - prev.pan.x) / oldScale;
        const worldY = (cursorY - prev.pan.y) / oldScale;
        return {
          zoom: nextZoom,
          pan: {
            x: cursorX - worldX * newScale,
            y: cursorY - worldY * newScale,
          },
        };
      });
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [activeTab, kbMainGraphOpen]);

  // Ctrl + Z undo for single & multi-element movements on Canvas and between .pgr files in Knowledge Base
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      const isZ =
        e.code === 'KeyZ' ||
        e.key.toLowerCase() === 'z' ||
        e.key.toLowerCase() === 'я';
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && isZ) {
        const history = moveHistoryRef.current;
        if (history.length === 0) return;
        e.preventDefault();
        const lastEntry = history[history.length - 1];
        const nextHistory = history.slice(0, -1);
        moveHistoryRef.current = nextHistory;
        setMoveHistory(nextHistory);

        if (lastEntry.kind === 'canvas_move') {
          const restoredLocked = new Set<string>(lastEntry.lockedIds);
          userPositionedNodeIdsRef.current = restoredLocked;
          setUserPositionedNodeIds(restoredLocked);
          const nextElements = elementsRef.current.map((el) =>
            lastEntry.positions[el.id]
              ? { ...el, position: { ...lastEntry.positions[el.id] } }
              : el
          );
          elementsRef.current = nextElements;
          setElements(nextElements);
          const count = lastEntry.movedIds.length;
          showNotice(
            count > 1
              ? `Отменено перемещение (${count} элем.) (Ctrl+Z)`
              : 'Отменено перемещение (Ctrl+Z)'
          );
        } else if (lastEntry.kind === 'kb_file_move') {
          const nextElements = elementsRef.current.map((el) =>
            lastEntry.fileNames[el.id]
              ? { ...el, fileName: lastEntry.fileNames[el.id] }
              : el
          );
          elementsRef.current = nextElements;
          setElements(nextElements);
          if (lastEntry.prevActiveFile) {
            setActiveFile(lastEntry.prevActiveFile);
          }
          setUncommittedChanges((c) => Math.max(0, c - 1));
          const count = lastEntry.movedIds.length;
          showNotice(
            count > 1
              ? `Отменено перемещение между файлами (${count} элем.) (Ctrl+Z)`
              : 'Отменено перемещение элемента в файл (Ctrl+Z)'
          );
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Unit Library state
  const [unitLibrary, setUnitLibrary] =
    useState<UnitLibraryItem[]>(INITIAL_UNIT_LIBRARY);
  const [libCategoryFilter, setLibCategoryFilter] = useState<
    'all' | ElementType
  >('all');
  const [libSearch, setLibSearch] = useState<string>('');

  // Settings state (Default 'dark' for Variation 5 System Dark)
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [posPalette, setPosPalette] = useState<PositivePaletteKey>('emerald');
  const [negPalette, setNegPalette] = useState<NegativePaletteKey>('crimson');
  const [aiEndpoint, setAiEndpoint] = useState<string>(
    'https://api.openai.com/v1'
  );
  const [aiEnabled, setAiEnabled] = useState<boolean>(true);
  const [gitEnabled, setGitEnabled] = useState<boolean>(true);
  const [gitHistoryOpen, setGitHistoryOpen] = useState<boolean>(false);
  const [locale, setLocale] = useState<LocaleKey>('ru');
  const [activeSettingsSection, setActiveSettingsSection] =
    useState<string>('theme');

  // Git commits & uncommitted count
  const [uncommittedChanges, setUncommittedChanges] = useState<number>(3);
  const [commits, setCommits] = useState<GitCommit[]>(() => [
    {
      id: 'commit_1',
      hash: 'a4f920c',
      message: 'Базовая структура sys_inventory.pgr и sys_factions.pgr',
      timestamp: '2026-09-26 10:15',
      author: 'main',
      filesSnapshot: createSnapshotMap(INITIAL_ELEMENTS, INITIAL_FILES),
      elementsSnapshot: JSON.parse(JSON.stringify(INITIAL_ELEMENTS)),
    },
  ]);
  const [commitMsgInput, setCommitMsgInput] = useState<string>('');
  const [diffFileSelect, setDiffFileSelect] =
    useState<string>('sys_inventory.pgr');

  // AI Assistant state & modal
  const [aiModalOpen, setAiModalOpen] = useState<boolean>(false);
  const [aiModalSection, setAiModalSection] = useState<
    'all' | 'contradictions' | 'proposals' | 'interview' | 'transform'
  >('all');
  const [transformSourceId, setTransformSourceId] =
    useState<string>('idea_backlog');
  const [transformPattern, setTransformPattern] = useState<
    'system_pack' | 'class_hierarchy' | 'process_chain'
  >('system_pack');
  const [transformSummary, setTransformSummary] = useState<string | null>(null);
  type RadialOptionId =
    | 'conflicts'
    | 'proposals'
    | 'interview'
    | 'rescan'
    | 'node_transform'
    | 'node_open_kb'
    | 'node_save_lib'
    | 'node_delete';

  const [radialMenu, setRadialMenu] = useState<{
    mode: 'canvas' | 'node';
    targetElementId?: string;
    centerX: number;
    centerY: number;
    cursorX: number;
    cursorY: number;
    hoveredId: RadialOptionId | null;
  } | null>(null);
  const radialMenuRef = useRef<typeof radialMenu>(null);
  radialMenuRef.current = radialMenu;
  const [aiContextIds, setAiContextIds] = useState<string[]>(['cls_item']);
  const aiContextIdsRef = useRef<string[]>(aiContextIds);
  aiContextIdsRef.current = aiContextIds;
  const [kbDraggedIds, setKbDraggedIds] = useState<string[]>([]);
  const kbDraggedIdsRef = useRef<string[]>([]);
  const [dragOverFileName, setDragOverFileName] = useState<string | null>(null);

  // Unified selection helper: normal LMB selects single element, Ctrl/Cmd + LMB toggles multi-selection (which serves as AI context)
  const handleSelectWithModifiers = (
    id: string,
    isMultiToggle: boolean,
    fileName?: string
  ) => {
    if (
      document.activeElement instanceof HTMLElement &&
      (document.activeElement.tagName === 'INPUT' ||
        document.activeElement.tagName === 'TEXTAREA' ||
        document.activeElement.tagName === 'SELECT')
    ) {
      document.activeElement.blur();
    }
    if (isMultiToggle) {
      const base =
        aiContextIdsRef.current.length > 0
          ? aiContextIdsRef.current
          : selectedIdRef.current
          ? [selectedIdRef.current]
          : [];
      const exists = base.includes(id);
      const next = exists ? base.filter((x) => x !== id) : [...base, id];
      aiContextIdsRef.current = next;
      setAiContextIds(next);
      if (exists) {
        if (selectedIdRef.current === id) {
          const nextSel = next[next.length - 1] || null;
          selectedIdRef.current = nextSel;
          setSelectedId(nextSel);
        }
      } else {
        selectedIdRef.current = id;
        setSelectedId(id);
        if (fileName) setActiveFile(fileName);
      }
    } else {
      selectedIdRef.current = id;
      setSelectedId(id);
      aiContextIdsRef.current = [id];
      setAiContextIds([id]);
      if (fileName) setActiveFile(fileName);
    }
  };
  const [proposals, setProposals] = useState<AiProposalCard[]>([]);
  const [contradictions, setContradictions] = useState<AiContradiction[]>([]);
  const [ignoredContradictionIds, setIgnoredContradictionIds] = useState<
    string[]
  >([]);
  const [rejectedContradictionIds, setRejectedContradictionIds] = useState<
    string[]
  >([]);
  const [showCanvasConflictOverlay, setShowCanvasConflictOverlay] =
    useState<boolean>(true);
  const [canvasConflictFilter, setCanvasConflictFilter] =
    useState<string>('all');
  const [activeConflictPopup, setActiveConflictPopup] = useState<{
    contradictions: AiContradiction[];
    activeIndex: number;
    triggerElementId?: string;
  } | null>(null);
  const [conflictFormTitle, setConflictFormTitle] = useState<string>('');
  const [conflictFormDesc, setConflictFormDesc] = useState<string>('');
  const [conflictFormFix, setConflictFormFix] = useState<string>('');
  const [conflictFormFixLabel, setConflictFormFixLabel] = useState<string>('');
  const [conflictFormComment, setConflictFormComment] = useState<string>('');
  const canvasNodeDownClientRef = useRef<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [interviewQuestions, setInterviewQuestions] = useState<
    AiInterviewQuestion[]
  >([]);
  const [rejectProposalModal, setRejectProposalModal] =
    useState<AiProposalCard | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState<string>('');

  // Creation / deletion modals
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [newElementModalOpen, setNewElementModalOpen] = useState<boolean>(false);
  const [newElType, setNewElType] = useState<ElementType>('class');
  const [newElTitle, setNewElTitle] = useState<string>('');
  const [newElSlug, setNewElSlug] = useState<string>('');
  const [newElFile, setNewElFile] = useState<string>('sys_inventory.pgr');
  const [newElParent, setNewElParent] = useState<string>('sys_inventory');
  const [newElMvp, setNewElMvp] = useState<boolean>(true);

  // Inline field/method/step inputs
  const [inlineFieldName, setInlineFieldName] = useState<string>('');
  const [inlineFieldType, setInlineFieldType] = useState<string>('string');
  const [inlineFieldDesc, setInlineFieldDesc] = useState<string>('');
  const [inlineMethodVis, setInlineMethodVis] = useState<'+' | '-'>('+');
  const [inlineMethodSig, setInlineMethodSig] = useState<string>('');
  const [inlineMethodDesc, setInlineMethodDesc] = useState<string>('');
  const [inlineStepText, setInlineStepText] = useState<string>('');
  const [inlineInterfaceText, setInlineInterfaceText] = useState<string>('');
  const [inlineLogicText, setInlineLogicText] = useState<string>('');

  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const t = I18N_DICTIONARY[locale];

  const showNotice = (msg: string) => {
    setStatusNotice(msg);
    setTimeout(() => {
      setStatusNotice((prev) => (prev === msg ? null : prev));
    }, 3000);
  };

  // Sync theme and contextual color pairs to CSS variables
  useEffect(() => {
    const root = document.documentElement;
    const prefersDark = window.matchMedia(
      '(prefers-color-scheme: dark)'
    ).matches;
    const isDark =
      themeMode === 'dark' || (themeMode === 'system' && prefersDark);
    const isClassic = themeMode === 'classic';

    if (isDark) {
      root.classList.add('dark');
      root.classList.remove('theme-classic');
      root.style.colorScheme = 'dark';
    } else if (isClassic) {
      root.classList.remove('dark');
      root.classList.add('theme-classic');
      root.style.colorScheme = 'light';
    } else {
      root.classList.remove('dark');
      root.classList.remove('theme-classic');
      root.style.colorScheme = 'light';
    }

    const pos = POSITIVE_PALETTES[posPalette];
    const neg = NEGATIVE_PALETTES[negPalette];
    const posText = isDark ? pos.textDark : pos.text;
    const negText = isDark ? neg.textDark : neg.text;

    root.style.setProperty('--ctx-pos', pos.main);
    root.style.setProperty('--ctx-pos-hover', pos.hover);
    root.style.setProperty('--ctx-pos-soft', pos.soft);
    root.style.setProperty('--ctx-pos-border', pos.border);
    root.style.setProperty('--ctx-pos-text', posText);

    root.style.setProperty('--ctx-neg', neg.main);
    root.style.setProperty('--ctx-neg-hover', neg.hover);
    root.style.setProperty('--ctx-neg-soft', neg.soft);
    root.style.setProperty('--ctx-neg-border', neg.border);
    root.style.setProperty('--ctx-neg-text', negText);

    root.style.setProperty('--accent', isClassic ? '#000000' : posText);
  }, [themeMode, posPalette, negPalette]);

  // Run analysis when elements or selected context change
  useEffect(() => {
    const local = generateLocalAnalysis(elements, aiContextIds, files);
    setProposals(local.proposals);
    setContradictions(
      local.contradictions.filter(
        (c) =>
          !ignoredContradictionIds.includes(c.id) &&
          !rejectedContradictionIds.includes(c.id)
      )
    );
    setInterviewQuestions(
      generateLocalInterviewQuestions(elements, aiContextIds)
    );
  }, [
    elements,
    aiContextIds,
    files,
    ignoredContradictionIds,
    rejectedContradictionIds,
  ]);

  const openConflictPopupFor = (
    matchedContradictions: AiContradiction[],
    triggerElementId?: string
  ) => {
    if (matchedContradictions.length === 0) return;
    const first = matchedContradictions[0];
    setActiveConflictPopup({
      contradictions: matchedContradictions,
      activeIndex: 0,
      triggerElementId,
    });
    setConflictFormTitle(first.title);
    setConflictFormDesc(first.description);
    setConflictFormFix(first.resolutionHint);
    setConflictFormFixLabel(
      first.suggestedFix?.fixLabel || 'Применить исправление в план'
    );
    setConflictFormComment('');
  };

  const selectConflictPopupIndex = (idx: number) => {
    if (!activeConflictPopup) return;
    const item = activeConflictPopup.contradictions[idx];
    if (!item) return;
    setActiveConflictPopup({
      ...activeConflictPopup,
      activeIndex: idx,
    });
    setConflictFormTitle(item.title);
    setConflictFormDesc(item.description);
    setConflictFormFix(item.resolutionHint);
    setConflictFormFixLabel(
      item.suggestedFix?.fixLabel || 'Применить исправление в план'
    );
    setConflictFormComment('');
  };

  const handleAcceptConflictFix = () => {
    if (!activeConflictPopup) return;
    const current =
      activeConflictPopup.contradictions[activeConflictPopup.activeIndex];
    if (!current) return;

    const targetId =
      current.suggestedFix?.targetElementId || current.elementIds[0];
    setElements((prev) =>
      prev.map((el) => {
        if (el.id !== targetId) return el;
        const patched: PlanElement = {
          ...el,
          ...(current.suggestedFix?.patch || {}),
        };
        if (
          conflictFormFix.trim() &&
          conflictFormFix.trim() !== current.resolutionHint.trim()
        ) {
          patched.description = `${patched.description} [Исправление: ${conflictFormFix.trim()}]`;
        }
        return patched;
      })
    );
    setContradictions((prev) => prev.filter((c) => c.id !== current.id));
    setUncommittedChanges((c) => c + 1);
    setActiveConflictPopup(null);
    showNotice(
      `Конфликт исправлен: ${conflictFormFixLabel || current.title}`
    );
  };

  const handleRejectConflict = () => {
    if (!activeConflictPopup) return;
    const current =
      activeConflictPopup.contradictions[activeConflictPopup.activeIndex];
    if (!current) return;

    if (conflictFormComment.trim()) {
      const ideaFile = files.includes('idea_backlog.pgr')
        ? 'idea_backlog.pgr'
        : files[0] || 'idea_backlog.pgr';
      const rejIdea: PlanElement = {
        id: `idea_conflict_rej_${Date.now().toString().slice(-3)}`,
        type: 'idea',
        title: `Отклонён конфликт: ${conflictFormTitle || current.title}`,
        fileName: ideaFile,
        parent: '-',
        description: conflictFormDesc || current.description,
        status: 'черновик',
        mvp: false,
        position: { x: 40, y: 460 },
        notes: current.elementIds,
        altTo:
          current.suggestedFix?.targetElementId ||
          current.elementIds[0] ||
          '-',
        altReason: conflictFormComment.trim(),
      };
      setElements((prev) => [...prev, rejIdea]);
      setUncommittedChanges((c) => c + 1);
    }

    setRejectedContradictionIds((prev) =>
      Array.from(new Set([...prev, current.id]))
    );
    setContradictions((prev) => prev.filter((c) => c.id !== current.id));
    setActiveConflictPopup(null);
    showNotice(`Конфликт отклонён: ${conflictFormTitle || current.title}`);
  };

  const handleIgnoreConflict = () => {
    if (!activeConflictPopup) return;
    const current =
      activeConflictPopup.contradictions[activeConflictPopup.activeIndex];
    if (!current) return;

    setIgnoredContradictionIds((prev) =>
      Array.from(new Set([...prev, current.id]))
    );
    setContradictions((prev) => prev.filter((c) => c.id !== current.id));
    setActiveConflictPopup(null);
    showNotice(
      `Конфликт скрыт (игнорируется): ${conflictFormTitle || current.title}`
    );
  };

  const canvasVisibleContradictions = useMemo(() => {
    if (!aiEnabled || !showCanvasConflictOverlay) return [];
    if (canvasConflictFilter === 'all') return contradictions;
    return contradictions.filter((c) => c.id === canvasConflictFilter);
  }, [aiEnabled, showCanvasConflictOverlay, canvasConflictFilter, contradictions]);

  const getRadialOptions = (
    mode: 'canvas' | 'node',
    targetElementId?: string
  ): {
    id: RadialOptionId;
    label: string;
    sublabel: string;
    startDeg: number;
    endDeg: number;
    angleDeg: number;
    isNegative?: boolean;
  }[] => {
    if (mode === 'node' && targetElementId) {
      const targetEl = elements.find((e) => e.id === targetElementId);
      return [
        {
          id: 'node_transform',
          label: 'Преобразовать',
          sublabel: 'В систему',
          startDeg: -90,
          endDeg: 0,
          angleDeg: -45,
        },
        {
          id: 'node_open_kb',
          label: 'Открыть в БЗ',
          sublabel: targetEl?.fileName || '.pgr',
          startDeg: 0,
          endDeg: 90,
          angleDeg: 45,
        },
        {
          id: 'node_save_lib',
          label: 'В библиотеку',
          sublabel: 'Сохранить',
          startDeg: 90,
          endDeg: 180,
          angleDeg: 135,
        },
        {
          id: 'node_delete',
          label: 'Удалить',
          sublabel: 'Из проекта',
          startDeg: -180,
          endDeg: -90,
          angleDeg: -135,
          isNegative: true,
        },
      ];
    }

    return [
      {
        id: 'conflicts',
        label: 'Конфликты',
        sublabel: `${contradictions.length} активн.`,
        startDeg: -90,
        endDeg: 0,
        angleDeg: -45,
        isNegative: true,
      },
      {
        id: 'proposals',
        label: 'Предложения',
        sublabel: `${proposals.length} карточ.`,
        startDeg: 0,
        endDeg: 90,
        angleDeg: 45,
      },
      {
        id: 'interview',
        label: 'Интервью',
        sublabel: `${interviewQuestions.length} вопр.`,
        startDeg: 90,
        endDeg: 180,
        angleDeg: 135,
      },
      {
        id: 'rescan',
        label: 'Обновить ИИ',
        sublabel: 'Скан плана',
        startDeg: -180,
        endDeg: -90,
        angleDeg: -135,
      },
    ];
  };

  const executeRadialAiAction = (
    optionId: RadialOptionId,
    targetElementId?: string
  ) => {
    if (optionId.startsWith('node_') && targetElementId) {
      const targetEl = elements.find((e) => e.id === targetElementId);
      if (!targetEl) return;

      if (optionId === 'node_transform') {
        if (!aiEnabled) setAiEnabled(true);
        setSelectedId(targetEl.id);
        if (!aiContextIds.includes(targetEl.id)) {
          setAiContextIds([targetEl.id]);
        }
        setTransformSourceId(targetEl.id);
        setTransformSummary(null);
        setAiModalSection('transform');
        setAiModalOpen(true);
        showNotice(`Преобразование элемента: ${targetEl.id}`);
      } else if (optionId === 'node_open_kb') {
        setSelectedId(targetEl.id);
        setActiveFile(targetEl.fileName);
        setActiveTab('kb');
        showNotice(`Открыт элемент ${targetEl.id} в Базе знаний`);
      } else if (optionId === 'node_save_lib') {
        handleSaveCurrentToLibrary(targetEl);
      } else if (optionId === 'node_delete') {
        setElements((prev) =>
          prev
            .filter((e) => e.id !== targetEl.id)
            .map((e) => ({
              ...e,
              parent: e.parent === targetEl.id ? '-' : e.parent,
              extendsId: e.extendsId === targetEl.id ? '-' : e.extendsId,
              instanceOf: e.instanceOf === targetEl.id ? '-' : e.instanceOf,
              uses: e.uses?.filter((u) => u !== targetEl.id),
              components: e.components?.filter((c) => c !== targetEl.id),
              notes: e.notes?.filter((n) => n !== targetEl.id),
            }))
        );
        if (selectedId === targetEl.id) {
          setSelectedId(null);
        }
        setUncommittedChanges((c) => c + 1);
        showNotice(`Элемент ${targetEl.id} удалён с Холста`);
      }
      return;
    }

    if (!aiEnabled) {
      setAiEnabled(true);
    }
    if (optionId === 'conflicts') {
      setShowCanvasConflictOverlay(true);
      setCanvasConflictFilter('all');
      if (contradictions.length > 0) {
        openConflictPopupFor(contradictions, contradictions[0].elementIds[0]);
      } else {
        setAiModalSection('contradictions');
        setAiModalOpen(true);
        showNotice('Активных конфликтов на холсте не обнаружено');
      }
    } else if (optionId === 'proposals') {
      setAiModalSection('proposals');
      setAiModalOpen(true);
      showNotice('Открыты карточки-предложения ИИ');
    } else if (optionId === 'interview') {
      setAiModalSection('interview');
      setAiModalOpen(true);
      showNotice('Открыто проблемное архитектурное интервью');
    } else if (optionId === 'rescan') {
      setIgnoredContradictionIds([]);
      setRejectedContradictionIds([]);
      setShowCanvasConflictOverlay(true);
      setCanvasConflictFilter('all');
      const local = generateLocalAnalysis(elements, aiContextIds, files);
      setProposals(local.proposals);
      setContradictions(local.contradictions);
      setInterviewQuestions(
        generateLocalInterviewQuestions(elements, aiContextIds)
      );
      showNotice(
        `Анализ обновлён: конфликтов ${local.contradictions.length}, предложений ${local.proposals.length}`
      );
    }
  };
  const executeRadialAiActionRef = useRef(executeRadialAiAction);
  executeRadialAiActionRef.current = executeRadialAiAction;

  // Filtered elements
  const filteredElements = useMemo(() => {
    return elements.filter((el) => {
      if (kbTypeFilter !== 'all' && el.type !== kbTypeFilter) return false;
      if (kbMvpFilter === 'mvp' && !el.mvp) return false;
      if (kbMvpFilter === 'later' && el.mvp) return false;
      if (kbSearch.trim()) {
        const q = kbSearch.toLowerCase();
        return (
          el.id.toLowerCase().includes(q) ||
          el.title.toLowerCase().includes(q) ||
          el.description.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [elements, kbTypeFilter, kbMvpFilter, kbSearch]);

  const { edges } = useMemo(
    () => buildAndValidateGraph(filteredElements),
    [filteredElements]
  );

  // Automatically apply graph-clustered layout on Canvas when graph topology (nodes or edges) changes,
  // preserving any positions already modified by the user untouched.
  const topologySignature = useMemo(() => {
    const { edges: allEdges } = buildAndValidateGraph(elements);
    const nodePart = elements
      .map((e) => `${e.id}:${e.type}:${e.parent || '-'}`)
      .sort()
      .join(',');
    const edgePart = allEdges
      .map((e) => `${e.source}->${e.target}:${e.relation}`)
      .sort()
      .join(';');
    return `${nodePart}||${edgePart}`;
  }, [elements]);

  const prevTopologySignatureRef = useRef<string>(topologySignature);
  useEffect(() => {
    if (prevTopologySignatureRef.current !== topologySignature) {
      prevTopologySignatureRef.current = topologySignature;
      setElements((prev) =>
        applyCanvasAutoLayout(prev, userPositionedNodeIdsRef.current)
      );
    }
  }, [topologySignature]);

  // Shared topology-aware layout generator that keeps tightly coupled nodes in the core
  // and pushes peripheral radicals / secondary sub-clusters (like join_faction -> factions + reputation_bound) outward
  const buildClusteredLayout = (
    nodes: PlanElement[],
    activeEdges: ReturnType<typeof buildAndValidateGraph>['edges'],
    W: number,
    H: number,
    baseScale: number,
    spread: number
  ) =>
    computeClusteredGraphPositions(
      nodes,
      activeEdges,
      W,
      H,
      baseScale,
      spread,
      selectedId
    );

  // Obsidian-like force/radial layout for the right sidebar Graph View
  const miniGraphLayout = useMemo(() => {
    const W = 292;
    const H = 216;

    let nodes = filteredElements;
    if (miniGraphMode === 'local' && selectedId) {
      const neighborSet = new Set<string>([selectedId]);
      edges.forEach((e) => {
        if (e.source === selectedId) neighborSet.add(e.target);
        if (e.target === selectedId) neighborSet.add(e.source);
      });
      // Include 2-hop neighbors if direct neighborhood is very small
      if (neighborSet.size <= 3) {
        const snapshot = Array.from(neighborSet);
        edges.forEach((e) => {
          if (snapshot.includes(e.source)) neighborSet.add(e.target);
          if (snapshot.includes(e.target)) neighborSet.add(e.source);
        });
      }
      nodes = filteredElements.filter((el) => neighborSet.has(el.id));
    }

    const nodeIds = new Set(nodes.map((n) => n.id));
    const activeEdges = edges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
    );

    const posMap = buildClusteredLayout(
      nodes,
      activeEdges,
      W,
      H,
      0.42,
      graphSpread
    );

    return { nodes, activeEdges, posMap };
  }, [filteredElements, edges, miniGraphMode, selectedId, graphSpread]);

  // Automatic radial/force layout for the full-size Graph View in the KB main editor column
  const mainGraphLayout = useMemo(() => {
    const W = 820;
    const H = 540;
    const { nodes, activeEdges } = miniGraphLayout;

    const posMap = buildClusteredLayout(
      nodes,
      activeEdges,
      W,
      H,
      1.0,
      graphSpread
    );

    return { nodes, activeEdges, posMap, width: W, height: H };
  }, [miniGraphLayout, selectedId, graphSpread]);

  const selectedElement = useMemo(
    () =>
      selectedId ? elements.find((e) => e.id === selectedId) || null : null,
    [elements, selectedId]
  );

  const activeFileData = useMemo(() => {
    const targetFile = selectedElement?.fileName || activeFile || files[0] || '';
    return serializeFileWithRanges(elements, targetFile);
  }, [elements, selectedElement, activeFile, files]);

  const selectedElementRange = useMemo(() => {
    if (!selectedElement) return { startLine: 1, endLine: 24 };
    const found = activeFileData.ranges.find(
      (r) => r.elementId === selectedElement.id
    );
    return found || { startLine: 1, endLine: 24 };
  }, [selectedElement, activeFileData]);

  const [rawPgrDraft, setRawPgrDraft] = useState<string>('');
  useEffect(() => {
    setRawPgrDraft(activeFileData.content);
  }, [activeFileData.content]);

  const updateElement = (updated: PlanElement) => {
    setElements((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    setUncommittedChanges((c) => c + 1);
  };

  const usedByIds = useMemo(() => {
    if (!selectedElement) return [];
    const id = selectedElement.id;
    return elements
      .filter(
        (e) =>
          e.id !== id &&
          (e.instanceOf === id ||
            e.extendsId === id ||
            (e.uses || []).includes(id) ||
            (e.components || []).includes(id) ||
            (e.notes || []).includes(id))
      )
      .map((e) => e.id);
  }, [elements, selectedElement]);

  const inheritedObjectFields = useMemo(() => {
    if (!selectedElement || selectedElement.type !== 'object') return [];
    return resolveInheritedFieldsForObject(selectedElement, elements);
  }, [selectedElement, elements]);

  const handleConnectOnCanvas = (sourceId: string, targetId: string) => {
    const src = elements.find((e) => e.id === sourceId);
    const tgt = elements.find((e) => e.id === targetId);
    if (!src || !tgt || sourceId === targetId) return;

    if (src.type === 'system' && tgt.type !== 'system') {
      updateElement({ ...tgt, parent: src.id });
      showNotice(`contains: ${tgt.id} → parent: ${src.id}`);
    } else if (src.type === 'class' && tgt.type === 'class') {
      updateElement({ ...src, extendsId: tgt.id });
      showNotice(`extends: ${src.id} → ${tgt.id}`);
    } else if (src.type === 'object' && tgt.type === 'class') {
      updateElement({ ...src, instanceOf: tgt.id });
      showNotice(`instance_of: ${src.id} → ${tgt.id}`);
    } else if (
      ['class', 'process', 'component', 'object'].includes(src.type) &&
      tgt.type === 'component'
    ) {
      const next = Array.from(new Set([...(src.components || []), tgt.id]));
      updateElement({ ...src, components: next });
      showNotice(`has: ${src.id} → ${tgt.id}`);
    } else if (src.type === 'idea') {
      const next = Array.from(new Set([...(src.notes || []), tgt.id]));
      updateElement({ ...src, notes: next });
      showNotice(`notes: ${src.id} → ${tgt.id}`);
    } else if (src.type === 'process' || src.type === 'class') {
      const next = Array.from(new Set([...(src.uses || []), tgt.id]));
      updateElement({ ...src, uses: next });
      showNotice(`uses: ${src.id} → ${tgt.id}`);
    } else {
      showNotice('Для выбранной пары типов связь не предусмотрена');
    }
  };

  const handleApplyProposal = (prop: AiProposalCard) => {
    if (prop.suggestedElement) {
      const se = prop.suggestedElement;
      const targetFile = se.fileName || activeFile || 'sys_inventory.pgr';
      if (!files.includes(targetFile)) {
        setFiles((prev) => [...prev, targetFile]);
      }
      const created: PlanElement = {
        id: se.id,
        type: se.type,
        title: se.title,
        fileName: targetFile,
        parent: se.parent || '-',
        description: se.description,
        status: 'черновик',
        mvp: se.mvp ?? true,
        position: { x: 540, y: 180 + (elements.length % 3) * 140 },
        steps: se.steps,
        components: se.components,
        uses: se.uses,
        interfaceItems: se.interfaceItems,
        internalLogic: se.internalLogic,
        instanceOf: se.instanceOf,
        values: se.values,
      };
      setElements((prev) => {
        const next = [...prev.filter((x) => x.id !== created.id), created];
        if (created.type === 'component' && prop.targetElementId) {
          return next.map((el) =>
            el.id === prop.targetElementId
              ? {
                  ...el,
                  components: Array.from(
                    new Set([...(el.components || []), created.id])
                  ),
                }
              : el
          );
        }
        return next;
      });
      setSelectedId(created.id);
      setUncommittedChanges((c) => c + 1);
      showNotice(`Применено предложение: добавлен ${created.id}`);
    }
    setProposals((prev) => prev.filter((p) => p.id !== prop.id));
  };

  const handleConfirmRejectProposal = () => {
    if (!rejectProposalModal) return;
    const prop = rejectProposalModal;
    const ideaFile = files.includes('idea_backlog.pgr')
      ? 'idea_backlog.pgr'
      : files[0] || 'idea_backlog.pgr';
    if (!files.includes(ideaFile)) {
      setFiles((prev) => [...prev, ideaFile]);
    }
    const rejIdea: PlanElement = {
      id: `idea_alt_${Date.now().toString().slice(-3)}`,
      type: 'idea',
      title: `Отклонено: ${prop.title}`,
      fileName: ideaFile,
      parent: '-',
      description: prop.rationale,
      status: 'черновик',
      mvp: false,
      position: { x: 40, y: 460 },
      notes: prop.targetElementId ? [prop.targetElementId] : [],
      altTo: prop.targetElementId || '-',
      altReason:
        rejectReasonInput.trim() || 'Отклонено пользователем при ревью плана',
    };
    setElements((prev) => [...prev, rejIdea]);
    setProposals((prev) => prev.filter((p) => p.id !== prop.id));
    setRejectProposalModal(null);
    setRejectReasonInput('');
    setUncommittedChanges((c) => c + 1);
    showNotice(`Отклонённый вариант сохранён как Идея-образ (${rejIdea.id})`);
  };

  const handleSaveCurrentToLibrary = (elToSave?: PlanElement | null) => {
    const target = elToSave || selectedElement;
    if (!target) return;
    const { fileName: _f, position: _p, ...rest } = target;
    const newUnit: UnitLibraryItem = {
      unitId: `unit_${target.id}_${Date.now()}`,
      category: `${TYPE_HEADERS_RU[target.type]} · из текущего проекта`,
      savedAt: 'Сохранено только что',
      element: rest,
    };
    setUnitLibrary((prev) => [newUnit, ...prev]);
    showNotice(`Элемент ${target.id} сохранён в Библиотеку юнитов`);
  };

  const handleAddUnitToProject = (unit: UnitLibraryItem) => {
    const targetFile = activeFile || files[0] || 'sys_inventory.pgr';
    if (!files.includes(targetFile)) {
      setFiles([targetFile]);
      setActiveFile(targetFile);
    }
    const exists = elements.some((e) => e.id === unit.element.id);
    const finalId = exists
      ? `${unit.element.id}_${elements.length + 1}`
      : unit.element.id;

    const newEl: PlanElement = {
      ...unit.element,
      id: finalId,
      fileName: targetFile,
      position: {
        x: 280 + (elements.length % 3) * 220,
        y: 40 + Math.floor(elements.length / 3) * 140,
      },
    };
    setElements((prev) => [...prev, newEl]);
    setSelectedId(newEl.id);
    setUncommittedChanges((c) => c + 1);
    showNotice(`Юнит ${newEl.id} добавлен в проект (${targetFile})`);
  };

  const handleCreateElement = () => {
    const prefix = TYPE_PREFIXES[newElType];
    const cleanSlug =
      newElSlug
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/^(sys_|cls_|proc_|cmp_|obj_|idea_)/, '') ||
      `elem_${elements.length + 1}`;
    const finalId = `${prefix}${cleanSlug}`;
    const targetFile = newElFile || activeFile || 'sys_inventory.pgr';

    if (!files.includes(targetFile)) {
      setFiles((prev) => [...prev, targetFile]);
    }

    const created: PlanElement = {
      id: finalId,
      type: newElType,
      title: newElTitle.trim() || `${TYPE_HEADERS_RU[newElType]} ${finalId}`,
      fileName: targetFile,
      parent: newElType === 'system' ? '-' : newElParent || '-',
      description: 'Описание элемента плана.',
      status: 'черновик',
      mvp: newElMvp,
      position: { x: 280, y: 180 },
      extendsId: newElType === 'class' ? '-' : undefined,
      fields:
        newElType === 'class'
          ? [{ name: 'name', dataType: 'string', description: 'имя' }]
          : undefined,
      methods:
        newElType === 'class'
          ? [{ visibility: '+', signature: 'execute()', description: 'вызвать' }]
          : undefined,
      steps: newElType === 'process' ? ['Выполнить действие'] : undefined,
      interfaceItems:
        newElType === 'component'
          ? ['value: int — параметр компонента']
          : undefined,
      internalLogic:
        newElType === 'component' ? ['Правило внутренней логики'] : undefined,
      instanceOf: newElType === 'object' ? 'cls_item' : undefined,
      values: newElType === 'object' ? [] : undefined,
      notes: newElType === 'idea' ? [] : undefined,
    };

    setElements((prev) => [...prev, created]);
    setSelectedId(created.id);
    setActiveFile(targetFile);
    setNewElementModalOpen(false);
    setNewElTitle('');
    setNewElSlug('');
    setUncommittedChanges((c) => c + 1);
    showNotice(`Создан элемент ${created.id}`);
  };

  const isProjectEmpty = files.length === 0 || elements.length === 0;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      {/* =================================================================
          HEADER (Variation 5 System Dark style)
         ================================================================= */}
      <header className="sys-header">
        <div className="flex items-center gap-8">
          <div className="brand" onClick={() => setActiveTab('kb')}>
            PLANAGER
          </div>

          <nav className="nav-links">
            <button
              type="button"
              onClick={() => setActiveTab('kb')}
              className={`nav-link ${activeTab === 'kb' ? 'active' : ''}`}
            >
              {t.tabKb}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('canvas')}
              className={`nav-link ${activeTab === 'canvas' ? 'active' : ''}`}
            >
              {t.tabCanvas}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('library')}
              className={`nav-link ${activeTab === 'library' ? 'active' : ''}`}
            >
              {t.tabLibrary}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`nav-link ${activeTab === 'settings' ? 'active' : ''}`}
            >
              {t.tabSettings}
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {activeTab === 'kb' && (
            <>
              <button
                type="button"
                onClick={() => setNewElementModalOpen(true)}
                className="btn primary"
                style={{ padding: '5px 12px', height: '28px' }}
              >
                +
              </button>

              <button
                type="button"
                onClick={() => setAiModalOpen(true)}
                className="btn"
                style={{ padding: '5px 12px', height: '28px' }}
              >
                {t.aiBtn}
              </button>
            </>
          )}

          {activeTab === 'canvas' && (
            <>
              <button
                type="button"
                onClick={() => setNewElementModalOpen(true)}
                className="btn primary"
                style={{ padding: '5px 12px', height: '28px' }}
              >
                +
              </button>

              <button
                type="button"
                onClick={() => setAiModalOpen(true)}
                className="btn"
                style={{ padding: '5px 12px', height: '28px' }}
              >
                {t.aiBtn}
              </button>
            </>
          )}

          {activeTab === 'library' && (
            <>
              <button
                type="button"
                onClick={() => handleSaveCurrentToLibrary()}
                className="btn primary"
                style={{ padding: '5px 12px', height: '28px' }}
              >
                Сохранить текущий в библиотеку
              </button>
            </>
          )}
        </div>
      </header>

      {/* =================================================================
          TAB 1: БАЗА ЗНАНИЙ (Variation 5 3-Column Workspace)
         ================================================================= */}
      {activeTab === 'kb' && (
        <div className="workspace-3col">
          <button
            type="button"
            onClick={() => setLeftPanelOpen(true)}
            className={`btn p-1.5 panel-expand-btn left ${
              leftPanelOpen ? 'is-hidden' : ''
            }`}
            title="Развернуть левую панель"
          >
            <PanelLeftOpen size={15} />
          </button>

          <button
            type="button"
            onClick={() => setRightPanelOpen(true)}
            className={`btn p-1.5 panel-expand-btn right ${
              rightPanelOpen ? 'is-hidden' : ''
            }`}
            title="Развернуть правую панель"
          >
            <PanelRightOpen size={15} />
          </button>

          {/* Column 1: Explorer (.files-column) */}
          <div
            className={`panel files-column ${
              !leftPanelOpen ? 'collapsed' : ''
            }`}
          >
            <div className="files-column-inner">
              <div className="p-3 border-b border-[var(--border)] space-y-2 shrink-0">
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder="Поиск (id, имя)..."
                    value={kbSearch}
                    onChange={(e) => setKbSearch(e.target.value)}
                    className="sys-input flex-1 min-w-0 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setLeftPanelOpen(false)}
                    className="btn p-1.5 shrink-0"
                    title="Свернуть левую панель"
                  >
                    <PanelLeftClose size={15} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    value={kbTypeFilter}
                    onChange={(e) =>
                      setKbTypeFilter(e.target.value as ElementType | 'all')
                    }
                    className="sys-input mono text-[11px] w-full min-w-0 px-1.5 py-1 cursor-pointer bg-[var(--surface)] text-[var(--ink)]"
                  >
                    <option value="all">Все типы</option>
                    <option value="system">Система</option>
                    <option value="class">Класс</option>
                    <option value="process">Процесс</option>
                    <option value="component">Компонент</option>
                    <option value="object">Объект</option>
                    <option value="idea">Идея</option>
                  </select>
                  <select
                    value={kbMvpFilter}
                    onChange={(e) =>
                      setKbMvpFilter(e.target.value as 'all' | 'mvp' | 'later')
                    }
                    className="sys-input mono text-[11px] w-full min-w-0 px-1.5 py-1 cursor-pointer bg-[var(--surface)] text-[var(--ink)]"
                  >
                    <option value="all">MVP: все</option>
                    <option value="mvp">Только MVP</option>
                    <option value="later">Потом</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const name = `sys_module_${files.length + 1}.pgr`;
                    setFiles((prev) => [...prev, name]);
                    setActiveFile(name);
                    showNotice(`Создан файл ${name}`);
                  }}
                  className="pill w-full text-center cursor-pointer hover:border-[var(--accent)] py-1 block"
                >
                  + файл
                </button>
                {aiContextIds.length > 1 && (
                  <div
                    style={{
                      borderColor: 'var(--ctx-pos-border)',
                      backgroundColor: 'var(--ctx-pos-soft)',
                      color: 'var(--ctx-pos-text)',
                    }}
                    className="px-2 py-1 rounded border mono text-[10px] flex items-center justify-between gap-1"
                  >
                    <span className="truncate">
                      Выбрано (ИИ): {aiContextIds.length} элем.
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setAiContextIds(selectedId ? [selectedId] : [])
                      }
                      className="underline cursor-pointer shrink-0"
                    >
                      Сброс
                    </button>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto">
                {files.map((fileName) => {
                  const fileElems = filteredElements.filter(
                    (e) => e.fileName === fileName
                  );
                  const isFileActive =
                    (selectedElement?.fileName || activeFile) === fileName;
                  const isDragTarget = dragOverFileName === fileName;
                  return (
                    <div
                      key={fileName}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (dragOverFileName !== fileName) {
                          setDragOverFileName(fileName);
                        }
                      }}
                      onDragLeave={(e) => {
                        if (
                          !e.currentTarget.contains(
                            e.relatedTarget as Node | null
                          )
                        ) {
                          setDragOverFileName((prev) =>
                            prev === fileName ? null : prev
                          );
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOverFileName(null);
                        let idsToMove: string[] =
                          kbDraggedIdsRef.current.length > 0
                            ? kbDraggedIdsRef.current
                            : kbDraggedIds;
                        if (idsToMove.length === 0) {
                          const raw = e.dataTransfer.getData('text/plain');
                          if (raw) {
                            try {
                              const parsed = JSON.parse(raw);
                              idsToMove = Array.isArray(parsed)
                                ? parsed
                                : [raw];
                            } catch {
                              idsToMove = [raw];
                            }
                          }
                        }
                        kbDraggedIdsRef.current = [];
                        setKbDraggedIds([]);
                        const movable = elementsRef.current.filter(
                          (el) =>
                            idsToMove.includes(el.id) &&
                            el.fileName !== fileName
                        );
                        if (movable.length === 0) return;
                        const prevFileNames: Record<string, string> = {};
                        elementsRef.current.forEach((el) => {
                          prevFileNames[el.id] = el.fileName;
                        });
                        const moveSet = new Set(movable.map((m) => m.id));
                        const newEntry: MoveHistoryEntry = {
                          kind: 'kb_file_move',
                          fileNames: prevFileNames,
                          prevActiveFile: activeFile,
                          movedIds: movable.map((m) => m.id),
                        };
                        const nextHistory = [
                          ...moveHistoryRef.current.slice(-49),
                          newEntry,
                        ];
                        moveHistoryRef.current = nextHistory;
                        setMoveHistory(nextHistory);

                        const nextElements = elementsRef.current.map((el) =>
                          moveSet.has(el.id) ? { ...el, fileName } : el
                        );
                        elementsRef.current = nextElements;
                        setElements(nextElements);
                        setActiveFile(fileName);
                        setUncommittedChanges((c) => c + 1);
                        if (
                          document.activeElement instanceof HTMLElement &&
                          (document.activeElement.tagName === 'INPUT' ||
                            document.activeElement.tagName === 'TEXTAREA' ||
                            document.activeElement.tagName === 'SELECT')
                        ) {
                          document.activeElement.blur();
                        }
                        if (movable.length === 1) {
                          showNotice(
                            `Элемент ${movable[0].id} перемещён в ${fileName}`
                          );
                        } else {
                          showNotice(
                            `Перемещено элементов (${movable.length}) в ${fileName}`
                          );
                        }
                      }}
                      style={
                        isDragTarget
                          ? {
                              borderColor: 'var(--ctx-pos-text)',
                              backgroundColor: 'var(--ctx-pos-soft)',
                              boxShadow: 'inset 0 0 0 1px var(--ctx-pos-text)',
                            }
                          : undefined
                      }
                      className={`file-entry transition-colors ${
                        isFileActive ? 'active-file' : ''
                      }`}
                    >
                      <div
                        className="file-title"
                        onClick={() => {
                          setActiveFile(fileName);
                          if (fileElems[0]) {
                            setSelectedId(fileElems[0].id);
                            setAiContextIds([fileElems[0].id]);
                          }
                        }}
                      >
                        <span>{fileName}</span>
                        <span className="mono">{fileElems.length}</span>
                      </div>

                      {fileElems.length === 0 && (
                        <div className="mono text-[10px] py-1.5 px-2 rounded border border-dashed border-[var(--border)] text-center text-[var(--ink-muted)]">
                          Перетащите элементы сюда
                        </div>
                      )}

                      {fileElems.map((el) => {
                        const isSelectedEl =
                          selectedId === el.id || aiContextIds.includes(el.id);
                        const TypeIcon = ELEMENT_TYPE_ICONS[el.type];
                        return (
                          <div
                            key={el.id}
                            draggable
                            onDragStart={(e) => {
                              const currentMulti = aiContextIdsRef.current;
                              const ids =
                                currentMulti.includes(el.id) &&
                                currentMulti.length > 0
                                  ? currentMulti
                                  : e.ctrlKey || e.metaKey
                                  ? Array.from(new Set([...currentMulti, el.id]))
                                  : [el.id];
                              if (!currentMulti.includes(el.id)) {
                                selectedIdRef.current = el.id;
                                setSelectedId(el.id);
                                aiContextIdsRef.current = ids;
                                setAiContextIds(ids);
                              }
                              kbDraggedIdsRef.current = ids;
                              setKbDraggedIds(ids);
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData(
                                'text/plain',
                                ids.length === 1 ? ids[0] : JSON.stringify(ids)
                              );
                            }}
                            onDragEnd={() => {
                              kbDraggedIdsRef.current = [];
                              setKbDraggedIds([]);
                              setDragOverFileName(null);
                            }}
                            onClick={(e) => {
                              handleSelectWithModifiers(
                                el.id,
                                e.ctrlKey || e.metaKey,
                                fileName
                              );
                              setLineRangeFilter(null);
                            }}
                            title="ЛКМ — выбрать, Ctrl+ЛКМ — множественное выделение (контекст ИИ), перетаскивание — переместить в другой файл .pgr"
                            className={`tree-node ${
                              isSelectedEl ? 'active' : ''
                            }`}
                          >
                            <span
                              className="mono truncate flex items-center gap-2 min-w-0"
                              style={{
                                color: isSelectedEl
                                  ? 'var(--ctx-pos-text)'
                                  : undefined,
                              }}
                            >
                              <TypeIcon size={14} className="shrink-0" />
                              <span className="truncate">
                                {stripElementPrefix(el.id)}
                              </span>
                            </span>
                            {el.mvp && (
                              <span
                                className="pill"
                                style={{
                                  color: 'var(--ctx-pos-text)',
                                  borderColor: 'var(--ctx-pos-border)',
                                }}
                              >
                                MVP
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              {/* Empty Project Demo Switcher */}
              <div className="p-3 border-t border-[var(--border)]">
                {!isProjectEmpty ? (
                  <button
                    type="button"
                    onClick={() => {
                      setElements([]);
                      setFiles([]);
                      setSelectedId(null);
                      showNotice('Открыт новый пустой проект без файлов .pgr');
                    }}
                    className="btn w-full"
                  >
                    Пустой проект (тест)
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setFiles(INITIAL_FILES);
                      setElements(INITIAL_ELEMENTS);
                      setActiveFile('sys_inventory.pgr');
                      setSelectedId('cls_item');
                      showNotice('Демо-проект восстановлен');
                    }}
                    className="btn primary w-full"
                  >
                    Загрузить демо-проект
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Column 2: Center Editor (.editor-column) */}
          <div className="panel editor-column">
            {kbMainGraphOpen ? (
              <div className="relative flex flex-col w-full h-full overflow-hidden">
                <div
                  ref={mainGraphRef}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    mainGraphDownClientRef.current = {
                      x: e.clientX,
                      y: e.clientY,
                    };
                    mainGraphDragMovedRef.current = false;
                    setMainGraphIsPanning(true);
                    setMainGraphPanStart({
                      x: e.clientX - mainGraphPan.x,
                      y: e.clientY - mainGraphPan.y,
                    });
                  }}
                  onMouseMove={(e) => {
                    if (!mainGraphIsPanning) return;
                    const dist = Math.hypot(
                      e.clientX - mainGraphDownClientRef.current.x,
                      e.clientY - mainGraphDownClientRef.current.y
                    );
                    if (dist > 4) {
                      mainGraphDragMovedRef.current = true;
                    }
                    setMainGraphView((prev) => ({
                      ...prev,
                      pan: {
                        x: e.clientX - mainGraphPanStart.x,
                        y: e.clientY - mainGraphPanStart.y,
                      },
                    }));
                  }}
                  onMouseUp={() => {
                    setMainGraphIsPanning(false);
                  }}
                  onClick={(e) => {
                    if (mainGraphDragMovedRef.current) return;
                    if ((e.target as HTMLElement).closest('.main-graph-node')) {
                      return;
                    }
                    if (!e.ctrlKey && !e.metaKey) {
                      setSelectedId(null);
                      setAiContextIds([]);
                    }
                  }}
                  style={{
                    backgroundColor: 'var(--surface)',
                    backgroundImage:
                      'radial-gradient(var(--border) 1px, transparent 1px)',
                    backgroundSize: '24px 24px',
                    backgroundPosition: `${mainGraphPan.x}px ${mainGraphPan.y}px`,
                    cursor: mainGraphIsPanning ? 'grabbing' : 'grab',
                    overscrollBehavior: 'contain',
                  }}
                  className="relative flex-1 w-full overflow-hidden select-none"
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      transform: `translate(${mainGraphPan.x}px, ${mainGraphPan.y}px) scale(${
                        mainGraphZoom / 100
                      })`,
                      transformOrigin: '0 0',
                      width: `${mainGraphLayout.width}px`,
                      height: `${mainGraphLayout.height}px`,
                    }}
                    className="shrink-0"
                  >
                    <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
                      <defs>
                        <marker
                          id="main-graph-arrow"
                          markerUnits="userSpaceOnUse"
                          viewBox="0 0 10 10"
                          refX="27"
                          refY="5"
                          markerWidth="6"
                          markerHeight="6"
                          orient="auto-start-reverse"
                        >
                          <path d="M 0 1 L 9 5 L 0 9 z" fill="context-stroke" />
                        </marker>
                      </defs>
                      {mainGraphLayout.activeEdges.map((edge, edgeIdx) => {
                        const p1 = mainGraphLayout.posMap[edge.source];
                        const p2 = mainGraphLayout.posMap[edge.target];
                        if (!p1 || !p2) return null;

                        const focusId = hoveredMiniNodeId || selectedId;
                        const isConnectedToFocus =
                          focusId === edge.source || focusId === edge.target;
                        const isDimmed =
                          Boolean(hoveredMiniNodeId) && !isConnectedToFocus;

                        const dash =
                          edge.relation === 'extends'
                            ? '5 4'
                            : edge.relation === 'notes'
                            ? '2 3'
                            : undefined;

                        // Offset label when opposite/parallel edges exist between the same pair of nodes
                        const pairEdges = mainGraphLayout.activeEdges.filter(
                          (other) =>
                            (other.source === edge.source &&
                              other.target === edge.target) ||
                            (other.source === edge.target &&
                              other.target === edge.source)
                        );
                        const pairIdx = pairEdges.findIndex(
                          (other) => other.id === edge.id
                        );
                        const labelShift =
                          pairEdges.length > 1
                            ? (pairIdx - (pairEdges.length - 1) / 2) * 14
                            : 0;

                        const midX = (p1.x + p2.x) / 2;
                        const midY = (p1.y + p2.y) / 2 - 4 + labelShift;

                        return (
                          <g key={`${edge.id}_${edgeIdx}`}>
                            <line
                              x1={p1.x}
                              y1={p1.y}
                              x2={p2.x}
                              y2={p2.y}
                              stroke={
                                !edge.valid
                                  ? 'var(--ctx-neg)'
                                  : isConnectedToFocus
                                  ? 'var(--accent)'
                                  : 'var(--ink-muted)'
                              }
                              strokeWidth={isConnectedToFocus ? 1.8 : 1.15}
                              strokeDasharray={dash}
                              strokeOpacity={
                                isDimmed ? 0.18 : isConnectedToFocus ? 0.92 : 0.45
                              }
                              markerEnd="url(#main-graph-arrow)"
                            />
                            <text
                              x={midX}
                              y={midY}
                              textAnchor="middle"
                              fill={
                                isConnectedToFocus
                                  ? 'var(--ink)'
                                  : 'var(--ink-muted)'
                              }
                              opacity={isDimmed ? 0.2 : 0.85}
                              className="mono text-[9px]"
                              style={{
                                paintOrder: 'stroke',
                                stroke: 'var(--surface)',
                                strokeWidth: '3px',
                              }}
                            >
                              {edge.relation}
                            </text>
                          </g>
                        );
                      })}
                    </svg>

                    {mainGraphLayout.nodes.map((el) => {
                      const pos = mainGraphLayout.posMap[el.id];
                      if (!pos) return null;
                      const TypeIcon = ELEMENT_TYPE_ICONS[el.type];
                      const isSelectedNode =
                        selectedId === el.id || aiContextIds.includes(el.id);
                      const isHoveredNode = hoveredMiniNodeId === el.id;
                      const focusId = hoveredMiniNodeId || selectedId;
                      const isNeighborOfFocus =
                        focusId &&
                        mainGraphLayout.activeEdges.some(
                          (e) =>
                            (e.source === focusId && e.target === el.id) ||
                            (e.target === focusId && e.source === el.id)
                        );
                      const isDimmed =
                        Boolean(hoveredMiniNodeId) &&
                        !isHoveredNode &&
                        !isNeighborOfFocus;

                      const isRejectedIdea =
                        el.type === 'idea' &&
                        Boolean(el.altTo && el.altTo !== '-');
                      const nodeBorderColor =
                        isSelectedNode || isHoveredNode
                          ? 'var(--accent)'
                          : isRejectedIdea
                          ? 'var(--ctx-neg-border)'
                          : el.mvp
                          ? 'var(--ctx-pos-border)'
                          : 'var(--border)';
                      const nodeIconColor =
                        isSelectedNode || isHoveredNode
                          ? 'var(--accent)'
                          : isRejectedIdea
                          ? 'var(--ctx-neg-text)'
                          : el.mvp
                          ? 'var(--ctx-pos-text)'
                          : 'var(--ink)';

                      return (
                        <div
                          key={el.id}
                          onMouseEnter={() => setHoveredMiniNodeId(el.id)}
                          onMouseLeave={() => setHoveredMiniNodeId(null)}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (mainGraphDragMovedRef.current) return;
                            handleSelectWithModifiers(
                              el.id,
                              e.ctrlKey || e.metaKey,
                              el.fileName
                            );
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (mainGraphDragMovedRef.current) return;
                            setSelectedId(el.id);
                            setActiveFile(el.fileName);
                            setKbMainGraphOpen(false);
                          }}
                          style={{
                            left: `${pos.x}px`,
                            top: `${pos.y}px`,
                            transform: 'translate(-50%, -50%)',
                            opacity: isDimmed ? 0.3 : 1,
                            zIndex:
                              isSelectedNode || isHoveredNode
                                ? 20
                                : isNeighborOfFocus
                                ? 15
                                : 10,
                          }}
                          title={`${el.id} — ${el.title} (двойной клик: открыть в редакторе)`}
                          className="main-graph-node absolute w-9 h-9 cursor-pointer transition-opacity duration-150"
                        >
                          <div
                            style={{
                              backgroundColor: 'var(--bg)',
                              borderColor: nodeBorderColor,
                              color: nodeIconColor,
                              boxShadow:
                                isSelectedNode || isHoveredNode
                                  ? '0 0 0 1px var(--accent)'
                                  : undefined,
                            }}
                            className="w-9 h-9 rounded border flex items-center justify-center transition-transform duration-150 hover:scale-110"
                          >
                            <TypeIcon size={17} />
                          </div>
                          <div className="absolute left-1/2 top-full -translate-x-1/2 mt-1.5 flex flex-col items-center pointer-events-none">
                            <span
                              style={{
                                color:
                                  isSelectedNode || isHoveredNode
                                    ? 'var(--ink)'
                                    : 'var(--ink-muted)',
                                backgroundColor: 'var(--surface)',
                              }}
                              className="mono text-[10px] font-medium leading-none px-1.5 py-0.5 rounded border border-transparent whitespace-nowrap"
                            >
                              {stripElementPrefix(el.id)}
                            </span>
                            <span className="text-[10px] text-[var(--ink-muted)] max-w-[140px] truncate mt-0.5 whitespace-nowrap">
                              {el.title}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Floating bottom-left controls: Minimize icon button + Spread slider */}
                <div className="absolute bottom-3 left-3 z-30 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setKbMainGraphOpen(false)}
                    style={{ backgroundColor: 'var(--bg)', height: '32px', width: '32px' }}
                    className="btn p-0 flex items-center justify-center"
                    title="Вернуться к редактированию элемента"
                  >
                    <Minimize2 size={18} />
                  </button>
                  <div
                    style={{ backgroundColor: 'var(--bg)', height: '32px' }}
                    className="pill flex items-center gap-2 px-2.5 py-0"
                    title="Коэффициент отдаления между элементами графа"
                  >
                    <input
                      type="range"
                      min={0.5}
                      max={2.5}
                      step={0.05}
                      value={graphSpread}
                      onChange={(e) =>
                        setGraphSpread(parseFloat(e.target.value))
                      }
                      className="w-24 accent-[var(--accent)] cursor-pointer"
                    />
                    <button
                      type="button"
                      onClick={() => setGraphSpread(1)}
                      className="flex items-center justify-center p-1 rounded border border-transparent hover:border-[var(--border)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                      title="Сбросить масштаб до 1"
                    >
                      <RotateCcw size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="editor-scroll"
                style={{
                  paddingLeft: leftPanelOpen ? '24px' : '52px',
                  paddingRight: rightPanelOpen ? '24px' : '52px',
                }}
              >
                {isProjectEmpty ? (
                <div className="p-10 border border-dashed border-[var(--border)] rounded-lg text-center space-y-4 my-8">
                  <div className="label">EMPTY WORKSPACE</div>
                  <h2 className="text-xl font-bold">
                    В проекте пока нет файлов плана (.pgr)
                  </h2>
                  <p className="text-xs text-[var(--ink-muted)] max-w-md mx-auto leading-relaxed">
                    Создайте первый файл разметки .pgr, вставьте готовые блоки из Библиотеки юнитов или загрузите демонстрационный проект.
                  </p>
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setFiles(['sys_core.pgr']);
                        setActiveFile('sys_core.pgr');
                        setNewElFile('sys_core.pgr');
                        setNewElementModalOpen(true);
                      }}
                      className="btn pos"
                    >
                      + Создать первый файл .pgr
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('library')}
                      className="btn"
                    >
                      Библиотека юнитов
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFiles(INITIAL_FILES);
                        setElements(INITIAL_ELEMENTS);
                        setActiveFile('sys_inventory.pgr');
                        setSelectedId('cls_item');
                      }}
                      className="btn primary"
                    >
                      Загрузить пример проекта
                    </button>
                  </div>
                </div>
              ) : selectedElement ? (
                <>
                  {/* Editor Meta Header */}
                  <div className="editor-meta">
                    <div className="flex items-center gap-2.5">
                      <span className="pill">{selectedElement.fileName}</span>
                      <span className="pill">
                        {TYPE_HEADERS_RU[selectedElement.type]}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setKbMainGraphOpen(true)}
                        className="btn py-1 px-2.5"
                        title="Открыть граф элементов в основной области"
                      >
                        <Maximize2 size={12} />
                        <span>Граф</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setKbEditorMode((m) =>
                            m === 'structured' ? 'raw_pgr' : 'structured'
                          )
                        }
                        className="btn py-1 px-2.5"
                      >
                        {kbEditorMode === 'structured'
                          ? 'Текст .pgr'
                          : 'Блочная сетка'}
                      </button>
                    </div>
                  </div>

                  {/* Display Title in Syne 800 */}
                  <input
                    type="text"
                    value={selectedElement.title}
                    onChange={(e) =>
                      updateElement({
                        ...selectedElement,
                        title: e.target.value,
                      })
                    }
                    className="title-display"
                  />
                  <div
                    className="label"
                    style={{ marginTop: '-12px', display: 'block' }}
                  >
                    UID: {selectedElement.id}
                  </div>

                  {kbEditorMode === 'structured' ? (
                    <div className="field-grid">
                      {/* Row 1: Header */}
                      <div
                        className="field-row"
                        onClick={() => setCursorLine(1)}
                      >
                        <div className="field-label">Header</div>
                        <div className="field-value">
                          <input
                            type="text"
                            value={`## ${TYPE_HEADERS_RU[selectedElement.type]}: ${selectedElement.title}`}
                            onChange={(e) => {
                              const cleaned = e.target.value.replace(
                                /^##\s*[^:]+:\s*/,
                                ''
                              );
                              updateElement({
                                ...selectedElement,
                                title: cleaned,
                              });
                            }}
                          />
                        </div>
                      </div>

                      {/* Row 2: Identity & Hierarchy */}
                      <div
                        className="field-row"
                        onClick={() => setCursorLine(2)}
                      >
                        <div className="field-label">Identity</div>
                        <div className="field-value">
                          <div className="identity-grid">
                            <span className="label">id:</span>
                            <input
                              type="text"
                              value={selectedElement.id}
                              onChange={(e) =>
                                updateElement({
                                  ...selectedElement,
                                  id: e.target.value.trim(),
                                })
                              }
                              className="identity-control"
                              style={{ color: 'var(--accent)' }}
                            />

                            {selectedElement.type !== 'system' && (
                              <>
                                <span className="label">parent:</span>
                                <select
                                  value={selectedElement.parent || '-'}
                                  onChange={(e) =>
                                    updateElement({
                                      ...selectedElement,
                                      parent: e.target.value,
                                    })
                                  }
                                  className="identity-control cursor-pointer bg-[var(--surface)] text-[var(--ink)]"
                                >
                                  <option
                                    value="-"
                                    className="bg-[var(--surface)] text-[var(--ink)]"
                                  >
                                    - (без родителя)
                                  </option>
                                  {elements
                                    .filter((x) => x.type === 'system')
                                    .map((sys) => (
                                      <option
                                        key={sys.id}
                                        value={sys.id}
                                        className="bg-[var(--surface)] text-[var(--ink)]"
                                      >
                                        {sys.id}
                                      </option>
                                    ))}
                                </select>
                              </>
                            )}

                            {selectedElement.type === 'class' && (
                              <>
                                <span className="label">extends:</span>
                                <select
                                  value={selectedElement.extendsId || '-'}
                                  onChange={(e) =>
                                    updateElement({
                                      ...selectedElement,
                                      extendsId: e.target.value,
                                    })
                                  }
                                  className="identity-control cursor-pointer bg-[var(--surface)] text-[var(--ink)]"
                                >
                                  <option
                                    value="-"
                                    className="bg-[var(--surface)] text-[var(--ink)]"
                                  >
                                    -
                                  </option>
                                  {elements
                                    .filter(
                                      (x) =>
                                        x.type === 'class' &&
                                        x.id !== selectedElement.id
                                    )
                                    .map((cls) => (
                                      <option
                                        key={cls.id}
                                        value={cls.id}
                                        className="bg-[var(--surface)] text-[var(--ink)]"
                                      >
                                        {cls.id}
                                      </option>
                                    ))}
                                </select>
                              </>
                            )}

                            {selectedElement.type === 'object' && (
                              <>
                                <span className="label">instance_of:</span>
                                <select
                                  value={selectedElement.instanceOf || '-'}
                                  onChange={(e) =>
                                    updateElement({
                                      ...selectedElement,
                                      instanceOf: e.target.value,
                                    })
                                  }
                                  className="identity-control cursor-pointer bg-[var(--surface)] text-[var(--ink)]"
                                >
                                  <option
                                    value="-"
                                    className="bg-[var(--surface)] text-[var(--ink)]"
                                  >
                                    - (только компоненты)
                                  </option>
                                  {elements
                                    .filter((x) => x.type === 'class')
                                    .map((cls) => (
                                      <option
                                        key={cls.id}
                                        value={cls.id}
                                        className="bg-[var(--surface)] text-[var(--ink)]"
                                      >
                                        {cls.id}
                                      </option>
                                    ))}
                                </select>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Row 3: Description */}
                      <div
                        className="field-row"
                        onClick={() => setCursorLine(4)}
                      >
                        <div className="field-label">Description</div>
                        <div className="field-value">
                          <textarea
                            rows={2}
                            value={selectedElement.description}
                            onChange={(e) =>
                              updateElement({
                                ...selectedElement,
                                description: e.target.value,
                              })
                            }
                          />
                        </div>
                      </div>

                      {/* CLASS: Fields & Methods */}
                      {selectedElement.type === 'class' && (
                        <>
                          <div
                            className="field-row"
                            onClick={() => setCursorLine(7)}
                          >
                            <div className="field-label">Fields</div>
                            <div className="field-value space-y-2">
                              {(selectedElement.fields || []).map((f, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between text-xs mono py-1 border-b border-[var(--border)]"
                                >
                                  <span>
                                    <strong style={{ color: 'var(--ink)' }}>
                                      {f.name}
                                    </strong>
                                    : {f.dataType} — {f.description}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateElement({
                                        ...selectedElement,
                                        fields: (
                                          selectedElement.fields || []
                                        ).filter((_, i) => i !== idx),
                                      })
                                    }
                                    className="text-[11px] hover:text-[var(--ctx-neg-text)] cursor-pointer"
                                  >
                                    удалить
                                  </button>
                                </div>
                              ))}
                              <div className="flex items-center gap-2 pt-1 w-full">
                                <input
                                  placeholder="имя_поля"
                                  value={inlineFieldName}
                                  onChange={(e) =>
                                    setInlineFieldName(e.target.value)
                                  }
                                  className="sys-input mono min-w-0 shrink-0"
                                  style={{ width: '108px' }}
                                />
                                <input
                                  placeholder="тип (float)"
                                  value={inlineFieldType}
                                  onChange={(e) =>
                                    setInlineFieldType(e.target.value)
                                  }
                                  className="sys-input mono min-w-0 shrink-0"
                                  style={{ width: '92px' }}
                                />
                                <input
                                  placeholder="описание"
                                  value={inlineFieldDesc}
                                  onChange={(e) =>
                                    setInlineFieldDesc(e.target.value)
                                  }
                                  className="sys-input flex-1 min-w-0"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!inlineFieldName.trim()) return;
                                    updateElement({
                                      ...selectedElement,
                                      fields: [
                                        ...(selectedElement.fields || []),
                                        {
                                          name: inlineFieldName.trim(),
                                          dataType:
                                            inlineFieldType.trim() || 'string',
                                          description:
                                            inlineFieldDesc.trim() || 'поле',
                                        },
                                      ],
                                    });
                                    setInlineFieldName('');
                                    setInlineFieldDesc('');
                                  }}
                                  className="btn shrink-0"
                                >
                                  + Поле
                                </button>
                              </div>
                            </div>
                          </div>

                          <div
                            className="field-row"
                            onClick={() => setCursorLine(11)}
                          >
                            <div className="field-label">Methods</div>
                            <div className="field-value space-y-2">
                              {(selectedElement.methods || []).map((m, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between text-xs mono py-1 border-b border-[var(--border)]"
                                >
                                  <span>
                                    <strong
                                      style={{
                                        color:
                                          m.visibility === '-'
                                            ? 'var(--ctx-neg-text)'
                                            : 'var(--ctx-pos-text)',
                                      }}
                                    >
                                      {m.visibility} {m.signature}
                                    </strong>{' '}
                                    — {m.description}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateElement({
                                        ...selectedElement,
                                        methods: (
                                          selectedElement.methods || []
                                        ).filter((_, i) => i !== idx),
                                      })
                                    }
                                    className="text-[11px] hover:text-[var(--ctx-neg-text)] cursor-pointer"
                                  >
                                    удалить
                                  </button>
                                </div>
                              ))}
                              <div className="flex items-center gap-2 pt-1 w-full">
                                <select
                                  value={inlineMethodVis}
                                  onChange={(e) =>
                                    setInlineMethodVis(
                                      e.target.value as '+' | '-'
                                    )
                                  }
                                  className="sys-input mono min-w-0 shrink-0 cursor-pointer"
                                  style={{ width: '92px' }}
                                >
                                  <option value="+">+ публ.</option>
                                  <option value="-">- прив.</option>
                                </select>
                                <input
                                  placeholder="use()"
                                  value={inlineMethodSig}
                                  onChange={(e) =>
                                    setInlineMethodSig(e.target.value)
                                  }
                                  className="sys-input mono min-w-0 shrink-0"
                                  style={{ width: '108px' }}
                                />
                                <input
                                  placeholder="описание метода"
                                  value={inlineMethodDesc}
                                  onChange={(e) =>
                                    setInlineMethodDesc(e.target.value)
                                  }
                                  className="sys-input flex-1 min-w-0"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!inlineMethodSig.trim()) return;
                                    updateElement({
                                      ...selectedElement,
                                      methods: [
                                        ...(selectedElement.methods || []),
                                        {
                                          visibility: inlineMethodVis,
                                          signature: inlineMethodSig.trim(),
                                          description:
                                            inlineMethodDesc.trim() || 'метод',
                                        },
                                      ],
                                    });
                                    setInlineMethodSig('');
                                    setInlineMethodDesc('');
                                  }}
                                  className="btn shrink-0"
                                >
                                  + Метод
                                </button>
                              </div>
                            </div>
                          </div>
                        </>
                      )}

                      {/* OBJECT: Inherited & Overridden Values */}
                      {selectedElement.type === 'object' && (
                        <div
                          className="field-row"
                          onClick={() => setCursorLine(8)}
                        >
                          <div className="field-label">Values</div>
                          <div className="field-value space-y-2">
                            {inheritedObjectFields.map((inh) => {
                              const valObj = (
                                selectedElement.values || []
                              ).find((v) => v.fieldName === inh.fieldName);
                              return (
                                <div
                                  key={inh.fieldName}
                                  className="flex items-center gap-3 py-1 border-b border-[var(--border)]"
                                >
                                  <span className="mono w-48 truncate">
                                    <strong style={{ color: 'var(--ink)' }}>
                                      {inh.fieldName}
                                    </strong>{' '}
                                    ({inh.dataType} · {inh.sourceId})
                                  </span>
                                  <input
                                    type="text"
                                    placeholder="Укажите конкретное значение..."
                                    value={valObj?.value || ''}
                                    onChange={(e) => {
                                      const nextVals = [
                                        ...(selectedElement.values || []),
                                      ];
                                      const idx = nextVals.findIndex(
                                        (x) => x.fieldName === inh.fieldName
                                      );
                                      if (!e.target.value.trim()) {
                                        if (idx !== -1) nextVals.splice(idx, 1);
                                      } else if (idx !== -1) {
                                        nextVals[idx] = {
                                          fieldName: inh.fieldName,
                                          value: e.target.value,
                                        };
                                      } else {
                                        nextVals.push({
                                          fieldName: inh.fieldName,
                                          value: e.target.value,
                                        });
                                      }
                                      updateElement({
                                        ...selectedElement,
                                        values: nextVals,
                                      });
                                    }}
                                    className="mono flex-1"
                                    style={{ color: 'var(--accent)' }}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* PROCESS: Steps */}
                      {selectedElement.type === 'process' && (
                        <div
                          className="field-row"
                          onClick={() => setCursorLine(8)}
                        >
                          <div className="field-label">Steps</div>
                          <div className="field-value space-y-2">
                            {(selectedElement.steps || []).map((st, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between text-xs py-1 border-b border-[var(--border)]"
                              >
                                <span>
                                  <span className="mono mr-2">{idx + 1}.</span>
                                  {st}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateElement({
                                      ...selectedElement,
                                      steps: (
                                        selectedElement.steps || []
                                      ).filter((_, i) => i !== idx),
                                    })
                                  }
                                  className="mono text-[11px] cursor-pointer"
                                >
                                  удалить
                                </button>
                              </div>
                            ))}
                            <div className="flex gap-2 pt-1">
                              <input
                                placeholder="Добавить шаг последовательности..."
                                value={inlineStepText}
                                onChange={(e) =>
                                  setInlineStepText(e.target.value)
                                }
                                className="sys-input flex-1"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (!inlineStepText.trim()) return;
                                  updateElement({
                                    ...selectedElement,
                                    steps: [
                                      ...(selectedElement.steps || []),
                                      inlineStepText.trim(),
                                    ],
                                  });
                                  setInlineStepText('');
                                }}
                                className="btn"
                              >
                                + Шаг
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* COMPONENT: Interface & Internal Logic */}
                      {selectedElement.type === 'component' && (
                        <>
                          <div
                            className="field-row"
                            onClick={() => setCursorLine(8)}
                          >
                            <div className="field-label">Interface (+)</div>
                            <div className="field-value space-y-2">
                              {(selectedElement.interfaceItems || []).map(
                                (it, idx) => (
                                  <div
                                    key={idx}
                                    className="flex items-center justify-between mono text-xs py-1 border-b border-[var(--border)]"
                                  >
                                    <span>
                                      <strong
                                        style={{ color: 'var(--ctx-pos-text)' }}
                                      >
                                        +
                                      </strong>{' '}
                                      {it}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateElement({
                                          ...selectedElement,
                                          interfaceItems: (
                                            selectedElement.interfaceItems || []
                                          ).filter((_, i) => i !== idx),
                                        })
                                      }
                                      className="text-[11px] hover:text-[var(--ctx-neg-text)] cursor-pointer"
                                    >
                                      удалить
                                    </button>
                                  </div>
                                )
                              )}
                              <div className="flex gap-2 pt-1">
                                <input
                                  placeholder="param: int — описание"
                                  value={inlineInterfaceText}
                                  onChange={(e) =>
                                    setInlineInterfaceText(e.target.value)
                                  }
                                  className="sys-input flex-1 mono"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!inlineInterfaceText.trim()) return;
                                    updateElement({
                                      ...selectedElement,
                                      interfaceItems: [
                                        ...(selectedElement.interfaceItems ||
                                          []),
                                        inlineInterfaceText.trim(),
                                      ],
                                    });
                                    setInlineInterfaceText('');
                                  }}
                                  className="btn"
                                >
                                  + Интерфейс
                                </button>
                              </div>
                            </div>
                          </div>

                          <div
                            className="field-row"
                            onClick={() => setCursorLine(12)}
                          >
                            <div className="field-label">Internal Logic (-)</div>
                            <div className="field-value space-y-2">
                              {(selectedElement.internalLogic || []).map(
                                (lg, idx) => (
                                  <div
                                    key={idx}
                                    className="flex items-center justify-between text-xs py-1 border-b border-[var(--border)]"
                                  >
                                    <span>
                                      <strong
                                        style={{ color: 'var(--ctx-neg-text)' }}
                                      >
                                        -
                                      </strong>{' '}
                                      {lg}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateElement({
                                          ...selectedElement,
                                          internalLogic: (
                                            selectedElement.internalLogic || []
                                          ).filter((_, i) => i !== idx),
                                        })
                                      }
                                      className="mono text-[11px] hover:text-[var(--ctx-neg-text)] cursor-pointer"
                                    >
                                      удалить
                                    </button>
                                  </div>
                                )
                              )}
                              <div className="flex gap-2 pt-1">
                                <input
                                  placeholder="Правило внутренней логики..."
                                  value={inlineLogicText}
                                  onChange={(e) =>
                                    setInlineLogicText(e.target.value)
                                  }
                                  className="sys-input flex-1"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!inlineLogicText.trim()) return;
                                    updateElement({
                                      ...selectedElement,
                                      internalLogic: [
                                        ...(selectedElement.internalLogic ||
                                          []),
                                        inlineLogicText.trim(),
                                      ],
                                    });
                                    setInlineLogicText('');
                                  }}
                                  className="btn"
                                >
                                  + Правило
                                </button>
                              </div>
                            </div>
                          </div>
                        </>
                      )}

                      {/* IDEA: Linked To (alt_to & alt_reason) & Keywords/Notes */}
                      {selectedElement.type === 'idea' && (
                        <>
                          <div
                            className="field-row"
                            onClick={() => setCursorLine(10)}
                          >
                            <div className="field-label">Linked To (Alt)</div>
                            <div className="field-value flex items-center gap-4 flex-wrap">
                              <select
                                value={selectedElement.altTo || '-'}
                                onChange={(e) =>
                                  updateElement({
                                    ...selectedElement,
                                    altTo: e.target.value,
                                  })
                                }
                                className="identity-control cursor-pointer"
                                style={{
                                  width: '200px',
                                  color: 'var(--ctx-neg-text)',
                                }}
                              >
                                <option value="-">
                                  - (мысль на будущее)
                                </option>
                                {elements
                                  .filter((x) => x.id !== selectedElement.id)
                                  .map((oe) => (
                                    <option key={oe.id} value={oe.id}>
                                      {oe.id}
                                    </option>
                                  ))}
                              </select>
                              <input
                                type="text"
                                placeholder="Причина отказа (alt_reason)..."
                                value={selectedElement.altReason || ''}
                                onChange={(e) =>
                                  updateElement({
                                    ...selectedElement,
                                    altReason: e.target.value,
                                  })
                                }
                                className="flex-1 text-xs"
                                style={{ color: 'var(--ink-muted)' }}
                              />
                            </div>
                          </div>

                          <div
                            className="field-row"
                            onClick={() => setCursorLine(14)}
                          >
                            <div className="field-label">Notes</div>
                            <div className="field-value space-y-2">
                              <div className="mono">
                                {(selectedElement.notes || []).join(', ') ||
                                  'отдельно стоящая идея (без привязки)'}
                              </div>
                              <div className="flex flex-wrap gap-2 pt-1">
                                {elements
                                  .filter((x) => x.id !== selectedElement.id)
                                  .map((target) => {
                                    const active = (
                                      selectedElement.notes || []
                                    ).includes(target.id);
                                    return (
                                      <button
                                        key={target.id}
                                        type="button"
                                        onClick={() => {
                                          const curr =
                                            selectedElement.notes || [];
                                          const next = active
                                            ? curr.filter(
                                                (id) => id !== target.id
                                              )
                                            : [...curr, target.id];
                                          updateElement({
                                            ...selectedElement,
                                            notes: next,
                                          });
                                        }}
                                        className="pill cursor-pointer"
                                        style={{
                                          borderColor: active
                                            ? 'var(--accent)'
                                            : undefined,
                                          color: active
                                            ? 'var(--accent)'
                                            : undefined,
                                        }}
                                      >
                                        {target.id}
                                      </button>
                                    );
                                  })}
                              </div>
                            </div>
                          </div>
                        </>
                      )}

                      {/* Shared Components (has) */}
                      {['class', 'process', 'object'].includes(
                        selectedElement.type
                      ) && (
                        <div
                          className="field-row"
                          onClick={() => setCursorLine(16)}
                        >
                          <div className="field-label">Components (has)</div>
                          <div className="field-value flex flex-wrap gap-2">
                            {elements
                              .filter((e) => e.type === 'component')
                              .map((cmp) => {
                                const active = (
                                  selectedElement.components || []
                                ).includes(cmp.id);
                                return (
                                  <button
                                    key={cmp.id}
                                    type="button"
                                    onClick={() => {
                                      const curr =
                                        selectedElement.components || [];
                                      const next = active
                                        ? curr.filter((x) => x !== cmp.id)
                                        : [...curr, cmp.id];
                                      updateElement({
                                        ...selectedElement,
                                        components: next,
                                      });
                                    }}
                                    className="pill cursor-pointer"
                                    style={{
                                      borderColor: active
                                        ? 'var(--accent)'
                                        : undefined,
                                      color: active
                                        ? 'var(--accent)'
                                        : undefined,
                                    }}
                                  >
                                    {active ? '✓ ' : '+ '}
                                    {cmp.id}
                                  </button>
                                );
                              })}
                          </div>
                        </div>
                      )}

                      {/* Shared Uses */}
                      {['class', 'process'].includes(selectedElement.type) && (
                        <div
                          className="field-row"
                          onClick={() => setCursorLine(18)}
                        >
                          <div className="field-label">Uses</div>
                          <div className="field-value flex flex-wrap gap-2">
                            {elements
                              .filter((e) => e.id !== selectedElement.id)
                              .map((target) => {
                                const active = (
                                  selectedElement.uses || []
                                ).includes(target.id);
                                return (
                                  <button
                                    key={target.id}
                                    type="button"
                                    onClick={() => {
                                      const curr = selectedElement.uses || [];
                                      const next = active
                                        ? curr.filter((x) => x !== target.id)
                                        : [...curr, target.id];
                                      updateElement({
                                        ...selectedElement,
                                        uses: next,
                                      });
                                    }}
                                    className="pill cursor-pointer"
                                    style={{
                                      borderColor: active
                                        ? 'var(--accent)'
                                        : undefined,
                                      color: active
                                        ? 'var(--accent)'
                                        : undefined,
                                    }}
                                  >
                                    {active ? '→ ' : ''}
                                    {target.id}
                                  </button>
                                );
                              })}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Raw .pgr line-range mode */
                    <div className="field-grid">
                      <div className="field-row">
                        <div className="field-label">
                          .pgr Range
                          {lineRangeFilter && (
                            <button
                              type="button"
                              onClick={() => setLineRangeFilter(null)}
                              className="block mt-2 underline cursor-pointer"
                            >
                              Показать все
                            </button>
                          )}
                        </div>
                        <div className="field-value space-y-3">
                          <div className="p-3 border border-[var(--border)] rounded bg-[var(--bg)] max-h-64 overflow-y-auto mono">
                            {rawPgrDraft.split('\n').map((line, idx) => {
                              const num = idx + 1;
                              if (
                                lineRangeFilter &&
                                (num < lineRangeFilter.start ||
                                  num > lineRangeFilter.end)
                              ) {
                                return null;
                              }
                              const inCurrent =
                                num >= selectedElementRange.startLine &&
                                num <= selectedElementRange.endLine;
                              return (
                                <div
                                  key={num}
                                  onClick={() => setCursorLine(num)}
                                  className="flex gap-3 px-1.5 py-0.5 cursor-pointer"
                                  style={{
                                    backgroundColor: inCurrent
                                      ? 'var(--ctx-pos-soft)'
                                      : 'transparent',
                                    color: inCurrent
                                      ? 'var(--ctx-pos-text)'
                                      : 'var(--ink-muted)',
                                  }}
                                >
                                  <span className="w-7 text-right opacity-50 select-none">
                                    {num}
                                  </span>
                                  <span className="whitespace-pre-wrap">
                                    {line || ' '}
                                  </span>
                                </div>
                              );
                            })}
                          </div>

                          <textarea
                            rows={7}
                            value={rawPgrDraft}
                            onChange={(e) => setRawPgrDraft(e.target.value)}
                            className="sys-input w-full mono"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const parsed = parsePgrFileContent(
                                rawPgrDraft,
                                selectedElement.fileName,
                                elements
                              );
                              setElements((prev) => [
                                ...prev.filter(
                                  (x) =>
                                    x.fileName !== selectedElement.fileName
                                ),
                                ...parsed,
                              ]);
                              setUncommittedChanges((c) => c + 1);
                              showNotice(
                                `Разметка ${selectedElement.fileName} синхронизирована`
                              );
                            }}
                            className="btn pos"
                          >
                            Применить правки .pgr
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="p-10 border border-dashed border-[var(--border)] rounded-lg text-center space-y-2 my-8">
                  <div className="label">NO SELECTION</div>
                  <div className="text-sm text-[var(--ink-muted)]">
                    Выберите элемент в списке слева для просмотра и редактирования
                  </div>
                </div>
              )}
              </div>
            )}
          </div>

          {/* Column 3: Right Attributes & Conflicts/AI (.props-column) */}
          <div
            className={`panel props-column ${
              !rightPanelOpen ? 'collapsed' : ''
            }`}
          >
            <div className="props-column-inner">
              {selectedElement && (
                <div className="sidebar-section">
                  <div className="section-title">
                    <span>Attributes</span>
                    <button
                      type="button"
                      onClick={() => setRightPanelOpen(false)}
                      className="btn p-1.5"
                      title="Свернуть правую панель"
                    >
                      <PanelRightClose size={15} />
                    </button>
                  </div>

                  <div className="stat-line">
                    <span className="stat-label">Type</span>
                    <select
                      value={selectedElement.type}
                      onChange={(e) =>
                        updateElement({
                          ...selectedElement,
                          type: e.target.value as ElementType,
                        })
                      }
                      className="mono bg-transparent border-b border-[var(--border)] cursor-pointer"
                    >
                      <option value="system">Система</option>
                      <option value="class">Класс</option>
                      <option value="process">Процесс-функция</option>
                      <option value="component">Компонент</option>
                      <option value="object">Объект</option>
                      <option value="idea">Идея-образ</option>
                    </select>
                  </div>

                  <div className="stat-line">
                    <span className="stat-label">Parent</span>
                    <span className="mono">
                      {selectedElement.parent && selectedElement.parent !== '-'
                        ? selectedElement.parent
                        : 'None (-)'}
                    </span>
                  </div>

                  <div className="stat-line">
                    <span className="stat-label">Status</span>
                    <span
                      className="pill"
                      style={{
                        color: 'var(--ctx-pos-text)',
                        borderColor: 'var(--ctx-pos-border)',
                      }}
                    >
                      {selectedElement.status}
                    </span>
                  </div>

                  <div className="stat-line">
                    <span className="stat-label">Tag</span>
                    <button
                      type="button"
                      onClick={() =>
                        updateElement({
                          ...selectedElement,
                          mvp: !selectedElement.mvp,
                        })
                      }
                      className="pill cursor-pointer"
                      style={{
                        color: selectedElement.mvp
                          ? 'var(--ctx-pos-text)'
                          : 'var(--ctx-neg-text)',
                        borderColor: selectedElement.mvp
                          ? 'var(--ctx-pos-border)'
                          : 'var(--ctx-neg-border)',
                      }}
                    >
                      {selectedElement.mvp ? 'MVP' : 'Backlog (Потом)'}
                    </button>
                  </div>

                  <div className="stat-line">
                    <span className="stat-label">Has</span>
                    <span className="mono truncate max-w-[170px]">
                      {(selectedElement.components || []).join(', ') || '-'}
                    </span>
                  </div>

                  <div className="stat-line">
                    <span className="stat-label">Used by</span>
                    <span className="mono truncate max-w-[170px]">
                      {usedByIds.join(', ') || '-'}
                    </span>
                  </div>

                  <div className="btn-group">
                    <button
                      type="button"
                      onClick={() => {
                        const res = generateLocalTransformation(
                          selectedElement,
                          'system_pack'
                        );
                        setElements((prev) => [
                          ...prev,
                          ...res.createdElements.filter(
                            (c) => !prev.some((p) => p.id === c.id)
                          ),
                        ]);
                        showNotice(res.summary);
                      }}
                      className="btn flex-1"
                    >
                      Expand
                    </button>

                    {deleteConfirmId !== selectedElement.id ? (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(selectedElement.id)}
                        className="btn neg-outline flex-1"
                      >
                        Delete
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const delId = selectedElement.id;
                            setElements((prev) =>
                              prev.filter((x) => x.id !== delId)
                            );
                            setDeleteConfirmId(null);
                            showNotice(`Элемент ${delId} удалён`);
                          }}
                          className="btn pos flex-1"
                        >
                          {t.confirmYes}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(null)}
                          className="btn neg flex-1"
                        >
                          {t.confirmNo}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Obsidian-style Element Graph Section with Type Icons */}
              <div className="sidebar-section">
                <div className="section-title" style={{ marginBottom: '10px' }}>
                  <span>Graph View</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setMiniGraphMode((m) => (m === 'all' ? 'local' : 'all'))
                      }
                      className="pill cursor-pointer"
                      style={{
                        borderColor:
                          miniGraphMode === 'local'
                            ? 'var(--accent)'
                            : undefined,
                        color:
                          miniGraphMode === 'local'
                            ? 'var(--accent)'
                            : undefined,
                      }}
                      title="Переключить между всеми узлами и локальным окружением выбранного элемента"
                    >
                      {miniGraphMode === 'local' ? 'Локальный' : 'Все'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMiniGraphView({
                          zoom: 100,
                          pan: { x: 0, y: 0 },
                        });
                        setMainGraphView({
                          zoom: 100,
                          pan: { x: 0, y: 0 },
                        });
                      }}
                      className="pill cursor-pointer"
                      title="Сбросить вид графа"
                    >
                      Сброс
                    </button>
                    <button
                      type="button"
                      onClick={() => setKbMainGraphOpen((v) => !v)}
                      className="pill cursor-pointer flex items-center justify-center px-1.5 py-1"
                      style={{
                        borderColor: kbMainGraphOpen
                          ? 'var(--accent)'
                          : undefined,
                        color: kbMainGraphOpen ? 'var(--accent)' : undefined,
                      }}
                      title={
                        kbMainGraphOpen
                          ? 'Вернуть редактор в основную область'
                          : 'Открыть граф в основной области'
                      }
                    >
                      {kbMainGraphOpen ? (
                        <Minimize2 size={11} />
                      ) : (
                        <Maximize2 size={11} />
                      )}
                    </button>
                    {!selectedElement && (
                      <button
                        type="button"
                        onClick={() => setRightPanelOpen(false)}
                        className="btn p-1.5"
                        title="Свернуть правую панель"
                      >
                        <PanelRightClose size={15} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <span className="mono text-[10px] text-[var(--ink-muted)]">
                    Коэф. отдаления
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0.5}
                      max={2.5}
                      step={0.05}
                      value={graphSpread}
                      onChange={(e) =>
                        setGraphSpread(parseFloat(e.target.value))
                      }
                      className="w-24 accent-[var(--accent)] cursor-pointer"
                    />
                    <span className="mono text-[10px] w-8 text-right">
                      {graphSpread.toFixed(2)}x
                    </span>
                  </div>
                </div>

                <div
                  ref={miniGraphRef}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    miniGraphDownClientRef.current = {
                      x: e.clientX,
                      y: e.clientY,
                    };
                    miniGraphDragMovedRef.current = false;
                    setMiniGraphIsPanning(true);
                    setMiniGraphPanStart({
                      x: e.clientX - miniGraphPan.x,
                      y: e.clientY - miniGraphPan.y,
                    });
                  }}
                  onMouseMove={(e) => {
                    if (!miniGraphIsPanning) return;
                    const dist = Math.hypot(
                      e.clientX - miniGraphDownClientRef.current.x,
                      e.clientY - miniGraphDownClientRef.current.y
                    );
                    if (dist > 4) {
                      miniGraphDragMovedRef.current = true;
                    }
                    setMiniGraphView((prev) => ({
                      ...prev,
                      pan: {
                        x: e.clientX - miniGraphPanStart.x,
                        y: e.clientY - miniGraphPanStart.y,
                      },
                    }));
                  }}
                  onMouseUp={() => {
                    setMiniGraphIsPanning(false);
                  }}
                  style={{
                    height: '216px',
                    backgroundColor: 'var(--surface)',
                    backgroundImage:
                      'radial-gradient(var(--border) 1px, transparent 1px)',
                    backgroundSize: '18px 18px',
                    backgroundPosition: `${miniGraphPan.x}px ${miniGraphPan.y}px`,
                    cursor: miniGraphIsPanning ? 'grabbing' : 'grab',
                    overscrollBehavior: 'contain',
                  }}
                  className="relative w-full border border-[var(--border)] rounded overflow-hidden select-none"
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      transform: `translate(${miniGraphPan.x}px, ${miniGraphPan.y}px) scale(${
                        miniGraphZoom / 100
                      })`,
                      transformOrigin: '0 0',
                      width: '292px',
                      height: '216px',
                    }}
                  >
                    <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
                      {miniGraphLayout.activeEdges.map((edge) => {
                        const p1 = miniGraphLayout.posMap[edge.source];
                        const p2 = miniGraphLayout.posMap[edge.target];
                        if (!p1 || !p2) return null;

                        const focusId = hoveredMiniNodeId || selectedId;
                        const isConnectedToFocus =
                          focusId === edge.source || focusId === edge.target;
                        const isDimmed =
                          Boolean(hoveredMiniNodeId) && !isConnectedToFocus;

                        const dash =
                          edge.relation === 'extends'
                            ? '4 3'
                            : edge.relation === 'notes'
                            ? '2 2'
                            : undefined;

                        return (
                          <line
                            key={edge.id}
                            x1={p1.x}
                            y1={p1.y}
                            x2={p2.x}
                            y2={p2.y}
                            stroke={
                              !edge.valid
                                ? 'var(--ctx-neg)'
                                : isConnectedToFocus
                                ? 'var(--accent)'
                                : 'var(--ink-muted)'
                            }
                            strokeWidth={isConnectedToFocus ? 1.5 : 1}
                            strokeDasharray={dash}
                            strokeOpacity={
                              isDimmed ? 0.2 : isConnectedToFocus ? 0.9 : 0.42
                            }
                          />
                        );
                      })}
                    </svg>

                    {miniGraphLayout.nodes.map((el) => {
                      const pos = miniGraphLayout.posMap[el.id];
                      if (!pos) return null;
                      const TypeIcon = ELEMENT_TYPE_ICONS[el.type];
                      const isSelectedNode =
                        selectedId === el.id || aiContextIds.includes(el.id);
                      const isHoveredNode = hoveredMiniNodeId === el.id;
                      const focusId = hoveredMiniNodeId || selectedId;
                      const isNeighborOfFocus =
                        focusId &&
                        miniGraphLayout.activeEdges.some(
                          (e) =>
                            (e.source === focusId && e.target === el.id) ||
                            (e.target === focusId && e.source === el.id)
                        );
                      const isDimmed =
                        Boolean(hoveredMiniNodeId) &&
                        !isHoveredNode &&
                        !isNeighborOfFocus;

                      const isRejectedIdea =
                        el.type === 'idea' &&
                        Boolean(el.altTo && el.altTo !== '-');
                      const nodeBorderColor = isSelectedNode || isHoveredNode
                        ? 'var(--accent)'
                        : isRejectedIdea
                        ? 'var(--ctx-neg-border)'
                        : el.mvp
                        ? 'var(--ctx-pos-border)'
                        : 'var(--border)';
                      const nodeIconColor = isSelectedNode || isHoveredNode
                        ? 'var(--accent)'
                        : isRejectedIdea
                        ? 'var(--ctx-neg-text)'
                        : el.mvp
                        ? 'var(--ctx-pos-text)'
                        : 'var(--ink)';

                      return (
                        <div
                          key={el.id}
                          onMouseEnter={() => setHoveredMiniNodeId(el.id)}
                          onMouseLeave={() => setHoveredMiniNodeId(null)}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (miniGraphDragMovedRef.current) return;
                            handleSelectWithModifiers(
                              el.id,
                              e.ctrlKey || e.metaKey,
                              el.fileName
                            );
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (miniGraphDragMovedRef.current) return;
                            setSelectedId(el.id);
                            setActiveTab('canvas');
                          }}
                          style={{
                            left: `${pos.x}px`,
                            top: `${pos.y}px`,
                            transform: 'translate(-50%, -50%)',
                            opacity: isDimmed ? 0.32 : 1,
                            zIndex:
                              isSelectedNode || isHoveredNode
                                ? 20
                                : isNeighborOfFocus
                                ? 15
                                : 10,
                          }}
                          title={`${el.id} — ${el.title} (двойной клик: открыть на Холсте)`}
                          className="mini-graph-node absolute w-6 h-6 cursor-pointer transition-opacity duration-150"
                        >
                          <div
                            style={{
                              backgroundColor: 'var(--bg)',
                              borderColor: nodeBorderColor,
                              color: nodeIconColor,
                              boxShadow:
                                isSelectedNode || isHoveredNode
                                  ? '0 0 0 1px var(--accent)'
                                  : undefined,
                            }}
                            className="w-6 h-6 rounded border flex items-center justify-center transition-transform duration-150 hover:scale-110"
                          >
                            <TypeIcon size={13} />
                          </div>
                          <div className="absolute left-1/2 top-full -translate-x-1/2 mt-1 flex flex-col items-center pointer-events-none">
                            <span
                              style={{
                                color:
                                  isSelectedNode || isHoveredNode
                                    ? 'var(--ink)'
                                    : 'var(--ink-muted)',
                                backgroundColor: 'var(--surface)',
                              }}
                              className="mono text-[9px] leading-none px-1 py-0.5 rounded max-w-[78px] truncate whitespace-nowrap"
                            >
                              {stripElementPrefix(el.id)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Conflicts & AI Suggestion Section */}
              <div
                className="sidebar-section"
                style={{ background: 'rgba(239, 68, 68, 0.02)' }}
              >
                <div
                  className="section-title"
                  style={{ color: 'var(--ctx-neg-text)' }}
                >
                  <span>Conflicts & AI</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAiModalOpen(true)}
                      className="mono underline cursor-pointer text-[10px]"
                    >
                      Все ({proposals.length + contradictions.length})
                    </button>
                  </div>
                </div>

                {!aiEnabled ? (
                  <div className="mono text-xs">
                    Ручной режим активен (ИИ отключён в Настройках).
                  </div>
                ) : (
                  <>
                    {contradictions.slice(0, 1).map((c) => (
                      <div
                        key={c.id}
                        className="text-xs font-medium"
                        style={{
                          color: 'var(--ctx-neg-text)',
                          marginBottom: '18px',
                        }}
                      >
                        <div style={{ marginBottom: '8px' }}>⚠ {c.title}</div>
                        {c.suggestedFix && (
                          <button
                            type="button"
                            onClick={() => {
                              const { targetElementId, patch } =
                                c.suggestedFix!;
                              setElements((prev) =>
                                prev.map((el) =>
                                  el.id === targetElementId
                                    ? { ...el, ...patch }
                                    : el
                                )
                              );
                              setContradictions((prev) =>
                                prev.filter((x) => x.id !== c.id)
                              );
                              showNotice(
                                `Противоречие в ${targetElementId} исправлено`
                              );
                            }}
                            className="btn py-1 px-2.5 text-[10px]"
                          >
                            Исправить конфликт
                          </button>
                        )}
                      </div>
                    ))}

                    {proposals.slice(0, 1).map((prop) => (
                      <div
                        key={prop.id}
                        className="ai-suggestion"
                        style={{ marginTop: '14px' }}
                      >
                        <div
                          className="label"
                          style={{
                            marginBottom: '8px',
                            color: 'var(--ctx-pos-text)',
                          }}
                        >
                          AI Suggestion
                        </div>
                        <div
                          style={{
                            fontSize: '0.8rem',
                            marginBottom: '14px',
                            lineHeight: 1.5,
                          }}
                        >
                          {prop.title}.{' '}
                          <span className="mono">{prop.rationale}</span>
                        </div>
                        <div className="btn-group">
                          <button
                            type="button"
                            onClick={() => handleApplyProposal(prop)}
                            className="btn pos flex-1"
                          >
                            Apply
                          </button>
                          <button
                            type="button"
                            onClick={() => setRejectProposalModal(prop)}
                            className="btn neg flex-1"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================
          TAB 2: ХОЛСТ (Pan by LMB on empty area, Zoom by wheel, Non-sticking drag)
         ================================================================= */}
      {activeTab === 'canvas' && (
        <div className="workspace-2col">
          <button
            type="button"
            onClick={() => setLeftPanelOpen(true)}
            className={`btn p-1.5 panel-expand-btn left ${
              leftPanelOpen ? 'is-hidden' : ''
            }`}
            title="Развернуть левую панель"
          >
            <PanelLeftOpen size={15} />
          </button>

          {/* Left Controls Column */}
          <div
            className={`panel files-column ${
              !leftPanelOpen ? 'collapsed' : ''
            }`}
          >
            <div className="files-column-inner p-4 space-y-3">
              <div className="section-title">
                <span>Связи</span>
                <button
                  type="button"
                  onClick={() => setLeftPanelOpen(false)}
                  className="btn p-1.5"
                  title="Свернуть левую панель"
                >
                  <PanelLeftClose size={15} />
                </button>
              </div>
              <div className="space-y-1.5 mono text-xs pb-3 border-b border-[var(--border)]">
                {(
                  [
                    'contains',
                    'extends',
                    'has',
                    'instance_of',
                    'uses',
                    'notes',
                  ] as RelationType[]
                ).map((rel) => {
                  const isChecked = visibleRelations[rel];
                  return (
                    <label
                      key={rel}
                      style={{
                        borderColor: isChecked
                          ? 'var(--ctx-pos-border)'
                          : 'var(--border)',
                        backgroundColor: isChecked
                          ? 'var(--ctx-pos-soft)'
                          : 'var(--surface)',
                        color: isChecked
                          ? 'var(--ctx-pos-text)'
                          : 'var(--ink-muted)',
                      }}
                      className="flex items-center gap-2.5 px-2.5 py-1.5 rounded border transition-colors cursor-pointer select-none hover:border-[var(--ink-muted)]"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() =>
                          setVisibleRelations((prev) => ({
                            ...prev,
                            [rel]: !prev[rel],
                          }))
                        }
                        className="sys-checkbox"
                      />
                      <span className="font-medium tracking-tight">{rel}</span>
                    </label>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  const allExpanded =
                    filteredElements.length > 0 &&
                    filteredElements.every((el) => expandedNodeIds[el.id]);
                  if (allExpanded) {
                    setExpandedNodeIds({});
                  } else {
                    const next: Record<string, boolean> = {};
                    filteredElements.forEach((el) => {
                      next[el.id] = true;
                    });
                    setExpandedNodeIds(next);
                  }
                }}
                className="btn w-full"
              >
                {filteredElements.length > 0 &&
                filteredElements.every((el) => expandedNodeIds[el.id])
                  ? 'Свернуть все узлы'
                  : 'Развернуть все узлы'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setCanvasZoom(100);
                  setCanvasPan({ x: 20, y: 20 });
                }}
                className="btn w-full"
              >
                Сброс камеры (100%)
              </button>

              {/* AI Conflict Overlay Controls on Canvas */}
              <div className="pt-3 border-t border-[var(--border)] space-y-2">
                <div
                  className="section-title"
                  style={{
                    color:
                      contradictions.length > 0
                        ? 'var(--ctx-neg-text)'
                        : 'var(--ink-muted)',
                    marginBottom: '8px',
                  }}
                >
                  <span>Конфликты ИИ ({contradictions.length})</span>
                </div>

                <label
                  style={{
                    borderColor:
                      showCanvasConflictOverlay && contradictions.length > 0
                        ? 'var(--ctx-neg-border)'
                        : 'var(--border)',
                    backgroundColor:
                      showCanvasConflictOverlay && contradictions.length > 0
                        ? 'var(--ctx-neg-soft)'
                        : 'var(--surface)',
                    color:
                      showCanvasConflictOverlay && contradictions.length > 0
                        ? 'var(--ctx-neg-text)'
                        : 'var(--ink-muted)',
                  }}
                  className="flex items-center gap-2.5 px-2.5 py-1.5 rounded border transition-colors cursor-pointer select-none mono text-xs"
                >
                  <input
                    type="checkbox"
                    checked={showCanvasConflictOverlay}
                    onChange={(e) =>
                      setShowCanvasConflictOverlay(e.target.checked)
                    }
                    style={
                      showCanvasConflictOverlay
                        ? {
                            backgroundColor: 'var(--ctx-neg)',
                            borderColor: 'var(--ctx-neg-border)',
                          }
                        : undefined
                    }
                    className="sys-checkbox"
                  />
                  <span className="font-medium tracking-tight">
                    Оверлей конфликтов
                  </span>
                </label>

                {showCanvasConflictOverlay && contradictions.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <select
                      value={canvasConflictFilter}
                      onChange={(e) => setCanvasConflictFilter(e.target.value)}
                      className="sys-input w-full mono text-[11px]"
                    >
                      <option value="all">
                        Все конфликты ({contradictions.length})
                      </option>
                      {contradictions.map((c, idx) => (
                        <option key={c.id} value={c.id}>
                          #{idx + 1}: {c.title.slice(0, 26)}...
                        </option>
                      ))}
                    </select>

                    <div className="space-y-1">
                      {contradictions.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => openConflictPopupFor([c], c.elementIds[0])}
                          className="w-full text-left px-2.5 py-1.5 rounded border border-dashed text-[11px] mono transition-colors cursor-pointer hover:opacity-90"
                          style={{
                            borderColor: 'var(--ctx-neg-border)',
                            backgroundColor: 'var(--ctx-neg-soft)',
                            color: 'var(--ctx-neg-text)',
                          }}
                          title="Нажмите, чтобы открыть форму разрешения конфликта"
                        >
                          <div className="font-semibold truncate">
                            ⚠ {c.title}
                          </div>
                          <div className="text-[10px] opacity-80 truncate">
                            {c.elementIds.join(' · ')}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {(ignoredContradictionIds.length > 0 ||
                  rejectedContradictionIds.length > 0) && (
                  <button
                    type="button"
                    onClick={() => {
                      setIgnoredContradictionIds([]);
                      setRejectedContradictionIds([]);
                      setCanvasConflictFilter('all');
                      showNotice('Скрытые и отклонённые конфликты восстановлены');
                    }}
                    className="btn w-full text-[10px]"
                  >
                    Вернуть скрытые (
                    {ignoredContradictionIds.length +
                      rejectedContradictionIds.length}
                    )
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Interactive Canvas Surface */}
          <div className="panel editor-column">
            <div
              ref={canvasAreaRef}
              onContextMenu={(e) => {
                e.preventDefault();
              }}
              onMouseDown={(e) => {
                if ((e.target as HTMLElement).closest('.sys-node')) return;
                if (e.button === 2) {
                  e.preventDefault();
                  e.stopPropagation();
                  const rect = canvasAreaRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  const rawX = e.clientX - rect.left;
                  const rawY = e.clientY - rect.top;
                  const centerX = Math.max(
                    185,
                    Math.min(rect.width - 185, rawX)
                  );
                  const centerY = Math.max(
                    160,
                    Math.min(rect.height - 160, rawY)
                  );
                  setRadialMenu({
                    mode: 'canvas',
                    centerX,
                    centerY,
                    cursorX: rawX,
                    cursorY: rawY,
                    hoveredId: null,
                  });
                  return;
                }
                if (e.button !== 0) return;
                e.preventDefault();
                if (
                  document.activeElement instanceof HTMLElement &&
                  (document.activeElement.tagName === 'INPUT' ||
                    document.activeElement.tagName === 'TEXTAREA' ||
                    document.activeElement.tagName === 'SELECT')
                ) {
                  document.activeElement.blur();
                }
                setRadialMenu(null);
                if (!e.ctrlKey && !e.metaKey) {
                  selectedIdRef.current = null;
                  setSelectedId(null);
                  aiContextIdsRef.current = [];
                  setAiContextIds([]);
                }
                setIsPanningCanvas(true);
                setPanStart({
                  x: e.clientX - canvasPan.x,
                  y: e.clientY - canvasPan.y,
                });
              }}
              onWheel={(e) => {
                e.preventDefault();
                const rect = canvasAreaRef.current?.getBoundingClientRect();
                const delta = e.deltaY < 0 ? 10 : -10;
                const nextZoom = Math.min(
                  200,
                  Math.max(40, canvasZoom + delta)
                );
                if (nextZoom === canvasZoom) return;

                if (rect) {
                  const cursorX = e.clientX - rect.left;
                  const cursorY = e.clientY - rect.top;
                  const oldScale = canvasZoom / 100;
                  const newScale = nextZoom / 100;
                  const worldX = (cursorX - canvasPan.x) / oldScale;
                  const worldY = (cursorY - canvasPan.y) / oldScale;
                  setCanvasPan({
                    x: Math.round(cursorX - worldX * newScale),
                    y: Math.round(cursorY - worldY * newScale),
                  });
                }
                setCanvasZoom(nextZoom);
              }}
              onMouseMove={(e) => {
                const rect = canvasAreaRef.current?.getBoundingClientRect();
                if (!rect) return;

                if (radialMenu) {
                  const cursorX = e.clientX - rect.left;
                  const cursorY = e.clientY - rect.top;
                  const dx = cursorX - radialMenu.centerX;
                  const dy = cursorY - radialMenu.centerY;
                  const dist = Math.hypot(dx, dy);

                  const activeOptions = getRadialOptions(
                    radialMenu.mode,
                    radialMenu.targetElementId
                  );
                  let nextHovered: typeof radialMenu.hoveredId = null;
                  if (dist >= 18) {
                    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
                    let bestDiff = Infinity;
                    for (const opt of activeOptions) {
                      let diff = Math.abs(deg - opt.angleDeg);
                      if (diff > 180) diff = 360 - diff;
                      if (diff < bestDiff) {
                        bestDiff = diff;
                        nextHovered = opt.id;
                      }
                    }
                  }
                  setRadialMenu((prev) =>
                    prev
                      ? {
                          ...prev,
                          cursorX,
                          cursorY,
                          hoveredId: nextHovered,
                        }
                      : null
                  );
                  return;
                }

                if (isPanningCanvas) {
                  setCanvasPan({
                    x: e.clientX - panStart.x,
                    y: e.clientY - panStart.y,
                  });
                  return;
                }

                const scale = canvasZoom / 100;
                const x = (e.clientX - rect.left - canvasPan.x) / scale;
                const y = (e.clientY - rect.top - canvasPan.y) / scale;
                if (connectingFromId) {
                  setMouseCanvasPos({ x, y });
                }
                const activeDragId = draggingNodeIdRef.current || draggingNodeId;
                if (activeDragId) {
                  const downInfo = canvasMouseDownInfoRef.current;
                  if (downInfo && !downInfo.didMove) {
                    const screenDist = Math.hypot(
                      e.clientX - downInfo.clientX,
                      e.clientY - downInfo.clientY
                    );
                    if (screenDist <= 4) {
                      return;
                    }
                    downInfo.didMove = true;
                  }

                  const rawX = x - dragOffset.x;
                  const rawY = y - dragOffset.y;
                  let nx = Math.round(rawX / 10) * 10;
                  let ny = Math.round(rawY / 10) * 10;

                  const currentGroupIds = aiContextIdsRef.current;
                  const moveGroup =
                    currentGroupIds.length > 1 &&
                    currentGroupIds.includes(activeDragId);
                  const movingSet = new Set<string>(
                    moveGroup ? currentGroupIds : [activeDragId]
                  );

                  const SNAP_THRESHOLD = 12;
                  let snappedVerticalX: number | null = null;
                  let snappedHorizontalY: number | null = null;
                  let minDx = SNAP_THRESHOLD + 1;
                  let minDy = SNAP_THRESHOLD + 1;

                  for (const other of filteredElements) {
                    if (movingSet.has(other.id)) continue;
                    const dx = Math.abs(rawX - other.position.x);
                    if (dx <= SNAP_THRESHOLD && dx < minDx) {
                      minDx = dx;
                      nx = other.position.x;
                      snappedVerticalX = other.position.x;
                    }
                    const dy = Math.abs(rawY - other.position.y);
                    if (dy <= SNAP_THRESHOLD && dy < minDy) {
                      minDy = dy;
                      ny = other.position.y;
                      snappedHorizontalY = other.position.y;
                    }
                  }

                  setAlignmentGuides({
                    verticalX: snappedVerticalX,
                    horizontalY: snappedHorizontalY,
                  });

                  const startSnap = dragStartSnapshotRef.current;
                  const dragStartOrigin = startSnap?.[activeDragId];
                  const deltaX = dragStartOrigin ? nx - dragStartOrigin.x : 0;
                  const deltaY = dragStartOrigin ? ny - dragStartOrigin.y : 0;

                  const nextElements = elementsRef.current.map((el) => {
                    if (el.id === activeDragId) {
                      return { ...el, position: { x: nx, y: ny } };
                    }
                    if (
                      moveGroup &&
                      movingSet.has(el.id) &&
                      startSnap?.[el.id]
                    ) {
                      return {
                        ...el,
                        position: {
                          x: Math.round((startSnap[el.id].x + deltaX) / 10) * 10,
                          y: Math.round((startSnap[el.id].y + deltaY) / 10) * 10,
                        },
                      };
                    }
                    return el;
                  });
                  elementsRef.current = nextElements;
                  setElements(nextElements);
                }
              }}
              onMouseUp={() => {
                commitDragSnapshotIfMoved();
                setDraggingNodeId(null);
                setConnectingFromId(null);
                setIsPanningCanvas(false);
                setAlignmentGuides({ verticalX: null, horizontalY: null });
              }}
              style={{
                backgroundPosition: `${canvasPan.x}px ${canvasPan.y}px`,
                cursor: isPanningCanvas ? 'grabbing' : 'grab',
              }}
              className="sys-canvas-area select-none"
            >
              <div
                style={{
                  transform: `translate(${canvasPan.x}px, ${canvasPan.y}px) scale(${canvasZoom / 100})`,
                  transformOrigin: '0 0',
                  width: '2400px',
                  height: '1600px',
                }}
                className="relative"
              >
                <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
                  <defs>
                    <marker
                      id="sys-arrow"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 1 L 9 5 L 0 9 z" fill="context-stroke" />
                    </marker>
                    <marker
                      id="sys-arrow-conflict"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="6.5"
                      markerHeight="6.5"
                      orient="auto-start-reverse"
                    >
                      <path
                        d="M 0 1 L 9 5 L 0 9 z"
                        fill="var(--ctx-neg-text)"
                      />
                    </marker>
                  </defs>

                  {edges
                    .filter((edge) => visibleRelations[edge.relation])
                    .map((edge) => {
                      const src = elements.find((e) => e.id === edge.source);
                      const tgt = elements.find((e) => e.id === edge.target);
                      if (!src || !tgt) return null;

                      const x1 = src.position.x + 85;
                      const y1 = src.position.y + 30;
                      const x2 = tgt.position.x + 85;
                      const y2 = tgt.position.y + 30;

                      const midX = (x1 + x2) / 2;
                      const midY = (y1 + y2) / 2 - 6;

                      const dash =
                        edge.relation === 'extends'
                          ? '6 4'
                          : edge.relation === 'notes'
                          ? '2 3'
                          : undefined;

                      // Check if this edge connects two nodes participating in an active AI contradiction
                      const edgeContradictions =
                        canvasVisibleContradictions.filter((c) => {
                          const involved = new Set([
                            ...c.elementIds,
                            ...(c.suggestedFix?.targetElementId
                              ? [c.suggestedFix.targetElementId]
                              : []),
                          ]);
                          return (
                            involved.has(edge.source) &&
                            involved.has(edge.target)
                          );
                        });
                      const isConflictEdge =
                        !edge.valid || edgeContradictions.length > 0;

                      const isSelectedEdge =
                        selectedId === edge.source ||
                        selectedId === edge.target ||
                        aiContextIds.includes(edge.source) ||
                        aiContextIds.includes(edge.target);

                      const selectedMarkerColor = selectedElement
                        ? selectedElement.customColor ||
                          (selectedElement.type === 'idea' &&
                          selectedElement.altTo &&
                          selectedElement.altTo !== '-'
                            ? 'var(--ctx-neg-text)'
                            : selectedElement.mvp
                            ? 'var(--ctx-pos-text)'
                            : 'var(--ink)')
                        : 'var(--ink-muted)';

                      const labelWidth = Math.max(
                        44,
                        edge.relation.length * 6.4 + 10
                      );

                      return (
                        <g
                          key={edge.id}
                          style={{
                            pointerEvents:
                              edgeContradictions.length > 0 ? 'auto' : 'none',
                            cursor:
                              edgeContradictions.length > 0
                                ? 'pointer'
                                : 'default',
                          }}
                          onMouseDown={(e) => {
                            if (edgeContradictions.length > 0) {
                              e.stopPropagation();
                            }
                          }}
                          onClick={(e) => {
                            if (edgeContradictions.length > 0) {
                              e.stopPropagation();
                              openConflictPopupFor(
                                edgeContradictions,
                                edge.source
                              );
                            }
                          }}
                        >
                          {edgeContradictions.length > 0 && (
                            <line
                              x1={x1}
                              y1={y1}
                              x2={x2}
                              y2={y2}
                              stroke="transparent"
                              strokeWidth={16}
                            />
                          )}
                          <line
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            stroke={
                              isConflictEdge
                                ? 'var(--ctx-neg-text)'
                                : isSelectedEdge
                                ? selectedMarkerColor
                                : 'var(--ink-muted)'
                            }
                            strokeWidth={
                              isConflictEdge ? 2.2 : isSelectedEdge ? 1.8 : 1.2
                            }
                            strokeDasharray={dash}
                            markerEnd={
                              isConflictEdge
                                ? 'url(#sys-arrow-conflict)'
                                : 'url(#sys-arrow)'
                            }
                          />
                          {isConflictEdge && (
                            <rect
                              x={midX - labelWidth / 2}
                              y={midY - 10}
                              width={labelWidth}
                              height={14}
                              rx={2}
                              fill="var(--ctx-neg)"
                              fillOpacity={0.75}
                              stroke="var(--ctx-neg-text)"
                              strokeWidth={0.8}
                            />
                          )}
                          <text
                            x={midX}
                            y={midY}
                            textAnchor="middle"
                            fill={isConflictEdge ? '#ffffff' : 'var(--ink)'}
                            className="mono text-[10px]"
                            style={
                              isConflictEdge
                                ? { fontWeight: 600 }
                                : {
                                    paintOrder: 'stroke',
                                    stroke: 'var(--surface)',
                                    strokeWidth: '4px',
                                  }
                            }
                          >
                            {edge.relation}
                          </text>
                        </g>
                      );
                    })}

                  {alignmentGuides.verticalX !== null && (
                    <line
                      x1={alignmentGuides.verticalX}
                      y1={-1000}
                      x2={alignmentGuides.verticalX}
                      y2={3000}
                      stroke="var(--ctx-pos-text)"
                      strokeWidth={1.2}
                      strokeDasharray="4 4"
                    />
                  )}
                  {alignmentGuides.horizontalY !== null && (
                    <line
                      x1={-1000}
                      y1={alignmentGuides.horizontalY}
                      x2={4000}
                      y2={alignmentGuides.horizontalY}
                      stroke="var(--ctx-pos-text)"
                      strokeWidth={1.2}
                      strokeDasharray="4 4"
                    />
                  )}

                  {connectingFromId &&
                    elements.find((e) => e.id === connectingFromId) && (
                      <line
                        x1={
                          elements.find((e) => e.id === connectingFromId)!
                            .position.x + 150
                        }
                        y1={
                          elements.find((e) => e.id === connectingFromId)!
                            .position.y + 24
                        }
                        x2={mouseCanvasPos.x}
                        y2={mouseCanvasPos.y}
                        stroke="var(--accent)"
                        strokeWidth={2}
                        strokeDasharray="4 3"
                      />
                    )}
                </svg>

                {filteredElements.map((el) => {
                  const isSelected =
                    selectedId === el.id || aiContextIds.includes(el.id);
                  const isNodeExpanded = Boolean(expandedNodeIds[el.id]);
                  const typeHeader = TYPE_HEADERS_RU[el.type].split('-')[0];

                  const nodeContradictions = canvasVisibleContradictions.filter(
                    (c) =>
                      c.elementIds.includes(el.id) ||
                      c.suggestedFix?.targetElementId === el.id
                  );
                  const hasConflictOverlay = nodeContradictions.length > 0;

                  const isRejectedIdea =
                    el.type === 'idea' && Boolean(el.altTo && el.altTo !== '-');
                  const markerColor =
                    el.customColor ||
                    (isRejectedIdea
                      ? 'var(--ctx-neg-text)'
                      : el.mvp
                      ? 'var(--ctx-pos-text)'
                      : undefined);
                  const markerSoft = isRejectedIdea
                    ? 'var(--ctx-neg-soft)'
                    : el.mvp
                    ? 'var(--ctx-pos-soft)'
                    : 'var(--ink-faint)';
                  const activeStrokeColor = markerColor || 'var(--ink-muted)';

                  return (
                    <div
                      key={el.id}
                      onMouseDown={(e) => {
                        if (e.button === 2) {
                          e.stopPropagation();
                          e.preventDefault();
                          setSelectedId(el.id);
                          if (!aiContextIds.includes(el.id)) {
                            setAiContextIds([el.id]);
                          }
                          const rect =
                            canvasAreaRef.current?.getBoundingClientRect();
                          if (!rect) return;
                          const rawX = e.clientX - rect.left;
                          const rawY = e.clientY - rect.top;
                          const centerX = Math.max(
                            185,
                            Math.min(rect.width - 185, rawX)
                          );
                          const centerY = Math.max(
                            160,
                            Math.min(rect.height - 160, rawY)
                          );
                          setRadialMenu({
                            mode: 'node',
                            targetElementId: el.id,
                            centerX,
                            centerY,
                            cursorX: rawX,
                            cursorY: rawY,
                            hoveredId: null,
                          });
                          return;
                        }
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        e.preventDefault();
                        if (
                          document.activeElement instanceof HTMLElement &&
                          (document.activeElement.tagName === 'INPUT' ||
                            document.activeElement.tagName === 'TEXTAREA' ||
                            document.activeElement.tagName === 'SELECT')
                        ) {
                          document.activeElement.blur();
                        }
                        setRadialMenu(null);
                        canvasNodeDownClientRef.current = {
                          x: e.clientX,
                          y: e.clientY,
                        };
                        const wasCtrl = e.ctrlKey || e.metaKey;
                        const currentMulti =
                          aiContextIdsRef.current.length > 0
                            ? aiContextIdsRef.current
                            : selectedIdRef.current
                            ? [selectedIdRef.current]
                            : [];
                        const wasAlreadyInMulti = currentMulti.includes(el.id);

                        if (wasCtrl) {
                          if (!wasAlreadyInMulti) {
                            const nextMulti = [...currentMulti, el.id];
                            aiContextIdsRef.current = nextMulti;
                            setAiContextIds(nextMulti);
                            selectedIdRef.current = el.id;
                            setSelectedId(el.id);
                            setActiveFile(el.fileName);
                          }
                        } else {
                          if (!wasAlreadyInMulti) {
                            selectedIdRef.current = el.id;
                            setSelectedId(el.id);
                            aiContextIdsRef.current = [el.id];
                            setAiContextIds([el.id]);
                          } else {
                            selectedIdRef.current = el.id;
                            setSelectedId(el.id);
                          }
                        }

                        canvasMouseDownInfoRef.current = {
                          nodeId: el.id,
                          fileName: el.fileName,
                          clientX: e.clientX,
                          clientY: e.clientY,
                          wasCtrl,
                          wasAlreadyInMulti,
                          didMove: false,
                        };

                        const rect =
                          canvasAreaRef.current?.getBoundingClientRect();
                        if (!rect) return;
                        const snap: Record<string, { x: number; y: number }> =
                          {};
                        elementsRef.current.forEach((item) => {
                          snap[item.id] = {
                            x: item.position.x,
                            y: item.position.y,
                          };
                        });
                        dragStartSnapshotRef.current = snap;
                        const scale = canvasZoom / 100;
                        const cx =
                          (e.clientX - rect.left - canvasPan.x) / scale;
                        const cy =
                          (e.clientY - rect.top - canvasPan.y) / scale;
                        draggingNodeIdRef.current = el.id;
                        setDraggingNodeId(el.id);
                        setDragOffset({
                          x: cx - el.position.x,
                          y: cy - el.position.y,
                        });
                      }}
                      onMouseUp={(e) => {
                        if (e.button !== 0 || radialMenuRef.current) return;
                        e.stopPropagation();
                        const downInfo = canvasMouseDownInfoRef.current;
                        canvasMouseDownInfoRef.current = null;
                        const moveDist = Math.hypot(
                          e.clientX - canvasNodeDownClientRef.current.x,
                          e.clientY - canvasNodeDownClientRef.current.y
                        );
                        const didDrag = Boolean(downInfo?.didMove) || moveDist > 4;

                        if (connectingFromId && connectingFromId !== el.id) {
                          handleConnectOnCanvas(connectingFromId, el.id);
                        } else if (!didDrag) {
                          if (downInfo?.wasCtrl) {
                            if (downInfo.wasAlreadyInMulti) {
                              const nextMulti = aiContextIdsRef.current.filter(
                                (id) => id !== el.id
                              );
                              aiContextIdsRef.current = nextMulti;
                              setAiContextIds(nextMulti);
                              if (selectedIdRef.current === el.id) {
                                const nextSel =
                                  nextMulti[nextMulti.length - 1] || null;
                                selectedIdRef.current = nextSel;
                                setSelectedId(nextSel);
                              }
                            }
                          } else {
                            selectedIdRef.current = el.id;
                            setSelectedId(el.id);
                            aiContextIdsRef.current = [el.id];
                            setAiContextIds([el.id]);
                            if (
                              hasConflictOverlay &&
                              !(e.target as HTMLElement).closest('button')
                            ) {
                              openConflictPopupFor(nodeContradictions, el.id);
                            }
                          }
                        }
                        commitDragSnapshotIfMoved();
                        setDraggingNodeId(null);
                        setConnectingFromId(null);
                        setIsPanningCanvas(false);
                        setAlignmentGuides({
                          verticalX: null,
                          horizontalY: null,
                        });
                      }}
                      onDoubleClick={() => {
                        setSelectedId(el.id);
                        setActiveTab('kb');
                      }}
                      style={{
                        left: `${el.position.x}px`,
                        top: `${el.position.y}px`,
                        borderColor: isSelected ? activeStrokeColor : undefined,
                        borderLeftWidth: markerColor ? '3px' : undefined,
                        borderLeftColor:
                          markerColor ||
                          (isSelected ? activeStrokeColor : undefined),
                        boxShadow: isSelected
                          ? `0 0 0 1px ${activeStrokeColor}`
                          : undefined,
                        backgroundColor: 'var(--bg)',
                        backgroundImage: isSelected
                          ? `linear-gradient(${markerSoft}, ${markerSoft})`
                          : undefined,
                      }}
                      className={`sys-node ${isSelected ? 'selected' : ''}`}
                    >
                      {/* Negative Contextual Color Dashed Conflict Overlay Frame around Conflicted Node */}
                      {hasConflictOverlay && (
                        <div
                          onMouseDown={(e) => {
                            if (e.button === 2) return;
                            e.stopPropagation();
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            openConflictPopupFor(nodeContradictions, el.id);
                          }}
                          title={`Конфликт ИИ: ${nodeContradictions[0].title} (нажмите для открытия формы конфликта)`}
                          style={{
                            position: 'absolute',
                            inset: '-9px',
                            border: '1.5px dashed var(--ctx-neg-text)',
                            borderRadius: '4px',
                            backgroundColor: 'var(--ctx-neg-soft)',
                            pointerEvents: 'auto',
                            cursor: 'pointer',
                            zIndex: -1,
                          }}
                          className="transition-opacity opacity-85 hover:opacity-100"
                        />
                      )}
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="label">
                          {typeHeader}
                          {el.mvp ? ' · MVP' : ''}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedNodeIds((prev) => ({
                                ...prev,
                                [el.id]: !prev[el.id],
                              }));
                            }}
                            className="pill cursor-pointer hover:border-[var(--ink)] flex items-center justify-center px-1"
                            title={
                              isNodeExpanded
                                ? 'Свернуть компонент'
                                : 'Развернуть компонент'
                            }
                          >
                            {isNodeExpanded ? (
                              <ChevronUp size={11} />
                            ) : (
                              <ChevronDown size={11} />
                            )}
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              const rect =
                                canvasAreaRef.current?.getBoundingClientRect();
                              if (!rect) return;
                              const scale = canvasZoom / 100;
                              setConnectingFromId(el.id);
                              setMouseCanvasPos({
                                x:
                                  (e.clientX - rect.left - canvasPan.x) / scale,
                                y:
                                  (e.clientY - rect.top - canvasPan.y) / scale,
                              });
                            }}
                            className="pill cursor-crosshair hover:border-[var(--ink)]"
                            title="Зажмите и перетащите на другой узел"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      <div
                        className="mono font-semibold text-xs truncate"
                        style={{ color: 'var(--ink)' }}
                      >
                        {el.id}
                      </div>

                      {isNodeExpanded && (
                        <div className="mt-2 pt-2 border-t border-[var(--border)] text-[11px] space-y-1">
                          <div className="font-medium truncate">{el.title}</div>
                          {el.parent && el.parent !== '-' && (
                            <div className="mono">parent: {el.parent}</div>
                          )}
                          {el.type === 'class' &&
                            (el.fields || []).slice(0, 2).map((f) => (
                              <div key={f.name} className="mono">
                                - {f.name}: {f.dataType}
                              </div>
                            ))}
                          {el.type === 'object' &&
                            (el.values || []).slice(0, 2).map((v) => (
                              <div key={v.fieldName} className="mono">
                                {v.fieldName} = {v.value}
                              </div>
                            ))}
                          {el.type === 'component' &&
                            (el.interfaceItems || []).slice(0, 2).map((it, idx) => (
                              <div key={idx} className="mono truncate">
                                + {it}
                              </div>
                            ))}
                          {el.type === 'process' &&
                            (el.steps || []).slice(0, 2).map((st, idx) => (
                              <div key={idx} className="mono truncate">
                                {idx + 1}. {st}
                              </div>
                            ))}
                          {(el.type === 'system' || el.type === 'idea') &&
                            el.description && (
                              <div className="mono line-clamp-2">
                                {el.description}
                              </div>
                            )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Right-Click Hold Radial AI Wheel Overlay (Annular Sector Ring + Dotted Fill + Inner Arrow) */}
              {radialMenu &&
                (() => {
                  const cx = radialMenu.centerX;
                  const cy = radialMenu.centerY;
                  const rIn = 64;
                  const rOut = 162;
                  const rMid = (rIn + rOut) / 2;

                  const dx = radialMenu.cursorX - cx;
                  const dy = radialMenu.cursorY - cy;
                  const dist = Math.hypot(dx, dy);

                  const activeOptions = getRadialOptions(
                    radialMenu.mode,
                    radialMenu.targetElementId
                  );
                  const activeOpt = activeOptions.find(
                    (o) => o.id === radialMenu.hoveredId
                  );
                  const wheelStrokeColor = activeOpt?.isNegative
                    ? 'var(--ctx-neg-text)'
                    : 'var(--ctx-pos-text)';

                  // Arrow angle & tip inside inner circle
                  const arrowAngle =
                    dist >= 8
                      ? Math.atan2(dy, dx)
                      : activeOpt
                      ? (activeOpt.angleDeg * Math.PI) / 180
                      : -Math.PI / 2;
                  const arrowLen =
                    dist >= 8
                      ? Math.min(rIn - 14, Math.max(24, dist * 0.72))
                      : 0;
                  const tipX = cx + Math.cos(arrowAngle) * arrowLen;
                  const tipY = cy + Math.sin(arrowAngle) * arrowLen;
                  const wingLen = 13;
                  const wingSpread = 0.48;
                  const wing1X =
                    tipX - Math.cos(arrowAngle - wingSpread) * wingLen;
                  const wing1Y =
                    tipY - Math.sin(arrowAngle - wingSpread) * wingLen;
                  const wing2X =
                    tipX - Math.cos(arrowAngle + wingSpread) * wingLen;
                  const wing2Y =
                    tipY - Math.sin(arrowAngle + wingSpread) * wingLen;

                  const buildSectorPath = (
                    startDeg: number,
                    endDeg: number
                  ) => {
                    const sRad = (startDeg * Math.PI) / 180;
                    const eRad = (endDeg * Math.PI) / 180;
                    const x1Out = cx + rOut * Math.cos(sRad);
                    const y1Out = cy + rOut * Math.sin(sRad);
                    const x2Out = cx + rOut * Math.cos(eRad);
                    const y2Out = cy + rOut * Math.sin(eRad);
                    const x2In = cx + rIn * Math.cos(eRad);
                    const y2In = cy + rIn * Math.sin(eRad);
                    const x1In = cx + rIn * Math.cos(sRad);
                    const y1In = cy + rIn * Math.sin(sRad);
                    return [
                      `M ${x1Out} ${y1Out}`,
                      `A ${rOut} ${rOut} 0 0 1 ${x2Out} ${y2Out}`,
                      `L ${x2In} ${y2In}`,
                      `A ${rIn} ${rIn} 0 0 0 ${x1In} ${y1In}`,
                      'Z',
                    ].join(' ');
                  };

                  return (
                    <div
                      className="absolute inset-0 z-40 pointer-events-none select-none"
                      style={{ overflow: 'hidden' }}
                    >
                      <svg className="absolute inset-0 w-full h-full pointer-events-none">
                        <defs>
                          {/* Dotted Halftone Pattern for Positive Contextual Color */}
                          <pattern
                            id="radial-dots-pos"
                            width="5"
                            height="5"
                            patternUnits="userSpaceOnUse"
                          >
                            <rect
                              width="5"
                              height="5"
                              fill="var(--ctx-pos-soft)"
                            />
                            <circle
                              cx="2.5"
                              cy="2.5"
                              r="1.15"
                              fill="var(--ctx-pos-text)"
                              fillOpacity="0.85"
                            />
                          </pattern>
                          {/* Dotted Halftone Pattern for Negative Contextual Color */}
                          <pattern
                            id="radial-dots-neg"
                            width="5"
                            height="5"
                            patternUnits="userSpaceOnUse"
                          >
                            <rect
                              width="5"
                              height="5"
                              fill="var(--ctx-neg-soft)"
                            />
                            <circle
                              cx="2.5"
                              cy="2.5"
                              r="1.15"
                              fill="var(--ctx-neg-text)"
                              fillOpacity="0.85"
                            />
                          </pattern>
                        </defs>

                        {/* Annular Sector Slices */}
                        {activeOptions.map((opt) => {
                          const d = buildSectorPath(opt.startDeg, opt.endDeg);
                          const isHovered = radialMenu.hoveredId === opt.id;
                          const patternFill = opt.isNegative
                            ? 'url(#radial-dots-neg)'
                            : 'url(#radial-dots-pos)';

                          return (
                            <g
                              key={opt.id}
                              style={{
                                pointerEvents: 'auto',
                                cursor: 'pointer',
                              }}
                              onMouseEnter={() =>
                                setRadialMenu((prev) =>
                                  prev ? { ...prev, hoveredId: opt.id } : null
                                )
                              }
                            >
                              {/* Base Dark Sector Surface */}
                              <path
                                d={d}
                                fill="var(--bg)"
                                fillOpacity={0.92}
                                stroke={wheelStrokeColor}
                                strokeWidth={1.5}
                              />
                              {/* Dotted Halftone Fill when Hovered */}
                              {isHovered && (
                                <path
                                  d={d}
                                  fill={patternFill}
                                  stroke={
                                    opt.isNegative
                                      ? 'var(--ctx-neg-text)'
                                      : 'var(--ctx-pos-text)'
                                  }
                                  strokeWidth={2}
                                />
                              )}
                            </g>
                          );
                        })}

                        {/* Inner Hub Circle */}
                        <circle
                          cx={cx}
                          cy={cy}
                          r={rIn}
                          fill="var(--bg)"
                          fillOpacity={0.95}
                          stroke={wheelStrokeColor}
                          strokeWidth={1.6}
                        />

                        {/* Outer Ring Circle */}
                        <circle
                          cx={cx}
                          cy={cy}
                          r={rOut}
                          fill="none"
                          stroke={wheelStrokeColor}
                          strokeWidth={1.6}
                        />

                        {/* Center Pivot Dot */}
                        <circle
                          cx={cx}
                          cy={cy}
                          r={3}
                          fill={wheelStrokeColor}
                        />

                        {/* Directional Pointer Arrow inside Inner Circle */}
                        {arrowLen > 0 && (
                          <g>
                            <line
                              x1={cx}
                              y1={cy}
                              x2={tipX}
                              y2={tipY}
                              stroke={wheelStrokeColor}
                              strokeWidth={2.8}
                              strokeLinecap="round"
                            />
                            <path
                              d={`M ${wing1X} ${wing1Y} L ${tipX} ${tipY} L ${wing2X} ${wing2Y}`}
                              fill="none"
                              stroke={wheelStrokeColor}
                              strokeWidth={2.8}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </g>
                        )}
                      </svg>

                      {/* Sector Text Labels inside each Wedge */}
                      {activeOptions.map((opt) => {
                        const rad = (opt.angleDeg * Math.PI) / 180;
                        const lx = cx + Math.cos(rad) * rMid;
                        const ly = cy + Math.sin(rad) * rMid;
                        const isHovered = radialMenu.hoveredId === opt.id;

                        return (
                          <div
                            key={opt.id}
                            style={{
                              left: `${lx}px`,
                              top: `${ly}px`,
                              maxWidth: '92px',
                              transform: 'translate(-50%, -50%)',
                              backgroundColor: isHovered
                                ? 'var(--bg)'
                                : 'transparent',
                              borderColor: isHovered
                                ? opt.isNegative
                                  ? 'var(--ctx-neg-text)'
                                  : 'var(--ctx-pos-text)'
                                : 'transparent',
                            }}
                            className={`absolute px-1 py-0.5 rounded pointer-events-none text-center transition-transform duration-75 ${
                              isHovered ? 'border scale-105' : ''
                            }`}
                          >
                            <div
                              style={{
                                color: isHovered
                                  ? opt.isNegative
                                    ? 'var(--ctx-neg-text)'
                                    : 'var(--ctx-pos-text)'
                                  : 'var(--ink)',
                                textShadow: '0 1px 3px rgba(0,0,0,0.85)',
                              }}
                              className="text-[10.5px] font-semibold leading-tight truncate"
                            >
                              {opt.label}
                            </div>
                            <div
                              style={{
                                color: isHovered
                                  ? 'var(--ink)'
                                  : 'var(--ink-muted)',
                                textShadow: '0 1px 2px rgba(0,0,0,0.85)',
                              }}
                              className="mono text-[9px] leading-tight truncate"
                            >
                              {opt.sublabel}
                            </div>
                          </div>
                        );
                      })}

                      {/* Subtle Center Context Badge & Hint inside Inner Hub */}
                      {radialMenu.mode === 'node' &&
                        radialMenu.targetElementId && (
                          <div
                            style={{
                              left: `${cx}px`,
                              top: `${cy - 18}px`,
                              transform: 'translate(-50%, -50%)',
                              color: 'var(--ctx-pos-text)',
                            }}
                            className="absolute mono text-[9px] font-semibold tracking-tight pointer-events-none truncate max-w-[94px]"
                          >
                            {radialMenu.targetElementId}
                          </div>
                        )}
                      {arrowLen === 0 && (
                        <div
                          style={{
                            left: `${cx}px`,
                            top: `${cy + 20}px`,
                            transform: 'translate(-50%, -50%)',
                            color: 'var(--ink-muted)',
                          }}
                          className="absolute mono text-[9px] uppercase tracking-wider pointer-events-none"
                        >
                          НАВЕДИТЕ
                        </div>
                      )}
                    </div>
                  );
                })()}
            </div>
          </div>
        </div>
      )}

      {/* =================================================================
          TAB 3: БИБЛИОТЕКА ЮНИТОВ
         ================================================================= */}
      {activeTab === 'library' && (
        <div className="workspace-2col">
          <button
            type="button"
            onClick={() => setLeftPanelOpen(true)}
            className={`btn p-1.5 panel-expand-btn left ${
              leftPanelOpen ? 'is-hidden' : ''
            }`}
            title="Развернуть левую панель"
          >
            <PanelLeftOpen size={15} />
          </button>

          <div
            className={`panel files-column ${
              !leftPanelOpen ? 'collapsed' : ''
            }`}
          >
            <div className="files-column-inner">
              <div className="p-3 border-b border-[var(--border)] shrink-0 flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="Поиск по библиотеке..."
                  value={libSearch}
                  onChange={(e) => setLibSearch(e.target.value)}
                  className="sys-input flex-1 min-w-0 text-xs"
                />
                <button
                  type="button"
                  onClick={() => setLeftPanelOpen(false)}
                  className="btn p-1.5 shrink-0"
                  title="Свернуть левую панель"
                >
                  <PanelLeftClose size={15} />
                </button>
              </div>
              <div className="panel-header">
                <span className="label">{t.categoriesHeader}</span>
              </div>
              <div className="p-3 space-y-1">
                {(
                  [
                    { key: 'all', label: 'Все юниты' },
                    { key: 'system', label: 'Системы' },
                    { key: 'class', label: 'Классы' },
                    { key: 'component', label: 'Компоненты' },
                    { key: 'process', label: 'Процессы' },
                    { key: 'object', label: 'Объекты' },
                    { key: 'idea', label: 'Идеи' },
                  ] as { key: 'all' | ElementType; label: string }[]
                ).map((cat) => (
                  <div
                    key={cat.key}
                    onClick={() => setLibCategoryFilter(cat.key)}
                    className={`tree-node ${
                      libCategoryFilter === cat.key ? 'active' : ''
                    }`}
                  >
                    <span>{cat.label}</span>
                  </div>
                ))}
              </div>

              <div className="panel-header mt-2">
                <span className="label">Перетащите в библиотеку</span>
              </div>
              <div className="p-3 flex-1 overflow-y-auto space-y-1">
                {elements.map((el) => (
                  <div
                    key={el.id}
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData('text/plain', el.id)
                    }
                    className="tree-node"
                  >
                    <span className="mono truncate">{el.id}</span>
                    <span className="pill">drag</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="panel editor-column">
            <div
              className="editor-scroll"
              style={{ paddingLeft: leftPanelOpen ? '24px' : '52px' }}
            >
              <div className="editor-meta">
                <span className="label">REUSABLE ARCHITECTURE UNITS</span>
                <span className="pill">Юнитов: {unitLibrary.length}</span>
              </div>
              <div className="title-display" style={{ fontSize: '2rem' }}>
                Библиотека юнитов
              </div>

              <div className="field-grid">
                {unitLibrary
                  .filter((u) => {
                    if (
                      libCategoryFilter !== 'all' &&
                      u.element.type !== libCategoryFilter
                    ) {
                      return false;
                    }
                    if (libSearch.trim()) {
                      const q = libSearch.toLowerCase();
                      return (
                        u.element.title.toLowerCase().includes(q) ||
                        u.element.id.toLowerCase().includes(q)
                      );
                    }
                    return true;
                  })
                  .map((unit) => (
                    <div
                      key={unit.unitId}
                      className="field-row items-center"
                      style={{ gridTemplateColumns: '1fr 1fr auto' }}
                    >
                      <div>
                        <div className="font-semibold text-sm">
                          {unit.element.title}
                        </div>
                        <div className="mono text-xs">{unit.element.id}</div>
                      </div>
                      <div className="mono">{unit.category}</div>
                      <button
                        type="button"
                        onClick={() => handleAddUnitToProject(unit)}
                        className="btn primary"
                      >
                        Добавить в проект
                      </button>
                    </div>
                  ))}
              </div>

              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const raw = e.dataTransfer.getData('text/plain');
                  if (!raw) return;
                  let ids: string[] = [raw];
                  try {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) ids = parsed;
                  } catch {
                    ids = [raw];
                  }
                  ids.forEach((id) => {
                    const found = elements.find((x) => x.id === id);
                    if (found) {
                      handleSaveCurrentToLibrary(found);
                    }
                  });
                }}
                className="mt-6 p-8 border border-dashed border-[var(--border)] rounded text-center mono"
              >
                Перетащите элемент сюда, чтобы сохранить его в библиотеку
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================
          TAB 4: НАСТРОЙКИ (With visual buttons for contextual color pairs)
         ================================================================= */}
      {activeTab === 'settings' && (
        <div className="workspace-2col">
          <button
            type="button"
            onClick={() => setLeftPanelOpen(true)}
            className={`btn p-1.5 panel-expand-btn left ${
              leftPanelOpen ? 'is-hidden' : ''
            }`}
            title="Развернуть левую панель"
          >
            <PanelLeftOpen size={15} />
          </button>

          <div
            className={`panel files-column ${
              !leftPanelOpen ? 'collapsed' : ''
            }`}
          >
            <div className="files-column-inner">
              <div className="panel-header">
                <span className="label">{t.sectionsHeader}</span>
                <button
                  type="button"
                  onClick={() => setLeftPanelOpen(false)}
                  className="btn p-1.5"
                  title="Свернуть левую панель"
                >
                  <PanelLeftClose size={15} />
                </button>
              </div>
              <div className="p-3 space-y-1">
                {[
                  { id: 'theme', label: 'Тема оформления' },
                  { id: 'colors', label: 'Контекстные цвета' },
                  { id: 'ai', label: 'ИИ-ассистент (API)' },
                  { id: 'git', label: 'Git-версионирование' },
                  { id: 'lang', label: 'Язык интерфейса' },
                ].map((sec) => (
                  <div
                    key={sec.id}
                    onClick={() => setActiveSettingsSection(sec.id)}
                    className={`tree-node ${
                      activeSettingsSection === sec.id ? 'active' : ''
                    }`}
                  >
                    <span>{sec.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="panel editor-column">
            <div
              className="editor-scroll"
              style={{ paddingLeft: leftPanelOpen ? '24px' : '52px' }}
            >
              <div className="editor-meta">
                <span className="label">SYSTEM CONFIGURATION</span>
              </div>
              <div className="title-display" style={{ fontSize: '2rem' }}>
                Настройки
              </div>

              <div className="field-grid">
                {/* 1. Theme */}
                <div className="field-row">
                  <div className="field-label">Тема оформления</div>
                  <div className="field-value space-y-2">
                    <div className="flex flex-wrap items-center gap-2.5">
                      {(
                        [
                          {
                            key: 'dark',
                            label: 'Тёмная (по умолчанию)',
                          },
                          {
                            key: 'classic',
                            label: 'Классическая',
                          },
                          { key: 'light', label: 'Светлая' },
                          { key: 'system', label: 'Системная' },
                        ] as { key: ThemeMode; label: string }[]
                      ).map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => setThemeMode(opt.key)}
                          className={`btn ${
                            themeMode === opt.key ? 'primary' : ''
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div className="mono text-[11px]">
                      {themeMode === 'classic'
                        ? 'Классическая: строгая чёрно-белая палитра (#000 / #FFF) с контекстными цветами для положительных и отрицательных элементов.'
                        : themeMode === 'dark'
                        ? 'Тёмная (System Dark): тема по умолчанию с глубоким фоном #0C0C0E и акцентной подсветкой.'
                        : themeMode === 'light'
                        ? 'Светлая: мягкая светлая палитра с акцентной подсветкой.'
                        : 'Системная: автоматически следует настройкам ОС.'}
                    </div>
                  </div>
                </div>

                {/* 2. Visual Contextual Color Buttons */}
                <div className="field-row">
                  <div className="field-label">
                    Положительный контекст («Да», Применить)
                  </div>
                  <div className="field-value flex flex-wrap gap-2">
                    {(
                      Object.keys(POSITIVE_PALETTES) as PositivePaletteKey[]
                    ).map((key) => {
                      const pal = POSITIVE_PALETTES[key];
                      const isActive = posPalette === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setPosPalette(key)}
                          className="btn"
                          style={{
                            borderColor: isActive ? pal.main : 'var(--border)',
                            backgroundColor: isActive
                              ? pal.soft
                              : 'transparent',
                          }}
                        >
                          <span
                            className="w-3 h-3 rounded-sm inline-block"
                            style={{ backgroundColor: pal.main }}
                          />
                          <span>{pal.labelRu}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="field-row">
                  <div className="field-label">
                    Отрицательный контекст («Нет», Отклонить)
                  </div>
                  <div className="field-value flex flex-wrap gap-2">
                    {(
                      Object.keys(NEGATIVE_PALETTES) as NegativePaletteKey[]
                    ).map((key) => {
                      const pal = NEGATIVE_PALETTES[key];
                      const isActive = negPalette === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setNegPalette(key)}
                          className="btn"
                          style={{
                            borderColor: isActive ? pal.main : 'var(--border)',
                            backgroundColor: isActive
                              ? pal.soft
                              : 'transparent',
                          }}
                        >
                          <span
                            className="w-3 h-3 rounded-sm inline-block"
                            style={{ backgroundColor: pal.main }}
                          />
                          <span>{pal.labelRu}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="field-row">
                  <div className="field-label">Предпросмотр пары</div>
                  <div className="field-value flex items-center gap-3">
                    <span className="btn pos">Да · Применить</span>
                    <span className="btn neg">Нет · Отклонить</span>
                  </div>
                </div>

                {/* 3. AI Assistant */}
                <div className="field-row">
                  <div className="field-label">ИИ-ассистент</div>
                  <div className="field-value space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="mono">Endpoint:</span>
                      <input
                        type="text"
                        value={aiEndpoint}
                        onChange={(e) => setAiEndpoint(e.target.value)}
                        className="sys-input flex-1 mono"
                      />
                    </div>
                    <label className="inline-flex items-center gap-2 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={aiEnabled}
                        onChange={(e) => setAiEnabled(e.target.checked)}
                      />
                      <span>
                        Включить ИИ-функции (опционально, приложение работает и в ручном режиме)
                      </span>
                    </label>
                  </div>
                </div>

                {/* 4. Git Versioning */}
                <div className="field-row">
                  <div className="field-label">Git-версионирование</div>
                  <div className="field-value space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="inline-flex items-center gap-2 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={gitEnabled}
                          onChange={(e) => setGitEnabled(e.target.checked)}
                        />
                        <span>
                          Подключить git к проекту (ветка: main, изменений:{' '}
                          {uncommittedChanges})
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setGitHistoryOpen((v) => !v)}
                        className="btn"
                      >
                        {gitHistoryOpen
                          ? 'Скрыть историю изменений'
                          : 'Открыть историю изменений'}
                      </button>
                    </div>

                    {gitHistoryOpen && (
                      <div className="space-y-3 pt-2 border-t border-[var(--border)]">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Сообщение коммита (.pgr diff)..."
                            value={commitMsgInput}
                            onChange={(e) => setCommitMsgInput(e.target.value)}
                            className="sys-input flex-1"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const hash = Math.random()
                                .toString(16)
                                .slice(2, 9);
                              const newCommit: GitCommit = {
                                id: `commit_${Date.now()}`,
                                hash,
                                message:
                                  commitMsgInput.trim() ||
                                  'Обновление структуры плана (.pgr)',
                                timestamp: new Date()
                                  .toISOString()
                                  .slice(0, 16)
                                  .replace('T', ' '),
                                author: 'main',
                                filesSnapshot: createSnapshotMap(
                                  elements,
                                  files
                                ),
                                elementsSnapshot: JSON.parse(
                                  JSON.stringify(elements)
                                ),
                              };
                              setCommits((prev) => [newCommit, ...prev]);
                              setCommitMsgInput('');
                              setUncommittedChanges(0);
                              showNotice(`Зафиксирован коммит #${hash}`);
                            }}
                            className="btn pos"
                          >
                            Закоммитить .pgr
                          </button>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="label">Дифф файла:</span>
                          {files.map((f) => (
                            <button
                              key={f}
                              type="button"
                              onClick={() => setDiffFileSelect(f)}
                              className="pill cursor-pointer"
                              style={{
                                borderColor:
                                  diffFileSelect === f
                                    ? 'var(--accent)'
                                    : undefined,
                                color:
                                  diffFileSelect === f
                                    ? 'var(--accent)'
                                    : undefined,
                              }}
                            >
                              {f}
                            </button>
                          ))}
                        </div>

                        <div className="p-3 border border-[var(--border)] rounded bg-[var(--bg)] max-h-48 overflow-y-auto mono text-xs">
                          {computeLineDiff(
                            commits[0]?.filesSnapshot[diffFileSelect] || '',
                            serializeFileWithRanges(elements, diffFileSelect)
                              .content
                          ).map((dl, idx) => (
                            <div
                              key={idx}
                              className="px-1"
                              style={{
                                backgroundColor:
                                  dl.type === 'added'
                                    ? 'var(--ctx-pos-soft)'
                                    : dl.type === 'removed'
                                    ? 'var(--ctx-neg-soft)'
                                    : 'transparent',
                                color:
                                  dl.type === 'added'
                                    ? 'var(--ctx-pos-text)'
                                    : dl.type === 'removed'
                                    ? 'var(--ctx-neg-text)'
                                    : 'var(--ink-muted)',
                              }}
                            >
                              {dl.type === 'added'
                                ? '+ '
                                : dl.type === 'removed'
                                ? '- '
                                : '  '}
                              {dl.content}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 5. Language */}
                <div className="field-row">
                  <div className="field-label">Язык интерфейса</div>
                  <div className="field-value flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setLocale('ru')}
                      className={`btn ${locale === 'ru' ? 'primary' : ''}`}
                    >
                      Русский (по умолчанию)
                    </button>
                    <button
                      type="button"
                      onClick={() => setLocale('en')}
                      className={`btn ${locale === 'en' ? 'primary' : ''}`}
                    >
                      English
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================
          FOOTER STATUSBAR (Variation 5 System Dark)
         ================================================================= */}
      <footer className="sys-footer">
        <div className="flex items-center gap-5">
          <span
            onClick={() => {
              setActiveTab('settings');
              setActiveSettingsSection('git');
              setGitHistoryOpen(true);
            }}
            className="cursor-pointer hover:text-[var(--ink)]"
          >
            BRANCH: MAIN
          </span>
          <span>MODIFIED: {uncommittedChanges} CHANGES</span>
          {statusNotice && (
            <span style={{ color: 'var(--ctx-pos-text)' }}>
              ● {statusNotice}
            </span>
          )}
        </div>

        <div className="flex items-center gap-5">
          {activeTab === 'canvas' && (
            <div className="flex items-center gap-2">
              <span>ZOOM: {canvasZoom}%</span>
              <button
                type="button"
                onClick={() => setCanvasZoom((z) => Math.max(40, z - 10))}
                className="pill cursor-pointer"
              >
                -
              </button>
              <button
                type="button"
                onClick={() => setCanvasZoom((z) => Math.min(200, z + 10))}
                className="pill cursor-pointer"
              >
                +
              </button>
            </div>
          )}
          <span>
            КОНТЕКСТ ИИ (CTRL+ЛКМ):{' '}
            {aiContextIds.length > 0 ? aiContextIds.length : 'ВЕСЬ ПРОЕКТ'}
          </span>
          <span>
            INDEX: {filteredElements.length}/{elements.length}
          </span>
        </div>
      </footer>

      {/* =================================================================
          MODAL: ИИ-ассистент (Полное окно предложений, противоречий, интервью, преобразования и RAG)
         ================================================================= */}
      {aiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-4xl max-h-[86vh] flex flex-col border border-[var(--border)] rounded-lg bg-[var(--surface)] overflow-hidden">
            <div className="panel-header">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="label" style={{ color: 'var(--accent)' }}>
                  AI ASSISTANT · ПРОАКТИВНЫЙ АНАЛИЗ И ИНТЕРВЬЮ
                </span>
                <span className="pill">
                  Контекст (Ctrl+ЛКМ):{' '}
                  {aiContextIds.length > 0
                    ? aiContextIds.join(', ')
                    : 'Весь проект'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setAiModalOpen(false)}
                className="btn py-1 px-2.5"
              >
                Закрыть
              </button>
            </div>

            {/* Section Filter Tabs inside AI Modal */}
            <div className="px-6 py-2.5 border-b border-[var(--border)] bg-[var(--bg)] flex items-center gap-2 flex-wrap">
              {(
                [
                  { id: 'all', label: 'Все разделы' },
                  {
                    id: 'contradictions',
                    label: `Противоречия (${contradictions.length})`,
                  },
                  {
                    id: 'proposals',
                    label: `Предложения (${proposals.length})`,
                  },
                  {
                    id: 'interview',
                    label: `Интервью (${interviewQuestions.length})`,
                  },
                  { id: 'transform', label: 'Преобразовать' },
                ] as {
                  id:
                    | 'all'
                    | 'contradictions'
                    | 'proposals'
                    | 'interview'
                    | 'transform';
                  label: string;
                }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setAiModalSection(tab.id)}
                  className={`btn py-1 px-2.5 text-[11px] ${
                    aiModalSection === tab.id ? 'primary' : ''
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {(aiModalSection === 'all' ||
                aiModalSection === 'contradictions') && (
                <div>
                  <div className="section-title">
                    <span>Противоречия ({contradictions.length})</span>
                  </div>
                  <div className="space-y-2">
                    {contradictions.map((c) => (
                      <div
                        key={c.id}
                        className="p-3 border border-[var(--border)] rounded bg-[var(--bg)] flex items-center justify-between gap-4"
                      >
                        <div className="space-y-1">
                          <div
                            className="text-xs font-semibold"
                            style={{ color: 'var(--ctx-neg-text)' }}
                          >
                            ⚠ {c.title}
                          </div>
                          <div className="mono">{c.description}</div>
                        </div>
                        {c.suggestedFix && (
                          <button
                            type="button"
                            onClick={() => {
                              const { targetElementId, patch } =
                                c.suggestedFix!;
                              setElements((prev) =>
                                prev.map((el) =>
                                  el.id === targetElementId
                                    ? { ...el, ...patch }
                                    : el
                                )
                              );
                              setContradictions((prev) =>
                                prev.filter((x) => x.id !== c.id)
                              );
                              showNotice(c.suggestedFix!.fixLabel);
                            }}
                            className="btn pos shrink-0"
                          >
                            Исправить
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(aiModalSection === 'all' || aiModalSection === 'proposals') && (
                <div>
                  <div className="section-title">
                    <span>Карточки-предложения ({proposals.length})</span>
                  </div>
                  <div className="space-y-2">
                    {proposals.map((prop) => (
                      <div
                        key={prop.id}
                        className="p-3 border border-[var(--border)] rounded bg-[var(--bg)] flex items-center justify-between gap-4"
                      >
                        <div className="space-y-1">
                          <div className="text-xs font-semibold">
                            {prop.title}
                          </div>
                          <div className="mono">{prop.rationale}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleApplyProposal(prop)}
                            className="btn pos"
                          >
                            Применить
                          </button>
                          <button
                            type="button"
                            onClick={() => setRejectProposalModal(prop)}
                            className="btn neg"
                          >
                            Отклонить
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(aiModalSection === 'all' || aiModalSection === 'interview') && (
                <div>
                  <div className="section-title">
                    <span>Проблемное интервью</span>
                  </div>
                  <div className="space-y-2">
                    {interviewQuestions.map((q) => (
                      <div
                        key={q.id}
                        className="p-3 border border-[var(--border)] rounded bg-[var(--bg)] space-y-2"
                      >
                        <div className="text-xs font-semibold">
                          {q.question}
                        </div>
                        <div className="mono">{q.weakSpotContext}</div>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {q.quickOptions.map((opt, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                if (q.targetElementId) {
                                  setElements((prev) =>
                                    prev.map((el) =>
                                      el.id === q.targetElementId
                                        ? {
                                            ...el,
                                            description: `${el.description} [Правило: ${opt}]`,
                                          }
                                        : el
                                    )
                                  );
                                }
                                showNotice(
                                  `Ответ записан в ${q.targetElementId}`
                                );
                              }}
                              className="btn"
                            >
                              → {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(aiModalSection === 'all' || aiModalSection === 'transform') && (
                <div>
                  <div className="section-title">
                    <span>Преобразование элемента в систему блоков</span>
                  </div>
                  <div className="p-4 border border-[var(--border)] rounded bg-[var(--bg)] space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="label block mb-1">
                          Исходный элемент плана
                        </label>
                        <select
                          value={transformSourceId}
                          onChange={(e) => setTransformSourceId(e.target.value)}
                          className="sys-input w-full mono"
                        >
                          {elements.map((el) => (
                            <option key={el.id} value={el.id}>
                              {el.id} — {el.title}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="label block mb-1">
                          Шаблон развёртывания
                        </label>
                        <select
                          value={transformPattern}
                          onChange={(e) =>
                            setTransformPattern(
                              e.target.value as
                                | 'system_pack'
                                | 'class_hierarchy'
                                | 'process_chain'
                            )
                          }
                          className="sys-input w-full"
                        >
                          <option value="system_pack">
                            Система + Компонент + Класс
                          </option>
                          <option value="class_hierarchy">
                            Класс + эталонный Объект (instance_of)
                          </option>
                          <option value="process_chain">
                            Пошаговая Процесс-функция взаимодействия
                          </option>
                        </select>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const src =
                          elements.find((e) => e.id === transformSourceId) ||
                          elements[0];
                        if (!src) return;
                        const res = generateLocalTransformation(
                          src,
                          transformPattern
                        );
                        setElements((prev) => {
                          const existingIds = new Set(prev.map((x) => x.id));
                          const fresh = res.createdElements.filter(
                            (x) => !existingIds.has(x.id)
                          );
                          return [...prev, ...fresh];
                        });
                        setUncommittedChanges((c) => c + 1);
                        setTransformSummary(res.summary);
                        showNotice(res.summary);
                      }}
                      className="btn pos"
                    >
                      Развернуть и добавить на Холст
                    </button>
                    {transformSummary && (
                      <div
                        style={{
                          borderColor: 'var(--ctx-pos-border)',
                          backgroundColor: 'var(--ctx-pos-soft)',
                          color: 'var(--ctx-pos-text)',
                        }}
                        className="p-2.5 rounded border mono text-xs"
                      >
                        {transformSummary}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =================================================================
          MODAL: Canvas AI Conflict Resolution Popup (Принять / Отклонить / Игнорировать)
         ================================================================= */}
      {activeConflictPopup &&
        activeConflictPopup.contradictions[activeConflictPopup.activeIndex] && (
          <div
            onClick={() => setActiveConflictPopup(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
          >
            {(() => {
              const currentConflict =
                activeConflictPopup.contradictions[
                  activeConflictPopup.activeIndex
                ];
              return (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    borderColor: 'var(--ctx-neg-border)',
                    boxShadow: '0 16px 48px rgba(0, 0, 0, 0.55)',
                  }}
                  className="w-full max-w-xl border rounded-lg bg-[var(--surface)] overflow-hidden flex flex-col"
                >
                  {/* Popup Header */}
                  <div
                    style={{
                      backgroundColor: 'var(--ctx-neg-soft)',
                      borderColor: 'var(--ctx-neg-border)',
                    }}
                    className="px-5 py-3.5 border-b flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        style={{
                          backgroundColor: 'var(--ctx-neg)',
                          color: '#ffffff',
                        }}
                        className="mono text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wider shrink-0"
                      >
                        КОНФЛИКТ ИИ ·{' '}
                        {currentConflict.severity === 'high'
                          ? 'ВЫСОКИЙ'
                          : 'СРЕДНИЙ'}
                      </span>
                      {activeConflictPopup.triggerElementId && (
                        <span className="mono text-xs truncate">
                          Узел: {activeConflictPopup.triggerElementId}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {activeConflictPopup.contradictions.length > 1 &&
                        activeConflictPopup.contradictions.map((cItem, idx) => (
                          <button
                            key={cItem.id}
                            type="button"
                            onClick={() => selectConflictPopupIndex(idx)}
                            style={{
                              borderColor:
                                activeConflictPopup.activeIndex === idx
                                  ? 'var(--ctx-neg-text)'
                                  : 'var(--border)',
                              backgroundColor:
                                activeConflictPopup.activeIndex === idx
                                  ? 'var(--ctx-neg-soft)'
                                  : 'var(--bg)',
                              color:
                                activeConflictPopup.activeIndex === idx
                                  ? 'var(--ctx-neg-text)'
                                  : 'var(--ink-muted)',
                            }}
                            className="pill cursor-pointer px-2 py-0.5"
                          >
                            #{idx + 1}
                          </button>
                        ))}
                      <button
                        type="button"
                        onClick={() => setActiveConflictPopup(null)}
                        className="btn py-1 px-2.5 text-[11px]"
                      >
                        Закрыть
                      </button>
                    </div>
                  </div>

                  {/* Conflict Form Body */}
                  <div className="p-5 space-y-4 max-h-[76vh] overflow-y-auto">
                    {/* Affected Elements & Citation */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="label">Затронуты:</span>
                        {currentConflict.elementIds.map((eid) => (
                          <button
                            key={eid}
                            type="button"
                            onClick={() => {
                              setSelectedId(eid);
                            }}
                            style={{
                              borderColor: 'var(--ctx-neg-border)',
                              color: 'var(--ctx-neg-text)',
                              backgroundColor: 'var(--ctx-neg-soft)',
                            }}
                            className="pill cursor-pointer hover:opacity-80"
                          >
                            {eid}
                          </button>
                        ))}
                      </div>
                      {currentConflict.fileCitation && (
                        <button
                          type="button"
                          onClick={() => {
                            const match =
                              currentConflict.fileCitation?.match(
                                /^([^:]+):(\d+)-(\d+)$/
                              );
                            if (match) {
                              setActiveFile(match[1]);
                              setLineRangeFilter({
                                start: parseInt(match[2], 10),
                                end: parseInt(match[3], 10),
                              });
                              setKbEditorMode('raw_pgr');
                              setActiveTab('kb');
                              setActiveConflictPopup(null);
                            }
                          }}
                          className="mono text-[11px] underline cursor-pointer"
                          style={{ color: 'var(--ctx-pos-text)' }}
                        >
                          Открыть {currentConflict.fileCitation}
                        </button>
                      )}
                    </div>

                    {/* Conflict Title Input */}
                    <div>
                      <label className="label block mb-1.5">
                        Название конфликта
                      </label>
                      <input
                        type="text"
                        value={conflictFormTitle}
                        onChange={(e) => setConflictFormTitle(e.target.value)}
                        className="sys-input w-full font-medium"
                      />
                    </div>

                    {/* Conflict Description Textarea */}
                    <div>
                      <label className="label block mb-1.5">
                        Описание конфликта
                      </label>
                      <textarea
                        rows={3}
                        value={conflictFormDesc}
                        onChange={(e) => setConflictFormDesc(e.target.value)}
                        className="sys-input w-full leading-relaxed resize-y"
                      />
                    </div>

                    {/* Proposed Fix Form Section */}
                    <div
                      style={{
                        borderColor: 'var(--ctx-pos-border)',
                        backgroundColor: 'var(--ctx-pos-soft)',
                      }}
                      className="p-3.5 rounded border space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="label"
                          style={{ color: 'var(--ctx-pos-text)' }}
                        >
                          Предлагаемое исправление (Патч ИИ)
                        </span>
                        {currentConflict.suggestedFix?.targetElementId && (
                          <span className="mono text-[11px]">
                            Цель:{' '}
                            <strong style={{ color: 'var(--ink)' }}>
                              {currentConflict.suggestedFix.targetElementId}
                            </strong>
                          </span>
                        )}
                      </div>

                      <div>
                        <label className="label block mb-1">
                          Описание исправления / правило
                        </label>
                        <textarea
                          rows={2}
                          value={conflictFormFix}
                          onChange={(e) => setConflictFormFix(e.target.value)}
                          className="sys-input w-full leading-relaxed resize-y"
                        />
                      </div>

                      {currentConflict.suggestedFix && (
                        <div>
                          <label className="label block mb-1">
                            Действие патча ({currentConflict.suggestedFix.fixLabel})
                          </label>
                          <pre className="p-2.5 rounded border border-[var(--border)] bg-[var(--bg)] mono text-[11px] overflow-x-auto">
                            {JSON.stringify(
                              currentConflict.suggestedFix.patch,
                              null,
                              2
                            )}
                          </pre>
                        </div>
                      )}
                    </div>

                    {/* Optional Comment / Rejection Reason */}
                    <div>
                      <label className="label block mb-1.5">
                        Комментарий / причина (при отклонении сохранит в Идеи-образы)
                      </label>
                      <input
                        type="text"
                        placeholder="Опционально: почему отклонено или примечание к решению..."
                        value={conflictFormComment}
                        onChange={(e) => setConflictFormComment(e.target.value)}
                        className="sys-input w-full"
                      />
                    </div>

                    {/* Action Choice: Принять / Отклонить / Игнорировать */}
                    <div className="pt-2 border-t border-[var(--border)] flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={handleAcceptConflictFix}
                        className="btn pos flex-1 py-2.5"
                      >
                        Принять
                      </button>
                      <button
                        type="button"
                        onClick={handleRejectConflict}
                        className="btn neg flex-1 py-2.5"
                      >
                        Отклонить
                      </button>
                      <button
                        type="button"
                        onClick={handleIgnoreConflict}
                        className="btn flex-1 py-2.5"
                      >
                        Игнорировать
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

      {/* =================================================================
          MODAL: Reject Proposal as Idea (with alt_to & alt_reason)
         ================================================================= */}
      {rejectProposalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md border border-[var(--border)] rounded-lg bg-[var(--surface)] p-5 space-y-4">
            <div className="section-title">
              <span>Отклонить предложение в Идею-образ</span>
            </div>
            <div className="mono">
              Будет создана Идея-образ с полями{' '}
              <code>alt_to: {rejectProposalModal.targetElementId || '-'}</code>{' '}
              и <code>alt_reason</code>.
            </div>
            <input
              type="text"
              placeholder="Причина отказа (alt_reason)..."
              value={rejectReasonInput}
              onChange={(e) => setRejectReasonInput(e.target.value)}
              className="sys-input w-full"
            />
            <div className="btn-group">
              <button
                type="button"
                onClick={handleConfirmRejectProposal}
                className="btn pos flex-1"
              >
                {t.confirmYes}
              </button>
              <button
                type="button"
                onClick={() => setRejectProposalModal(null)}
                className="btn neg flex-1"
              >
                {t.confirmNo}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================
          MODAL: Create New Plan Element
         ================================================================= */}
      {newElementModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md border border-[var(--border)] rounded-lg bg-[var(--surface)] p-5 space-y-4">
            <div className="section-title">
              <span>Создать новый элемент плана</span>
            </div>

            <div className="space-y-3">
              <div>
                <div className="label mb-1">Тип элемента</div>
                <select
                  value={newElType}
                  onChange={(e) => setNewElType(e.target.value as ElementType)}
                  className="sys-input w-full"
                >
                  <option value="system">Система (sys_)</option>
                  <option value="class">Класс (cls_)</option>
                  <option value="process">Процесс-функция (proc_)</option>
                  <option value="component">Компонент (cmp_)</option>
                  <option value="object">Объект (obj_)</option>
                  <option value="idea">Идея-образ (idea_)</option>
                </select>
              </div>

              <div>
                <div className="label mb-1">Название</div>
                <input
                  type="text"
                  placeholder="Например: Зелье лечения"
                  value={newElTitle}
                  onChange={(e) => setNewElTitle(e.target.value)}
                  className="sys-input w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="label mb-1">
                    ID ({TYPE_PREFIXES[newElType]}...)
                  </div>
                  <input
                    type="text"
                    placeholder="healing_potion"
                    value={newElSlug}
                    onChange={(e) => setNewElSlug(e.target.value)}
                    className="sys-input w-full mono"
                  />
                </div>
                <div>
                  <div className="label mb-1">Файл .pgr</div>
                  <select
                    value={newElFile}
                    onChange={(e) => setNewElFile(e.target.value)}
                    className="sys-input w-full mono"
                  >
                    {(files.length > 0 ? files : ['sys_inventory.pgr']).map(
                      (f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      )
                    )}
                  </select>
                </div>
              </div>

              {newElType !== 'system' && (
                <div>
                  <div className="label mb-1">Родитель (parent)</div>
                  <select
                    value={newElParent}
                    onChange={(e) => setNewElParent(e.target.value)}
                    className="sys-input w-full mono"
                  >
                    <option value="-">- (без родителя)</option>
                    {elements
                      .filter((x) => x.type === 'system')
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.id}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <label className="inline-flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={newElMvp}
                  onChange={(e) => setNewElMvp(e.target.checked)}
                />
                <span>Метка фазы MVP</span>
              </label>
            </div>

            <div className="btn-group">
              <button
                type="button"
                onClick={handleCreateElement}
                className="btn pos flex-1"
              >
                {t.confirmYes}
              </button>
              <button
                type="button"
                onClick={() => setNewElementModalOpen(false)}
                className="btn neg flex-1"
              >
                {t.confirmNo}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
