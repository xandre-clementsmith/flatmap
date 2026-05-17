import * as d3 from 'd3';
import { REGION_DESCRIPTIONS } from './descriptions.js';
import {
  TRACT_IDS, TRACT_FIBER_TO_KEY, TRACT_COLORS,
  NO_DATA_REASONS, DEFAULT_NO_DATA,
  TRACT_PROJECTION_SITES,
  REGION_KNOWN_AFFERENTS, REGION_KNOWN_EFFERENTS,
  NUCLEUS_TO_ASCENDING, NUCLEUS_TO_MOTOR_CN,
  BAND_TO_TRACT_KEY, TRACT_KEY_TO_BAND,
  PATHWAY_ROUTE, PATHWAY_OPEN_THRESHOLD, TRACT_SVG_IDS,
} from './tracts.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const DATA = {
  regions:      '/data/swanson_regions.json',
  metadata:     '/data/region_metadata.json',
  connectivity: '/data/connectivity_matrix.json',
  leiden:       '/data/networks/leiden.json',
};

const MIN_OPACITY = 0.06;

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function toPolygons(coords) {
  if (!coords) return [];
  const polys = Array.isArray(coords) ? coords : [coords];
  return polys
    .filter(p => p.x && p.x.length)
    .map(p => p.x.map((x, i) => [x, p.y[i]]));
}

function pathFromCoords(coords) {
  return toPolygons(coords)
    .map(pts => 'M' + pts.map(([x, y]) => `${x},${y}`).join('L') + 'Z')
    .join(' ');
}

