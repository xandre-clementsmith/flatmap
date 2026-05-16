import * as d3 from 'd3';
import { REGION_DESCRIPTIONS } from './descriptions.js';
import {
  TRACT_IDS, TRACT_FIBER_TO_KEY, TRACT_COLORS,
  NO_DATA_REASONS, DEFAULT_NO_DATA,
  TRACT_PROJECTION_SITES,
  REGION_KNOWN_AFFERENTS, REGION_KNOWN_EFFERENTS,
  ASCENDING_PATHWAYS, NUCLEUS_TO_ASCENDING,
  NUCLEUS_TO_MOTOR_CN, BAND_TO_TRACT_KEY, TRACT_KEY_TO_BAND,
  PATHWAY_ROUTE, PATHWAY_OPEN_THRESHOLD, TRACT_SVG_IDS,
} from './tracts.js';

// ─── Data endpoints ───────────────────────────────────────────────────────────

const DATA = {
  regions:      '/data/swanson_regions.json',
  metadata:     '/data/region_metadata.json',
  connectivity: '/data/connectivity_matrix.json',
};

// ─── Geometry utilities ───────────────────────────────────────────────────────

const MIN_OPACITY = 0.06;

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

// ─── Glow stubs ───────────────────────────────────────────────────────────────
// Assigned inside main() once the D3 paths selection exists.
// Declared here so top-level functions (showInfo, etc.) can call them.

let startGlow = () => {};
let stopGlow  = () => {};

// ─── Description panel ────────────────────────────────────────────────────────

let _descOpen = false;

function setDescription(text) {
  const section = document.getElementById('description-section');
  if (!text) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  document.getElementById('description-text').textContent = text;
}

(function initDescriptionToggle() {
  const toggle = document.getElementById('description-toggle');
  const body   = document.getElementById('description-body');
  const arrow  = document.getElementById('description-arrow');
  toggle.addEventListener('click', () => {
    _descOpen = !_descOpen;
    body.classList.toggle('open', _descOpen);
    arrow.classList.toggle('open', _descOpen);
  });
})();

// ─── UI helpers ───────────────────────────────────────────────────────────────

function setActiveButton(activeId, inactiveId) {
  document.getElementById(activeId).classList.add('active');
  document.getElementById(inactiveId).classList.remove('active');
}

// Shared tooltip element — created once on page load.
const tooltipEl = document.getElementById('tooltip');

// Build a single connection list item with hover glow, tooltip, and click nav.
function makeConnItem({ acronym, id, name, barColor, barWidth = 100, barOpacity = 1, onEnter, onClick }) {
  const item = document.createElement('div');
  item.className = 'connection-item';
  const opacity = barOpacity < 1 ? `;opacity:${barOpacity}` : '';
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
    tooltipEl.innerHTML = `<strong>${acronym || id}</strong><br>${name || ''}`;
  });
  item.addEventListener('mouseleave', () => { tooltipEl.style.display = 'none'; stopGlow(); });
  item.addEventListener('click', onClick);
  return item;
}

function showInfo(allenId, conns, metadata, mode, onSelectRegion = null) {
  const meta = metadata[allenId] || {};
  document.getElementById('region-acronym').textContent = meta.acronym || allenId;
  document.getElementById('region-name').textContent    = meta.name    || '';
  document.getElementById('no-data-reason').style.display = 'none';
  setDescription(REGION_DESCRIPTIONS[allenId] || '');

  const isEff     = mode === 'efferent';
  const partnerId = isEff ? 'projection_structure_id' : 'injection_structure_id';

  const sorted   = [...conns].filter(c => c[partnerId] !== allenId)
                              .sort((a, b) => b.normalized_value - a.normalized_value);
  const localMax = sorted[0]?.normalized_value || 1;

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
      onClick:  () => { tooltipEl.style.display = 'none'; stopGlow(); if (onSelectRegion) onSelectRegion(conn[partnerId]); },
    }));
  }
}

