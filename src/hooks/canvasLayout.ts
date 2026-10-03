import type { PlanElement } from '../types/planager';
import { buildAndValidateGraph } from '../utils/pgrCodec';

export function stripElementPrefix(id: string): string {
  return id.replace(/^(sys|cls|obj|cmp|proc|idea)_/, '');
}

// Shared topology-aware layout generator that keeps tightly coupled nodes in the core
// and pushes peripheral radicals / secondary sub-clusters (like join_faction -> factions + reputation_bound) outward
export function computeClusteredGraphPositions(
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
export function applyCanvasAutoLayout(
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

type KbContextMenuTarget =
  | { type: 'file'; fileName: string }
  | { type: 'element'; elementId: string; fileName: string }
  | { type: 'folder'; folderName: string }
  | { type: 'empty' };

interface KbContextMenuState {
  x: number;
  y: number;
  target: KbContextMenuTarget;
}