function buildMaps(sparseConnections) {
  const injMap = {}, projMap = {};
  for (const conn of sparseConnections) {
    const inj  = conn.injection_structure_id;
    const proj = conn.projection_structure_id;
    (injMap[inj]   ??= []).push(conn);
    (projMap[proj] ??= []).push(conn);
  }
  return { injMap, projMap };
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function setActiveButton(activeId, inactiveId) {
  document.getElementById(activeId).classList.add('active');
  document.getElementById(inactiveId).classList.remove('active');
}

function setDescription(text) {
  const section = document.getElementById('description-section');
  if (!text) { section.style.display = 'none'; return; }
  section.style.display = '';
  document.getElementById('description-text').textContent = text;
}

// ─── Description panel toggle (runs at module load) ───────────────────────────

(function initDescriptionToggle() {
  let open   = false;
  const toggle = document.getElementById('description-toggle');
  const body   = document.getElementById('description-body');
  const arrow  = document.getElementById('description-arrow');
  toggle.addEventListener('click', () => {
    open = !open;
    body.classList.toggle('open', open);
    arrow.classList.toggle('open', open);
  });
})();

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {

  // ── Data ──────────────────────────────────────────────────────────────────

  const [regions, metadata, connectivity, leidenData] = await Promise.all([
    fetch(DATA.regions).then(r => r.json()),
    fetch(DATA.metadata).then(r => r.json()),
    fetch(DATA.connectivity).then(r => r.json()),
    fetch(DATA.leiden).then(r => r.json()),
  ]);

  const { injMap: injMapRel, projMap: projMapRel } = buildMaps(connectivity.sparse_connections_relative);
  const { injMap: injMapAbs, projMap: projMapAbs } = buildMaps(connectivity.sparse_connections_absolute);
  const coveredIds = new Set(
    [...Object.keys(injMapRel), ...Object.keys(injMapAbs)].map(Number)
  );

  // ── SVG ───────────────────────────────────────────────────────────────────

  const container = document.getElementById('map-container');
  const svg = d3.select(container).append('svg').attr('width', '100%').attr('height', '100%');
  const g   = svg.append('g');

  // Bounding box — needed to fit the map to the viewport on load.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const region of regions) {
    for (const [x, y] of toPolygons(region.coordsReg).flat()) {
      if (x < minX) minX = x;  if (y < minY) minY = y;
      if (x > maxX) maxX = x;  if (y > maxY) maxY = y;
    }
  }
  const pad = 10, dataW = maxX - minX + pad * 2, dataH = maxY - minY + pad * 2;

  const paths = g.selectAll('path.region')
    .data(regions)
    .join('path')
    .attr('class', d => (d.hole ? 'region hole' : 'region') + (coveredIds.has(d.allenId) ? '' : ' no-data'))
    .attr('d',    d => pathFromCoords(d.coordsReg || []))
    .attr('fill', connFill);

  // ── Zoom & initial fit ────────────────────────────────────────────────────
  // Minimum scale is locked to the fit-to-window value so you can't zoom out past full view.

  const zoom = d3.zoom().on('zoom', e => g.attr('transform', e.transform));
  svg.call(zoom);

  requestAnimationFrame(() => {
    const { width: W, height: H } = container.getBoundingClientRect();
    const fitScale = Math.min(W / dataW, H / dataH);
    const tx = (W - dataW * fitScale) / 2 - (minX - pad) * fitScale;
    const ty = (H - dataH * fitScale) / 2 - (minY - pad) * fitScale;
    zoom.scaleExtent([fitScale, fitScale * 40]);
    svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(fitScale));
  });

  // ── State ─────────────────────────────────────────────────────────────────

  const tooltipEl = document.getElementById('tooltip');

  let selected    = null;
  let mode        = 'efferent';     // 'efferent' | 'afferent'
  let metric      = 'relative';    // 'relative'  | 'absolute'
  let appMode     = 'connectivity'; // 'connectivity' | 'networks'
  let netSelected = null;           // null | Set<commId>

  // ── Connectivity fill ─────────────────────────────────────────────────────
  // Used at initialisation and when restoring from networks mode.

  function connFill(d) {
    if (d.allenId === 16)            return '#000000'; // 6b: laminar marker, always black
    if (!coveredIds.has(d.allenId)) return '#2a2a2a';
    return metadata[d.allenId]?.hexcolor ?? '#3a3a3a';
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────

  function positionTooltip(event) {
    tooltipEl.style.display = 'block';
    tooltipEl.style.left    = (event.pageX + 12) + 'px';
    tooltipEl.style.top     = (event.pageY - 28) + 'px';
  }

  function showConnTooltip(event, d) {
    const meta = metadata[d.allenId] || {};
    tooltipEl.innerHTML = `<strong>${meta.acronym || '?'}</strong> <span class="tt-id">(ID ${d.allenId})</span><br>${meta.name || ''}`;
    positionTooltip(event);
  }

  function showNetTooltip(event, d) {
    const meta  = metadata[d.allenId] || {};
    const cid   = regionToCommIdx[d.allenId];
    const comm  = cid !== undefined ? leidenData.communities[cid] : null;
    const hint  = comm?.hint  ? capitalise(comm.hint)
                : comm        ? `Community ${cid + 1}`
                :               'Unassigned';
    const color = cid !== undefined ? commColors[cid] : '#666';
    const dot   = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;`
                + `background:${color};margin-right:4px;vertical-align:middle"></span>`;
    tooltipEl.innerHTML = `<strong>${meta.acronym || d.allenId}</strong>  ${meta.name || ''}`
                        + `<div class="tt-comm">${dot}${hint}</div>`;
    positionTooltip(event);
  }

  // ── Info panel ────────────────────────────────────────────────────────────

  function makeConnItem({ acronym, id, name, barColor, barWidth = 100, barOpacity = 1, onEnter, onClick }) {
    const item = document.createElement('div');
    item.className = 'connection-item';
    const opacity  = barOpacity < 1 ? `;opacity:${barOpacity}` : '';
    item.innerHTML = `
      <div style="width:100%">
        <div>${acronym || id}</div>
        <div class="connection-bar" style="width:${barWidth}%${barColor ? `;background:${barColor}` : ''}${opacity}"></div>
      </div>`;
    item.addEventListener('mouseenter', onEnter);
    item.addEventListener('mousemove', e => {
      tooltipEl.style.display = 'block';
      tooltipEl.style.left    = (e.pageX + 12) + 'px';
      tooltipEl.style.top     = (e.pageY - 28) + 'px';
      tooltipEl.innerHTML     = `<strong>${acronym || id}</strong><br>${name || ''}`;
    });
    item.addEventListener('mouseleave', () => { tooltipEl.style.display = 'none'; stopGlow(); });
    item.addEventListener('click', onClick);
    return item;
  }

  function showInfo(allenId, conns, curMode, onSelectRegion) {
    const meta = metadata[allenId] || {};
    document.getElementById('region-acronym').textContent = meta.acronym || allenId;
    document.getElementById('region-name').textContent    = meta.name    || '';
    document.getElementById('no-data-reason').style.display = 'none';
    setDescription(REGION_DESCRIPTIONS[allenId] || '');

    const isEff     = curMode === 'efferent';
    const partnerId = isEff ? 'projection_structure_id' : 'injection_structure_id';
    const sorted    = [...conns]
      .filter(c => c[partnerId] !== allenId)
      .sort((a, b) => b.normalized_value - a.normalized_value);
    const localMax  = sorted[0]?.normalized_value || 1;

    const list = document.getElementById('connections-list');
    list.innerHTML = '';
    for (const conn of sorted) {
      if (conn.normalized_value / localMax < 0.02) break;
      const isTract     = TRACT_IDS.has(conn[partnerId]);
      if (isTract && !isEff) continue;
      const partnerMeta = metadata[conn[partnerId]] || {};
      const pct         = Math.round((conn.normalized_value / localMax) * 100);
      const barColor    = isTract ? (TRACT_COLORS[conn[partnerId]] || '#3d9e8a') : null;
      list.appendChild(makeConnItem({
        acronym:  partnerMeta.acronym,
        id:       conn[partnerId],
        name:     partnerMeta.name,
        barColor,
        barWidth: pct,
        onEnter:  () => { if (!isTract) startGlow(conn[partnerId]); },
        onClick:  () => {
          tooltipEl.style.display = 'none';
          stopGlow();
          if (onSelectRegion) onSelectRegion(conn[partnerId]);
        },
      }));
    }
  }

  function showNoDataInfo(meta, reason, allenId = null) {
    document.getElementById('region-acronym').textContent        = meta.acronym || '?';
    document.getElementById('region-name').textContent           = meta.name    || '';
    document.getElementById('no-data-label').textContent         = reason.label;
    document.getElementById('no-data-text').textContent          = reason.text;
    document.getElementById('no-data-reason').style.display      = 'flex';
    document.getElementById('connections-list').innerHTML         = '';
    document.getElementById('known-connections').style.display    = 'none';
    setDescription(allenId != null ? (REGION_DESCRIPTIONS[allenId] || '') : '');
  }

  function clearInfo() {
    document.getElementById('region-acronym').textContent        = '';
    document.getElementById('region-name').textContent           = '';
    document.getElementById('no-data-reason').style.display      = 'none';
    document.getElementById('connections-list').innerHTML         = '';
    document.getElementById('known-connections').style.display    = 'none';
    setDescription('');
  }

  // ── Hover glow ────────────────────────────────────────────────────────────
  // Pulses a glowing stroke on a partner region while hovering a connection item.

  let glowRaf          = null;
  let glowAllenId      = null;
  let glowSavedOpacity = null;

  function startGlow(allenId) {
    if (!allenId || glowAllenId === allenId) return;
    stopGlow();
    glowAllenId      = allenId;
    const node       = paths.filter(d => d.allenId === allenId).node();
    glowSavedOpacity = node?.style.opacity || null;

    const t0 = performance.now(), period = 1300;
    function frame(now) {
      if (glowAllenId !== allenId) return;
      const s = (Math.sin(((now - t0) / period) * 2 * Math.PI) + 1) / 2;
      paths.filter(d => d.allenId === allenId)
        .style('opacity',        '1')
        .style('stroke',         '#fff')
        .style('stroke-width',   `${1.5 + s * 7}px`)
        .style('stroke-opacity', 0.45 + s * 0.55);
      glowRaf = requestAnimationFrame(frame);
    }
    glowRaf = requestAnimationFrame(frame);
  }

  function stopGlow() {
    if (glowRaf !== null) { cancelAnimationFrame(glowRaf); glowRaf = null; }
    if (glowAllenId !== null) {
      paths.filter(d => d.allenId === glowAllenId)
        .style('opacity',        glowSavedOpacity)
        .style('stroke',         null)
        .style('stroke-width',   null)
        .style('stroke-opacity', null);
      glowAllenId = glowSavedOpacity = null;
    }
  }

  // ── Pathway panel ─────────────────────────────────────────────────────────

  const pathwayPanelEl  = document.getElementById('pathway-panel');
  const pathwayToggleEl = document.getElementById('pathway-toggle');
  let pathwayOpen  = true;
  let pathwayDir   = 'aff';     // 'aff' | 'eff'
  let pathwayRoute = 'cranial'; // 'spinal' | 'cranial'
  let suppressPanelSwitch = false; // prevents auto-switch during dot-click navigation

  function openPathwayPanel() {
    if (pathwayOpen) return;
    pathwayOpen = true;
    pathwayPanelEl.classList.remove('collapsed');
    pathwayToggleEl.textContent = '◀';
  }

  function collapsePathwayPanel() {
    if (!pathwayOpen) return;
    pathwayOpen = false;
    pathwayPanelEl.classList.add('collapsed');
    pathwayToggleEl.textContent = '▶';
  }

  function switchToCombo(dir, route) {
    pathwayDir   = dir;
    pathwayRoute = route;
    const combo  = `${dir}-${route}`;
    for (const d of ['aff', 'eff'])
      document.getElementById(`tab-${d}`).classList.toggle('active', d === dir);
    for (const r of ['spinal', 'cranial'])
      document.getElementById(`tab-${r}`).classList.toggle('active', r === route);
    for (const c of ['aff-cranial', 'aff-spinal', 'eff-cranial', 'eff-spinal'])
      document.getElementById(`pwy-${c}`).style.display = c === combo ? '' : 'none';
  }

  function clearPathwayPanel() {
    for (const id of ['tract-cst', 'tract-rust', 'tract-tsp', 'tract-rst', 'tract-vsp']) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.setAttribute('opacity', '0.15');
      el.setAttribute('stroke-width', '2');
    }
  }

  function updatePathwayPanel(allenId, allConnsLocalMax = 1) {
    if (TRACT_IDS.has(allenId)) {
      for (const [tractId, svgId] of Object.entries(TRACT_SVG_IDS)) {
        const el = document.getElementById(svgId);
        if (!el) continue;
        const isSel = Number(tractId) === allenId;
        el.setAttribute('opacity',      isSel ? '1.0' : '0.08');
        el.setAttribute('stroke-width', isSel ? '4'   : '1.5');
      }
      openPathwayPanel();
      switchToCombo('eff', 'spinal');
      return;
    }
    const injMap = metric === 'relative' ? injMapRel : injMapAbs;
    const tractStrengths = {};
    for (const conn of (injMap[allenId] || [])) {
      if (TRACT_IDS.has(conn.projection_structure_id))
        tractStrengths[conn.projection_structure_id] = conn.normalized_value;
    }
    const maxTractVal   = Math.max(0, ...Object.values(tractStrengths));
    const tractLocalMax = maxTractVal || 1;
    if (maxTractVal / allConnsLocalMax >= PATHWAY_OPEN_THRESHOLD) {
      openPathwayPanel();
      switchToCombo('eff', 'spinal');
    }
    for (const [tractId, svgId] of Object.entries(TRACT_SVG_IDS)) {
      const el  = document.getElementById(svgId);
      if (!el) continue;
      const val = tractStrengths[Number(tractId)];
      if (val === undefined) {
        el.setAttribute('opacity',      '0.08');
        el.setAttribute('stroke-width', '1.5');
      } else {
        const t = val / tractLocalMax;
        el.setAttribute('opacity',      (0.12 + t * 0.88).toFixed(2));
        el.setAttribute('stroke-width', (1.5  + t * 4.0 ).toFixed(1));
      }
    }
  }

  // ── Ascending sensory panel ────────────────────────────────────────────────

  function clearAscendingPanel() {
    document.querySelectorAll('.asc-band-visual').forEach(el => {
      el.setAttribute('opacity', '0.15');
      el.setAttribute('stroke-width', '1.5');
    });
    document.querySelectorAll('.asc-dot').forEach(el => {
      const r = el.r?.baseVal?.value ?? 5;
      el.setAttribute('opacity', r > 5 ? '0.55' : r > 4 ? '0.45' : '0.4');
    });
  }

  function updateAscendingPanel(allenId) {
    const pathwayId = NUCLEUS_TO_ASCENDING.get(allenId);
    document.querySelectorAll('.asc-band-visual').forEach(el => {
      const match = el.dataset.pathway === pathwayId;
      el.setAttribute('opacity',      pathwayId ? (match ? '1.0' : '0.05') : '0.15');
      el.setAttribute('stroke-width', match ? '3' : '1.5');
    });
    document.querySelectorAll('.asc-dot').forEach(el => {
      const match  = el.dataset.pathway === pathwayId;
      const isThis = Number(el.dataset.nucleusId) === allenId;
      const r      = el.r?.baseVal?.value ?? 5;
      const base   = r > 5 ? '0.55' : r > 4 ? '0.45' : '0.4';
      el.setAttribute('opacity', pathwayId
        ? (isThis ? '1.0' : match ? '0.65' : '0.1')
        : base);
    });
    if (pathwayId && mode !== 'efferent' && !suppressPanelSwitch) {
      openPathwayPanel();
      switchToCombo('aff', PATHWAY_ROUTE[pathwayId] || 'cranial');
    }
  }

  // ── Motor cranial nerve panel ──────────────────────────────────────────────

  function clearMotorCNPanel() {
    document.querySelectorAll('.motor-cn-band-visual').forEach(el => {
      el.setAttribute('opacity', '0.15');
      el.setAttribute('stroke-width', '1.5');
    });
    document.querySelectorAll('.motor-cn-dot').forEach(el => {
      el.setAttribute('opacity', el.r?.baseVal?.value > 5 ? '0.55' : '0.45');
    });
  }

  function updateMotorCNPanel(allenId) {
    const bandId = NUCLEUS_TO_MOTOR_CN.get(allenId);
    document.querySelectorAll('.motor-cn-band-visual').forEach(el => {
      const match = el.dataset.band === bandId;
      el.setAttribute('opacity',      bandId ? (match ? '1.0' : '0.05') : '0.15');
      el.setAttribute('stroke-width', match ? '3' : '1.5');
    });
    document.querySelectorAll('.motor-cn-dot').forEach(el => {
      const match  = el.dataset.band === bandId;
      const isThis = Number(el.dataset.nucleusId) === allenId;
      el.setAttribute('opacity', bandId
        ? (isThis ? '1.0' : match ? '0.65' : '0.1')
        : (el.r?.baseVal?.value > 5 ? '0.55' : '0.45'));
    });
    if (bandId) { openPathwayPanel(); switchToCombo('eff', 'cranial'); }
  }

  // ── Known connections & tract info ────────────────────────────────────────

  function renderKnownConnections(allenId, curMode) {
    const section  = document.getElementById('known-connections');
    const list     = document.getElementById('known-connections-list');
    const tractIds = curMode === 'efferent'
      ? (REGION_KNOWN_EFFERENTS.get(allenId) || [])
      : (REGION_KNOWN_AFFERENTS.get(allenId) || []);

    if (!tractIds.length) { section.style.display = 'none'; return; }
    section.style.display = '';
    list.innerHTML = '';

    for (const tid of tractIds) {
      const sites = TRACT_PROJECTION_SITES[tid];
      if (!sites) continue;
      const item = document.createElement('div');
      item.className = 'connection-item known-conn-item';
      item.innerHTML = `
        <div style="width:100%">
          <div class="known-conn-name">
            <span class="known-conn-dot" style="background:${sites.color}"></span>${sites.label}
          </div>
          <div class="known-conn-sub">${sites.sub}</div>
          <div class="known-conn-bar" style="width:100%;background:${sites.color}"></div>
        </div>`;
      item.addEventListener('mouseenter', () => { if (sites.primary) startGlow(sites.primary); });
      item.addEventListener('mouseleave', () => stopGlow());
      item.addEventListener('click', e => {
        e.stopPropagation();
        stopGlow();
        openPathwayPanel();
        switchToCombo(sites.dir || 'aff', sites.route || 'cranial');
        if (sites.primary) selectRegion(sites.primary);
      });
      list.appendChild(item);
    }
  }

  // Shows tract/pathway info when a band is clicked directly — lists all projection sites.
  function showTractInfo(tractKey) {
    const sites = TRACT_PROJECTION_SITES[tractKey];
    if (!sites) return;
    paths.interrupt('flash');
    selected = null;

    const isAff     = sites.dir === 'aff';
    const regionIds = isAff ? (sites.afferent_termini || []) : (sites.efferent_origins || []);
    const idSet     = new Set(regionIds);

    // Raise highlighted paths so they win z-order over dimmed overlapping polygons.
    paths
      .classed('dimmed',   false)
      .classed('selected', rd => idSet.has(rd.allenId))
      .style('opacity',        rd => idSet.has(rd.allenId) ? 1 : MIN_OPACITY)
      .style('pointer-events', null)
      .style('stroke-width',   null);
    paths.filter(rd => idSet.has(rd.allenId)).raise();

    clearPathwayPanel(); clearAscendingPanel(); clearMotorCNPanel();

    if (isAff) {
      document.querySelectorAll('.asc-band-visual').forEach(el => {
        const match = el.dataset.pathway === tractKey;
        el.setAttribute('opacity',      match ? '1.0' : '0.05');
        el.setAttribute('stroke-width', match ? '3'   : '1.5');
      });
    } else if (sites.route === 'cranial') {
      const bandId = TRACT_KEY_TO_BAND[tractKey];
      document.querySelectorAll('.motor-cn-band-visual').forEach(el => {
        const match = el.dataset.band === bandId;
        el.setAttribute('opacity',      match ? '1.0' : '0.05');
        el.setAttribute('stroke-width', match ? '3'   : '1.5');
      });
    } else {
      const el = document.getElementById(`tract-${tractKey}`);
      if (el) { el.setAttribute('opacity', '1.0'); el.setAttribute('stroke-width', '4'); }
    }

    document.getElementById('region-acronym').textContent      = sites.label;
    document.getElementById('region-name').textContent         = sites.sub;
    document.getElementById('no-data-reason').style.display    = 'none';
    document.getElementById('known-connections').style.display = 'none';
    setDescription('');

    const list = document.getElementById('connections-list');
    list.innerHTML = '';
    for (const rid of regionIds) {
      const meta = metadata[rid] || {};
      list.appendChild(makeConnItem({
        acronym:    meta.acronym,
        id:         rid,
        name:       meta.name,
        barColor:   sites.color,
        barOpacity: 0.7,
        onEnter:    () => startGlow(rid),
        onClick:    () => { stopGlow(); selectRegion(rid); panToRegion(rid); },
      }));
    }
  }

  // ── Connectivity: region selection ────────────────────────────────────────

  function deselect() {
    paths.interrupt('flash');
    paths.classed('dimmed', false).classed('selected', false)
      .style('opacity', null).style('stroke-width', null);
    selected = null;
    clearPathwayPanel(); clearAscendingPanel(); clearMotorCNPanel();
  }

  function selectRegion(allenId) {
    if (TRACT_IDS.has(allenId)) {
      // Tracts with curated projection sites bypass Allen data lookup.
      const tractKey = TRACT_FIBER_TO_KEY[allenId];
      if (tractKey && TRACT_PROJECTION_SITES[tractKey]) {
        showTractInfo(tractKey);
        return;
      }
      const projMap = metric === 'relative' ? projMapRel : projMapAbs;
      if (!projMap[allenId]?.length) {
        deselect();
        showNoDataInfo(metadata[allenId] || {}, NO_DATA_REASONS[allenId] || DEFAULT_NO_DATA, allenId);
        return;
      }
      selected = allenId;
      triggerSelect(allenId);
      return;
    }
    const injMap  = metric === 'relative' ? injMapRel  : injMapAbs;
    const projMap = metric === 'relative' ? projMapRel : projMapAbs;
    const hasData = mode === 'efferent' ? !!injMap[allenId] : !!projMap[allenId];
    if (!hasData) {
      deselect();
      showNoDataInfo(metadata[allenId] || {}, NO_DATA_REASONS[allenId] || DEFAULT_NO_DATA, allenId);
      return;
    }
    selected = allenId;
    triggerSelect(allenId);
  }

  // Smooth-pans to a region's centroid at the current zoom level.
  // Used for panel-click navigation; map-clicks don't need it.
  function panToRegion(allenId) {
    const region = regions.find(r => r.allenId === allenId);
    if (!region) return;
    const allPts = toPolygons(region.coordsReg).flat();
    if (!allPts.length) return;
    const cx = allPts.reduce((s, [x])   => s + x, 0) / allPts.length;
    const cy = allPts.reduce((s, [, y]) => s + y, 0) / allPts.length;
    const { width: W, height: H } = container.getBoundingClientRect();
    const k = d3.zoomTransform(svg.node()).k;
    svg.transition().duration(450)
      .call(zoom.transform, d3.zoomIdentity.translate(W / 2 - k * cx, H / 2 - k * cy).scale(k));
  }

  // Pulses the selected region's stroke width (5 → 2.5 px) to draw the eye to it.
  function flashSelectedRegion(allenId) {
    const sel = paths.filter(rd => rd.allenId === allenId);
    sel.raise();
    sel.transition('flash').duration(700).ease(d3.easeCubicOut)
      .styleTween('stroke-width', () => {
        const interp = d3.interpolateNumber(5, 2.5);
        return t => `${interp(t)}px`;
      });
  }

  function triggerSelect(allenId) {
    const isTractSel = TRACT_IDS.has(allenId);
    const isEff      = !isTractSel && mode === 'efferent';
    const injMap     = metric === 'relative' ? injMapRel  : injMapAbs;
    const projMap    = metric === 'relative' ? projMapRel : projMapAbs;
    const partnerId  = isEff ? 'projection_structure_id' : 'injection_structure_id';

    // For afferents in relative mode, re-normalise each source by its own peak efferent
    // so the framing is symmetric: "fraction of X's total output reaching Y" in both directions.
    let conns = isEff ? (injMap[allenId] || []) : (projMap[allenId] || []);
    if (!isEff && !isTractSel && metric === 'relative') {
      conns = conns.map(conn => {
        const srcMax = (injMapRel[conn.injection_structure_id] || [])
          .reduce((m, c) => Math.max(m, c.normalized_value), 0) || 1;
        return { ...conn, normalized_value: conn.normalized_value / srcMax };
      });
    }

    const relevant    = conns.filter(c => c[partnerId] !== allenId);
    const localMax    = relevant.reduce((m, c) => Math.max(m, c.normalized_value), 0) || 1;
    const strengthMap = Object.fromEntries(
      relevant.map(c => [c[partnerId], c.normalized_value / localMax])
    );

    paths
      .classed('dimmed',   false)
      .classed('selected', rd => !isTractSel && rd.allenId === allenId)
      .style('opacity', rd => {
        if (!isTractSel && rd.allenId === allenId) return 1;
        const s = strengthMap[rd.allenId];
        return s !== undefined ? Math.max(MIN_OPACITY, s) : MIN_OPACITY;
      });

    paths.interrupt('flash');
    if (!isTractSel) flashSelectedRegion(allenId);

    // Tracts are always shown as afferent sources regardless of the UI toggle.
    const effectiveMode = isTractSel ? 'afferent' : mode;
    showInfo(allenId, conns, effectiveMode, newId => { selectRegion(newId); panToRegion(newId); });
    renderKnownConnections(allenId, effectiveMode);
    updatePathwayPanel(allenId, localMax);
    updateAscendingPanel(allenId);
    updateMotorCNPanel(allenId);
  }

  // ── Networks mode ─────────────────────────────────────────────────────────

  const NET_PALETTE = [
    '#5b90d9', '#5cba80', '#e89040', '#c068b8', '#d8c040',
    '#e04888', '#b8e078', '#f0b0c8', '#b85c38', '#48a890',
    '#7868c8', '#c09040', '#48c0c0', '#7ec8f4', '#a8c840',
    '#b06040', '#7848c0', '#40b880', '#d84840', '#50a0d0',
    '#c0c840', '#7880d0', '#d08038', '#40a8b0', '#c05878',
    '#88c458', '#c07868', '#6868c0', '#98c0e0', '#d0b858',
  ];

  // Editorial taxonomy — group nodes have `children`, leaf nodes have `hint`.
  const NET_HIERARCHY = [
    { group: 'Sensory', children: [
      { hint: 'visual' },
      { group: 'AUDITORY', children: [
        { hint: 'auditory-forebrain' },
        { hint: 'auditory-brainstem' },
      ]},
    ]},
    { group: 'Homeostasis', children: [
      { hint: 'medullary' },
      { hint: 'hypothalamic' },
      { hint: 'Arousal' },
    ]},
    { group: 'Limbic', children: [
      { hint: 'limbic-sensory' },
      { hint: 'limbic-motor' },
      { group: 'MEMORY', children: [
        { hint: 'Memory-episodic' },
        { hint: 'Memory-papez' },
      ]},
      { hint: 'limbic-brainstem' },
    ]},
    { group: 'Motor', children: [
      { hint: 'cerebellar' },
      { hint: 'sensorimotor' },
    ]},
  ];

  const unmeasuredSet   = new Set(leidenData.unmeasured_region_ids || []);
  const regionToCommIdx = Object.fromEntries(
    Object.entries(leidenData.region_assignments).map(([k, v]) => [+k, v])
  );
  const commColors = leidenData.communities.map(c => NET_PALETTE[c.color_id % NET_PALETTE.length]);

  function capitalise(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  // Returns all community IDs reachable from a hierarchy node.
  function nodeCommIds(node, hintToComm) {
    if (node.hint !== undefined) {
      const c = hintToComm[node.hint];
      return c ? [c.id] : [];
    }
    return node.children.flatMap(ch => nodeCommIds(ch, hintToComm));
  }

  function netApplyColors() {
    paths
      .attr('fill', d => {
        if (unmeasuredSet.has(d.allenId)) return '#111';
        const cid = regionToCommIdx[d.allenId];
        return cid !== undefined ? commColors[cid] : '#2a2a2a';
      })
      .classed('net-dimmed', d => {
        if (!netSelected || unmeasuredSet.has(d.allenId)) return false;
        const cid = regionToCommIdx[d.allenId];
        return cid === undefined || !netSelected.has(cid);
      });
  }

  function netSelect(ids) {
    netSelected = ids === null        ? null
                : typeof ids === 'number' ? new Set([ids])
                : ids;
    netApplyColors();
    document.querySelectorAll('.comm-item[data-comm-id]').forEach(el => {
      el.classList.toggle('active', !!netSelected?.has(+el.dataset.commId));
    });
    document.querySelectorAll('.net-group-btn[data-group-ids]').forEach(el => {
      const gids   = JSON.parse(el.dataset.groupIds);
      const active = !!netSelected && gids.every(id => netSelected.has(id));
      el.classList.toggle('active', active);
    });
  }

  function buildCommList() {
    const list = document.getElementById('comm-list');
    document.getElementById('net-count').textContent = leidenData.communities.length;
    list.innerHTML = '';

    const hintToComm = Object.fromEntries(
      leidenData.communities.filter(c => c.hint).map(c => [c.hint, c])
    );

    function renderNode(node, depth) {
      const indent = `${14 + depth * 12}px`;

      if (node.hint !== undefined) {
        const comm = hintToComm[node.hint];
        if (!comm) return;
        const el = document.createElement('div');
        el.className         = 'comm-item';
        el.dataset.commId    = comm.id;
        el.style.paddingLeft = indent;
        el.title             = comm.acronyms.join(', ');
        el.innerHTML = `
          <div class="comm-dot" style="background:${commColors[comm.id]}"></div>
          <div class="comm-body">
            <div class="comm-name">${capitalise(comm.hint)}</div>
            <div class="comm-meta">${comm.size} region${comm.size !== 1 ? 's' : ''}</div>
          </div>`;
        el.addEventListener('click', () => {
          netSelect(netSelected?.size === 1 && netSelected.has(comm.id) ? null : comm.id);
        });
        list.appendChild(el);
      } else {
        const groupIds = nodeCommIds(node, hintToComm);
        const el = document.createElement('div');
        el.className         = `${depth === 0 ? 'net-section' : 'net-subgroup'} net-group-btn`;
        el.style.paddingLeft = indent;
        el.dataset.groupIds  = JSON.stringify(groupIds);
        el.textContent       = node.group;
        el.addEventListener('click', () => {
          const s       = new Set(groupIds);
          const already = netSelected && groupIds.every(id => netSelected.has(id));
          netSelect(already ? null : s);
        });
        list.appendChild(el);
        for (const child of node.children) renderNode(child, depth + 1);
      }
    }

    for (const top of NET_HIERARCHY) renderNode(top, 0);
  }

  function enterNetworksMode() {
    appMode = 'networks';
    stopGlow();
    deselect();
    clearInfo();
    document.getElementById('pathway-wrapper').style.display = 'none';
    document.getElementById('conn-view').style.display       = 'none';
    document.getElementById('net-view').style.display        = '';
    paths.style('stroke', '#1a1a1a').style('stroke-width', '0.5px').style('stroke-opacity', null);
    netSelect(null);
    buildCommList();
  }

  function exitNetworksMode() {
    appMode     = 'connectivity';
    netSelected = null;
    document.getElementById('pathway-wrapper').style.display = '';
    document.getElementById('conn-view').style.display       = '';
    document.getElementById('net-view').style.display        = 'none';
    paths
      .classed('net-dimmed', false)
      .style('stroke', null).style('stroke-width', null).style('stroke-opacity', null)
      .attr('fill', connFill);
  }

  function setAppMode(newMode) {
    if (appMode === newMode) return;
    document.getElementById('btn-connectivity').classList.toggle('active', newMode === 'connectivity');
    document.getElementById('btn-networks').classList.toggle('active', newMode === 'networks');
    newMode === 'networks' ? enterNetworksMode() : exitNetworksMode();
  }

  // ── Event wiring ──────────────────────────────────────────────────────────

  // SVG region events — single handlers dispatching on appMode.
  paths.on('mousemove', (event, d) => {
    appMode === 'networks' ? showNetTooltip(event, d) : showConnTooltip(event, d);
  });
  paths.on('mouseleave', () => { tooltipEl.style.display = 'none'; });
  paths.on('click', (event, d) => {
    if (event.defaultPrevented) return; // ignore drag-end clicks
    if (appMode === 'networks') {
      event.stopPropagation();
      const cid = regionToCommIdx[d.allenId];
      if (cid !== undefined)
        netSelect(netSelected?.size === 1 && netSelected.has(cid) ? null : cid);
    } else {
      stopGlow();
      selectRegion(d.allenId);
      if (isMobileLayout()) openMobilePanel();
    }
  });
  svg.on('click', event => {
    if (event.defaultPrevented) return;
    if (event.target.tagName === 'svg' || event.target.tagName === 'g') {
      deselect(); clearInfo();
      if (appMode === 'networks') netSelect(null);
      if (isMobileLayout()) closeMobilePanel();
    }
  });

  // App mode toggle
  document.getElementById('btn-connectivity').addEventListener('click', () => setAppMode('connectivity'));
  document.getElementById('btn-networks').addEventListener('click',     () => setAppMode('networks'));

  // Connectivity: direction + metric
  document.getElementById('btn-efferent').addEventListener('click', () => {
    mode = 'efferent'; setActiveButton('btn-efferent', 'btn-afferent');
    if (selected !== null) triggerSelect(selected);
  });
  document.getElementById('btn-afferent').addEventListener('click', () => {
    mode = 'afferent'; setActiveButton('btn-afferent', 'btn-efferent');
    if (selected !== null) triggerSelect(selected);
  });
  document.getElementById('btn-relative').addEventListener('click', () => {
    metric = 'relative'; setActiveButton('btn-relative', 'btn-absolute');
    if (selected !== null) triggerSelect(selected);
  });
  document.getElementById('btn-absolute').addEventListener('click', () => {
    metric = 'absolute'; setActiveButton('btn-absolute', 'btn-relative');
    if (selected !== null) triggerSelect(selected);
  });

  // Pathway panel: collapse/expand + mode tabs
  document.getElementById('pathway-tab').addEventListener('click', () => {
    pathwayOpen ? collapsePathwayPanel() : openPathwayPanel();
  });
  document.getElementById('tab-aff').addEventListener('click',     () => switchToCombo('aff', pathwayRoute));
  document.getElementById('tab-eff').addEventListener('click',     () => switchToCombo('eff', pathwayRoute));
  document.getElementById('tab-spinal').addEventListener('click',  () => switchToCombo(pathwayDir, 'spinal'));
  document.getElementById('tab-cranial').addEventListener('click', () => switchToCombo(pathwayDir, 'cranial'));

  // Ascending pathway: nucleus dots + band hit areas
  document.querySelectorAll('.asc-dot').forEach(dot => {
    dot.addEventListener('click', e => {
      e.stopPropagation();
      const navMode = dot.dataset.navMode || 'afferent';
      mode = navMode;
      setActiveButton(
        navMode === 'afferent' ? 'btn-afferent' : 'btn-efferent',
        navMode === 'afferent' ? 'btn-efferent' : 'btn-afferent',
      );
      suppressPanelSwitch = true;
      selectRegion(Number(dot.dataset.nucleusId));
      suppressPanelSwitch = false;
    });
  });
  document.querySelectorAll('.asc-band-hit').forEach(band => {
    const pathwayId = band.dataset.pathway;
    if (pathwayId) band.addEventListener('click', e => { e.stopPropagation(); showTractInfo(pathwayId); });
  });

  // Motor CN: nucleus dots + band hit areas
  document.querySelectorAll('.motor-cn-dot').forEach(dot => {
    dot.addEventListener('click', e => { e.stopPropagation(); selectRegion(Number(dot.dataset.nucleusId)); });
  });
  document.querySelectorAll('.motor-cn-band-hit').forEach(band => {
    const tractKey = BAND_TO_TRACT_KEY[band.dataset.band];
    if (tractKey) band.addEventListener('click', e => { e.stopPropagation(); showTractInfo(tractKey); });
  });

  // Descending tracts: band hit areas + origin dots
  document.querySelectorAll('.tract-band-hit').forEach(hit => {
    hit.addEventListener('click', e => { e.stopPropagation(); selectRegion(Number(hit.dataset.tractId)); });
  });
  document.querySelectorAll('.pwy-origin-dot[data-has-data="true"]').forEach(dot => {
    dot.addEventListener('click', e => {
      e.stopPropagation();
      const tractKey = dot.dataset.tractKey;
      if (tractKey) showTractInfo(tractKey);
      else selectRegion(Number(dot.dataset.tractId));
    });
  });

  // About modal
  const infoModal   = document.getElementById('info-modal');
  const infoTabs    = document.querySelectorAll('.info-tab');
  const infoSections = document.querySelectorAll('.info-section');

  function openInfoModal() { infoModal.classList.add('open'); }
  function closeInfoModal() { infoModal.classList.remove('open'); }

  document.getElementById('btn-info').addEventListener('click', openInfoModal);
  document.getElementById('info-modal-close').addEventListener('click', closeInfoModal);
  document.getElementById('info-modal-backdrop').addEventListener('click', closeInfoModal);

  infoTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      infoTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      infoSections.forEach(s => { s.style.display = s.id === `info-tab-${tab.dataset.tab}` ? '' : 'none'; });
    });
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeInfoModal(); });

  // Mobile drawers
  const mobilePanelBtn = document.getElementById('mobile-panel-btn');
  const mobilePathBtn  = document.getElementById('mobile-path-btn');
  const infoEl         = document.getElementById('info-panel');
  const pathPanelEl    = document.getElementById('pathway-panel');

  function isMobileLayout() { return window.matchMedia('(max-width: 680px)').matches; }

  function openMobilePanel() {
    pathPanelEl.classList.remove('mobile-open'); mobilePathBtn.textContent = 'Pathways ▲';
    infoEl.classList.add('mobile-open');         mobilePanelBtn.textContent = 'Map ▼';
  }
  function closeMobilePanel() {
    infoEl.classList.remove('mobile-open'); mobilePanelBtn.textContent = 'Info ▲';
  }
  function openMobilePathway() {
    infoEl.classList.remove('mobile-open');      mobilePanelBtn.textContent = 'Info ▲';
    pathPanelEl.classList.add('mobile-open');    mobilePathBtn.textContent = 'Map ▼';
  }
  function closeMobilePathway() {
    pathPanelEl.classList.remove('mobile-open'); mobilePathBtn.textContent = 'Pathways ▲';
  }

  mobilePanelBtn.addEventListener('click', () => {
    infoEl.classList.contains('mobile-open') ? closeMobilePanel() : openMobilePanel();
  });
  mobilePathBtn.addEventListener('click', () => {
    pathPanelEl.classList.contains('mobile-open') ? closeMobilePathway() : openMobilePathway();
  });
}

main().catch(err => {
  console.error('Flatmap initialization failed:', err);
  const el = document.getElementById('map-container');
  if (el) el.innerHTML = '<p style="padding:2rem;color:#888">Failed to load map data. See browser console for details.</p>';
});