function showNoDataInfo(meta, reason, allenId = null) {
  document.getElementById('region-acronym').textContent = meta.acronym || '?';
  document.getElementById('region-name').textContent    = meta.name    || '';
  document.getElementById('no-data-label').textContent  = reason.label;
  document.getElementById('no-data-text').textContent   = reason.text;
  document.getElementById('no-data-reason').style.display = 'flex';
  document.getElementById('connections-list').innerHTML = '';
  document.getElementById('known-connections').style.display = 'none';
  setDescription(allenId != null ? (REGION_DESCRIPTIONS[allenId] || '') : '');
}

function clearInfo() {
  document.getElementById('region-acronym').textContent = '';
  document.getElementById('region-name').textContent    = '';
  document.getElementById('no-data-reason').style.display = 'none';
  document.getElementById('connections-list').innerHTML = '';
  document.getElementById('known-connections').style.display = 'none';
  setDescription('');
}

function clearPathwayPanel() {
  for (const id of ['tract-cst', 'tract-rust', 'tract-tsp', 'tract-rst', 'tract-vsp']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.setAttribute('opacity', '0.15');
    el.setAttribute('stroke-width', '2');
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {

  // ── Load data ──────────────────────────────────────────────────────────────

  const [regions, metadata, connectivity] = await Promise.all([
    fetch(DATA.regions).then(r => r.json()),
    fetch(DATA.metadata).then(r => r.json()),
    fetch(DATA.connectivity).then(r => r.json()),
  ]);

  // Build efferent and afferent lookup maps for both metrics
  const { injMap: injMapRel,  projMap: projMapRel  } = buildMaps(connectivity.sparse_connections_relative);
  const { injMap: injMapAbs,  projMap: projMapAbs  } = buildMaps(connectivity.sparse_connections_absolute);

  function updatePathwayPanel(allenId, allConnsLocalMax = 1) {
    // When a tract is directly selected, highlight just that tract and auto-open.
    if (TRACT_IDS.has(allenId)) {
      for (const [tractId, svgId] of Object.entries(TRACT_SVG_IDS)) {
        const el = document.getElementById(svgId);
        if (!el) continue;
        const isSelected = Number(tractId) === allenId;
        el.setAttribute('opacity', isSelected ? '1.0' : '0.08');
        el.setAttribute('stroke-width', isSelected ? '4' : '1.5');
      }
      openPathwayPanel();
      switchToCombo('eff', 'spinal');
      return;
    }

    const injMap = metric === 'relative' ? injMapRel : injMapAbs;
    const effs   = injMap[allenId] || [];
    const tractStrengths = {};
    for (const conn of effs) {
      if (TRACT_IDS.has(conn.projection_structure_id)) {
        tractStrengths[conn.projection_structure_id] = conn.normalized_value;
      }
    }
    const tractVals   = Object.values(tractStrengths);
    const maxTractVal = tractVals.length ? Math.max(...tractVals) : 0;
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
        el.setAttribute('opacity', '0.08');
        el.setAttribute('stroke-width', '1.5');
      } else {
        const t = val / tractLocalMax;
        el.setAttribute('opacity', (0.12 + t * 0.88).toFixed(2));
        el.setAttribute('stroke-width', (1.5 + t * 4.0).toFixed(1));
      }
    }
  }

  // ── Pathway panel: collapse/expand (rightward) ────────────────────────────
  const pathwayPanelEl  = document.getElementById('pathway-panel');
  const pathwayToggleEl = document.getElementById('pathway-toggle');
  let pathwayOpen = true;

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

  document.getElementById('pathway-tab').addEventListener('click', () => {
    pathwayOpen ? collapsePathwayPanel() : openPathwayPanel();
  });

  // ── Pathway mode tabs: Afferent|Efferent × Spinal|Cranial ────────────────
  let pathwayDir   = 'aff';     // 'aff' | 'eff'
  let pathwayRoute = 'cranial'; // 'spinal' | 'cranial'

  function switchToCombo(dir, route) {
    pathwayDir   = dir;
    pathwayRoute = route;
    const combo  = dir + '-' + route;
    for (const d of ['aff', 'eff']) {
      document.getElementById('tab-' + d).classList.toggle('active', d === dir);
    }
    for (const r of ['spinal', 'cranial']) {
      document.getElementById('tab-' + r).classList.toggle('active', r === route);
    }
    for (const c of ['aff-cranial', 'aff-spinal', 'eff-cranial', 'eff-spinal']) {
      document.getElementById('pwy-' + c).style.display = c === combo ? '' : 'none';
    }
  }

  // Direction buttons preserve current route; route buttons preserve current direction.
  document.getElementById('tab-aff').addEventListener('click',     () => switchToCombo('aff', pathwayRoute));
  document.getElementById('tab-eff').addEventListener('click',     () => switchToCombo('eff', pathwayRoute));
  document.getElementById('tab-spinal').addEventListener('click',  () => switchToCombo(pathwayDir, 'spinal'));
  document.getElementById('tab-cranial').addEventListener('click', () => switchToCombo(pathwayDir, 'cranial'));

  // Set true during dot-click-initiated selectRegion calls so updateAscendingPanel
  // does not hijack the panel away from the panel the user is already viewing.
  let suppressPanelSwitch = false;

  // ── Ascending panel interaction ────────────────────────────────────────────

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
      el.setAttribute('opacity', pathwayId ? (match ? '1.0' : '0.05') : '0.15');
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

  // Ascending nucleus dots → select that region in the anatomically correct mode.
  // data-nav-mode="afferent" for relay nuclei (they receive the pathway);
  // data-nav-mode="efferent" for origin nuclei (they send the pathway).
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

  // Ascending band hit areas → show tract info in the info panel
  document.querySelectorAll('.asc-band-hit').forEach(band => {
    const pathwayId = band.dataset.pathway;
    if (pathwayId) band.addEventListener('click', e => { e.stopPropagation(); showTractInfo(pathwayId); });
  });

  // ── Motor CN panel interaction ─────────────────────────────────────────────

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
      el.setAttribute('opacity', bandId ? (match ? '1.0' : '0.05') : '0.15');
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

  // Motor CN band hit areas → show cranial nerve info in the info panel
  document.querySelectorAll('.motor-cn-band-hit').forEach(band => {
    const tractKey = BAND_TO_TRACT_KEY[band.dataset.band];
    if (tractKey) band.addEventListener('click', e => { e.stopPropagation(); showTractInfo(tractKey); });
  });

  // Motor CN dots → select that nucleus
  document.querySelectorAll('.motor-cn-dot').forEach(dot => {
    dot.addEventListener('click', e => { e.stopPropagation(); selectRegion(Number(dot.dataset.nucleusId)); });
  });

  // ── Descending tract clickable elements ───────────────────────────────────
  // Hit areas (wide transparent bands) handle clicks for the three data-bearing tracts.
  document.querySelectorAll('.tract-band-hit').forEach(hit => {
    hit.addEventListener('click', e => { e.stopPropagation(); selectRegion(Number(hit.dataset.tractId)); });
  });

  // Origin dots: those with data-has-data="true" get click handlers.
  // Dots with data-tract-key show tract info; others select the tract as a region.
  document.querySelectorAll('.pwy-origin-dot[data-has-data="true"]').forEach(dot => {
    dot.addEventListener('click', e => {
      e.stopPropagation();
      const tractKey = dot.dataset.tractKey;
      if (tractKey) showTractInfo(tractKey);
      else selectRegion(Number(dot.dataset.tractId));
    });
  });

  // Regions that have at least one efferent connection — used for visual fill coloring
  const coveredIds = new Set([
    ...Object.keys(injMapRel),
    ...Object.keys(injMapAbs),
  ].map(Number));

  // ── SVG setup ──────────────────────────────────────────────────────────────

  const container = document.getElementById('map-container');
  const svg = d3.select(container).append('svg')
    .attr('width',  '100%')
    .attr('height', '100%');
  const g = svg.append('g');

  // Compute data bounding box across all region polygons (needed for fit-to-window)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const region of regions) {
    for (const poly of toPolygons(region.coordsReg)) {
      for (const [x, y] of poly) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const pad   = 10;
  const dataW = maxX - minX + pad * 2;
  const dataH = maxY - minY + pad * 2;

  // ── Draw regions ───────────────────────────────────────────────────────────

  const paths = g.selectAll('path.region')
    .data(regions)
    .join('path')
    .attr('class', d => {
      const base = d.hole ? 'region hole' : 'region';
      return coveredIds.has(d.allenId) ? base : `${base} no-data`;
    })
    .attr('d', d => pathFromCoords(d.coordsReg || []))
    .style('fill', d => {
      if (d.allenId === 16) return '#000000';           // 6b: laminar designation, rendered black (§6 Cat B)
      if (!coveredIds.has(d.allenId)) return '#2a2a2a'; // no data: dark grey
      const meta = metadata[d.allenId];
      return meta ? meta.hexcolor : '#3a3a3a';
    });

  // ── Hover tooltip ──────────────────────────────────────────────────────────

  paths.on('mousemove', (event, d) => {
    const meta = metadata[d.allenId] || {};
    tooltipEl.style.display = 'block';
    tooltipEl.style.left    = (event.pageX + 12) + 'px';
    tooltipEl.style.top     = (event.pageY - 28) + 'px';
    tooltipEl.innerHTML = `<strong>${meta.acronym || '?'}</strong> <span class="tt-id">(ID ${d.allenId})</span><br>${meta.name || ''}`;
  });
  paths.on('mouseleave', () => { tooltipEl.style.display = 'none'; });

  // ── Interaction state ──────────────────────────────────────────────────────

  let selected = null;
  let mode     = 'efferent';  // 'efferent' | 'afferent'
  let metric   = 'relative';  // 'relative' | 'absolute'

  // ── Hover glow ──────────────────────────────────────────────────────────────
  // Assign the module-level stubs so top-level functions (showInfo) can call them.

  let glowRaf          = null;
  let glowAllenId      = null;
  let glowSavedOpacity = null;

  startGlow = function(allenId) {
    if (!allenId || glowAllenId === allenId) return;
    stopGlow();
    glowAllenId = allenId;

    // Lift element opacity to 1 so the stroke glow is visible even on dimmed regions.
    // Save the inline opacity first so we can restore it on mouse-leave.
    const node = paths.filter(d => d.allenId === allenId).node();
    glowSavedOpacity = node?.style.opacity || null;

    const t0     = performance.now();
    const period = 1300;

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
  };

  stopGlow = function() {
    if (glowRaf !== null) { cancelAnimationFrame(glowRaf); glowRaf = null; }
    if (glowAllenId !== null) {
      paths.filter(d => d.allenId === glowAllenId)
        .style('opacity',        glowSavedOpacity)
        .style('stroke',         null)
        .style('stroke-width',   null)
        .style('stroke-opacity', null);
      glowAllenId      = null;
      glowSavedOpacity = null;
    }
  };

  // Render known-but-unmeasured connections for the given region and mode.
  function renderKnownConnections(allenId, curMode) {
    const knownSection = document.getElementById('known-connections');
    const knownList    = document.getElementById('known-connections-list');
    const tractIds = curMode === 'efferent'
      ? (REGION_KNOWN_EFFERENTS.get(allenId) || [])
      : (REGION_KNOWN_AFFERENTS.get(allenId) || []);
    if (!tractIds.length) { knownSection.style.display = 'none'; return; }
    knownSection.style.display = '';
    knownList.innerHTML = '';
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
      item.addEventListener('mouseleave', () => { stopGlow(); });
      item.addEventListener('click', e => {
        e.stopPropagation();
        stopGlow();
        openPathwayPanel();
        switchToCombo(sites.dir || 'aff', sites.route || 'cranial');
        if (sites.primary) selectRegion(sites.primary);
      });
      knownList.appendChild(item);
    }
  }

  // Show tract/pathway info in the info panel when a band is clicked directly.
  // Lists all known projection sites for the tract; clicking a site navigates to it.
  function showTractInfo(tractKey) {
    const sites = TRACT_PROJECTION_SITES[tractKey];
    if (!sites) return;

    paths.interrupt('flash');
    selected = null;

    const isAff     = sites.dir === 'aff';
    const regionIds = isAff ? (sites.afferent_termini || []) : (sites.efferent_origins || []);
    const idSet     = new Set(regionIds);

    // Highlight connected regions, dim everything else.
    // Dimmed regions get pointer-events:none so nested/overlapping highlighted regions
    // underneath receive mouse events (prevents tooltip showing child name over lit parent).
    paths
      .classed('dimmed', false)
      .classed('selected', rd => idSet.has(rd.allenId))
      .style('opacity',        rd => idSet.has(rd.allenId) ? 1 : MIN_OPACITY)
      .style('pointer-events', rd => idSet.has(rd.allenId) ? 'auto' : 'none')
      .style('stroke-width', null);

    // Highlight the band visual for this tract; reset all other band panels
    clearPathwayPanel();
    clearAscendingPanel();
    clearMotorCNPanel();
    if (sites.dir === 'aff') {
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
      // eff-spinal rst / vsp
      const el = document.getElementById('tract-' + tractKey);
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

  // Mode toggle — Efferents / Afferents
  document.getElementById('btn-efferent').addEventListener('click', () => {
    mode = 'efferent';
    setActiveButton('btn-efferent', 'btn-afferent');
    if (selected !== null) triggerSelect(selected);
  });
  document.getElementById('btn-afferent').addEventListener('click', () => {
    mode = 'afferent';
    setActiveButton('btn-afferent', 'btn-efferent');
    if (selected !== null) triggerSelect(selected);
  });

  // Metric toggle — Relative / Absolute
  document.getElementById('btn-relative').addEventListener('click', () => {
    metric = 'relative';
    setActiveButton('btn-relative', 'btn-absolute');
    if (selected !== null) triggerSelect(selected);
  });
  document.getElementById('btn-absolute').addEventListener('click', () => {
    metric = 'absolute';
    setActiveButton('btn-absolute', 'btn-relative');
    if (selected !== null) triggerSelect(selected);
  });

  // ── Region selection ───────────────────────────────────────────────────────

  function deselect() {
    paths.interrupt('flash'); // cancel any in-progress stroke-width animation
    paths.classed('dimmed', false).classed('selected', false)
      .style('opacity', null).style('stroke-width', null).style('pointer-events', null);
    selected = null;
    clearPathwayPanel();
    clearAscendingPanel();
    clearMotorCNPanel();
  }

  // Consolidates map-click and panel-click selection paths.
  function selectRegion(allenId) {
    if (TRACT_IDS.has(allenId)) {
      // Tracts with curated projection sites (no Allen injection data): show known sites only.
      // Tracts with real Allen data (CST/RUST/TSP): fall through to triggerSelect below.
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

  // Smooth-pan the map to center on the region's polygon centroid, preserving zoom level.
  // Called only for panel navigation — map clicks don't need it (you can already see the region).
  function panToRegion(allenId) {
    const region = regions.find(r => r.allenId === allenId);
    if (!region) return;
    const polys = toPolygons(region.coordsReg);
    if (!polys.length) return;
    const allPts = polys.flat();
    const cx = allPts.reduce((s, [x])    => s + x, 0) / allPts.length;
    const cy = allPts.reduce((s, [, y])  => s + y, 0) / allPts.length;
    const { width: W, height: H } = container.getBoundingClientRect();
    const k = d3.zoomTransform(svg.node()).k;
    svg.transition().duration(450)
      .call(zoom.transform, d3.zoomIdentity.translate(W / 2 - k * cx, H / 2 - k * cy).scale(k));
  }

  // Pulse the selected region's stroke width (5 → 1.5 px) to draw the eye to it.
  // Uses a named D3 transition so it can be safely interrupted on re-selection.
  function flashSelectedRegion(allenId) {
    const sel = paths.filter(rd => rd.allenId === allenId);
    sel.raise(); // render on top so the stroke shows above neighbouring regions
    sel.transition('flash').duration(700).ease(d3.easeCubicOut)
      .styleTween('stroke-width', () => {
        const interp = d3.interpolateNumber(5, 2.5);
        return t => `${interp(t)}px`;
      });
  }

  function triggerSelect(allenId) {
    const isTractSel = TRACT_IDS.has(allenId);
    // Tracts can only be projection targets — always show what projects into them,
    // regardless of the efferent/afferent mode toggle.
    const isEff      = !isTractSel && mode === 'efferent';
    const injMap     = metric === 'relative' ? injMapRel  : injMapAbs;
    const projMap    = metric === 'relative' ? projMapRel : projMapAbs;
    const partnerId  = isEff ? 'projection_structure_id' : 'injection_structure_id';

    // For afferents in relative mode, re-normalize each source X by its own strongest
    // efferent connection.  Without this, abs(X→Y) = rel(X→Y) × vol(Y) for any fixed
    // target Y — a constant factor — making relative and absolute rank identically.
    // After re-normalization, relative afferent means "fraction of X's total output that
    // reaches Y" (mirrors efferent relative), while absolute afferent stays as raw volume.
    let conns = isEff ? (injMap[allenId] || []) : (projMap[allenId] || []);
    if (!isEff && !isTractSel && metric === 'relative') {
      conns = conns.map(conn => {
        const srcMax = (injMapRel[conn.injection_structure_id] || [])
          .reduce((m, c) => Math.max(m, c.normalized_value), 0) || 1;
        return { ...conn, normalized_value: conn.normalized_value / srcMax };
      });
    }

    // Build a per-region strength map normalized to the strongest connection for this region.
    const relevant = conns.filter(c => c[partnerId] !== allenId);
    const localMax = relevant.reduce((m, c) => Math.max(m, c.normalized_value), 0) || 1;
    const strengthMap = {};
    for (const conn of relevant) {
      strengthMap[conn[partnerId]] = conn.normalized_value / localMax;
    }

    paths
      .classed('dimmed',   false)
      .classed('selected', rd => !isTractSel && rd.allenId === allenId)
      .style('pointer-events', null)  // restore after any tract-view that disabled events on dimmed paths
      .style('opacity', rd => {
        if (!isTractSel && rd.allenId === allenId) return 1;
        const s = strengthMap[rd.allenId];
        return s !== undefined ? Math.max(MIN_OPACITY, s) : MIN_OPACITY;
      });

    paths.interrupt('flash');
    if (!isTractSel) flashSelectedRegion(allenId);

    // Tracts always render as afferents (injection sources → this tract); pass 'afferent'
    // so showInfo uses the correct partnerId regardless of the UI toggle state.

    showInfo(allenId, conns, metadata, isTractSel ? 'afferent' : mode, newAllenId => {
      selectRegion(newAllenId);
      panToRegion(newAllenId);
    });
    renderKnownConnections(allenId, isTractSel ? 'afferent' : mode);
    updatePathwayPanel(allenId, localMax);
    updateAscendingPanel(allenId);
    updateMotorCNPanel(allenId);
  }

  paths.on('click', (event, d) => {
    if (event.defaultPrevented) return;  // ignore drag-end clicks
    stopGlow();
    selectRegion(d.allenId);
  });

  // Click SVG background to deselect the current region
  svg.on('click', (event) => {
    if (event.defaultPrevented) return;
    if (event.target.tagName === 'svg' || event.target.tagName === 'g') {
      deselect();
      clearInfo();
    }
  });

  // ── Zoom and pan ───────────────────────────────────────────────────────────
  // Fit the map to the container on load, then allow free navigation.
  // Minimum zoom is locked to the fit scale so you can't zoom out past full view.

  const zoom = d3.zoom().on('zoom', event => g.attr('transform', event.transform));
  svg.call(zoom);

  requestAnimationFrame(() => {
    const { width: W, height: H } = container.getBoundingClientRect();
    const fitScale = Math.min(W / dataW, H / dataH);
    const tx = (W - dataW * fitScale) / 2 - (minX - pad) * fitScale;
    const ty = (H - dataH * fitScale) / 2 - (minY - pad) * fitScale;
    zoom.scaleExtent([fitScale, fitScale * 40]);
    svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(fitScale));
  });
}

main().catch(err => {
  console.error('Flatmap initialization failed:', err);
  const container = document.getElementById('map-container');
  if (container) {
    container.innerHTML = '<p style="padding:2rem;color:#888">Failed to load map data. See browser console for details.</p>';
  }
});
