import * as d3 from 'd3';

const DATA = {
  regions:      '/data/swanson_regions.json',
  metadata:     '/data/region_metadata.json',
  connectivity: '/data/connectivity_matrix.json',
};

async function main() {
  const [regions, metadata, connectivity] = await Promise.all([
    fetch(DATA.regions).then(r => r.json()),
    fetch(DATA.metadata).then(r => r.json()),
    fetch(DATA.connectivity).then(r => r.json()),
  ]);

  // Build four lookup maps: (efferent/afferent) × (relative/absolute metric)
  function buildMaps(sparseConnections) {
    const injMap = {}, projMap = {};
    for (const conn of sparseConnections) {
      const inj = conn.injection_structure_id;
      const proj = conn.projection_structure_id;
      if (!injMap[inj]) injMap[inj] = [];
      injMap[inj].push(conn);
      if (!projMap[proj]) projMap[proj] = [];
      projMap[proj].push(conn);
    }
    return { injMap, projMap };
  }
  const { injMap: injectionMapRel, projMap: projectionMapRel } = buildMaps(connectivity.sparse_connections_relative);
  const { injMap: injectionMapAbs, projMap: projectionMapAbs } = buildMaps(connectivity.sparse_connections_absolute);

  // Regions with any efferent/afferent data (union across metrics, used only for visual coloring)
  const coveredIds = new Set([
    ...Object.keys(injectionMapRel).map(Number),
    ...Object.keys(injectionMapAbs).map(Number),
  ]);
  const afferentIds = new Set([
    ...Object.keys(projectionMapRel).map(Number),
    ...Object.keys(projectionMapAbs).map(Number),
  ]);

  // SVG setup
  const container = document.getElementById('map-container');
  const svg = d3.select(container).append('svg')
    .attr('width', '100%')
    .attr('height', '100%');
  const g = svg.append('g');

  // coordsReg can be {x,y} (single polygon) or [{x,y},...] (multi-polygon)
  const toPolygons = coords => {
    if (!coords) return [];
    const polys = Array.isArray(coords) ? coords : [coords];
    return polys
      .filter(p => p.x && p.x.length)
      .map(p => p.x.map((x, i) => [x, p.y[i]]));
  };

  const pathFromCoords = coords =>
    toPolygons(coords)
      .map(pts => 'M' + pts.map(([x, y]) => `${x},${y}`).join('L') + 'Z')
      .join(' ');

  // Compute bounding box across all region coords
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
  const pad = 10;
  const dataW = maxX - minX + pad * 2;
  const dataH = maxY - minY + pad * 2;

  // Draw regions
  const paths = g.selectAll('path.region')
    .data(regions)
    .join('path')
    .attr('class', d => {
      const allenId = d.allenId;
      const base = d.hole ? 'region hole' : 'region';
      return coveredIds.has(allenId) ? base : `${base} no-data`;
    })
    .attr('d', d => pathFromCoords(d.coordsReg || []))
    .style('fill', d => {
      if (d.allenId === 16) return '#000000';          // 6b: layer designation, not a discrete region
      if (!coveredIds.has(d.allenId)) return '#2a2a2a';
      const meta = metadata[d.allenId];
      return meta ? meta.hexcolor : '#3a3a3a';
    });

  // Hover tooltip
  const tooltip = d3.select('body').append('div').attr('id', 'tooltip');

  paths.on('mousemove', (event, d) => {
    const meta = metadata[d.allenId] || {};
    tooltip
      .style('display', 'block')
      .style('left', (event.pageX + 12) + 'px')
      .style('top',  (event.pageY - 28) + 'px')
      .html(`<strong>${meta.acronym || '?'}</strong> <span class="tt-id">(ID ${d.allenId})</span><br>${meta.name || ''}`);
  });

  paths.on('mouseleave', () => tooltip.style('display', 'none'));

  // Reasons why specific regions have no injection data
  const NO_DATA_REASONS = {
    // Category B — layer designation
    16:  { label: 'Layer designation', text: 'Layer 6b is a laminar designation spanning the entire isocortex cortical subplate, not a discrete nucleus. It cannot be specifically targeted for injection.' },
    // Category A — projection targets only (Allen tracked inputs but never injected)
    338: { label: 'Projection target only', text: 'Allen mapped projections to this region but did not inject it as a source. The subfornical organ is also a circumventricular organ outside the blood-brain barrier, making standard viral tracer injections impractical.' },
    318: { label: 'Projection target only', text: 'Allen mapped projections to this region but did not inject it as a source. The supragenual nucleus is a tiny pontine nucleus immediately adjacent to larger structures, making a clean targeted injection nearly impossible.' },
    903: { label: 'Projection target only', text: 'Allen mapped projections to this region but did not inject it as a source. The external cuneate nucleus is a small medullary sensory relay nucleus too close to neighboring structures for a clean injection.' },
    859: { label: 'Projection target only', text: 'Allen mapped projections to this region but did not inject it as a source. The parasolitary nucleus sits immediately adjacent to the nucleus of the solitary tract (NTS), which was injected.' },
    // Category C — sub-parcellation
    560: { label: 'Sub-parcellation', text: 'The cochlear nucleus subpeduncular granular region falls below Allen\'s injection resolution. Its siblings DCO (18 experiments) and VCO (10 experiments) have data but are functionally distinct sub-regions.' },
    // Category D — absent from Allen's experimental design
    80:  { label: 'Not in Allen\'s design', text: 'No injection experiments exist at any level of this region\'s CCF hierarchy, despite neighbors DMH (79 experiments), MPO (47), and PVp (32) all having data. AHA sits in a transitional zone between the periventricular and lateral hypothalamus.' },
    738: { label: 'Not in Allen\'s design', text: 'No injection experiments exist for ORBv or any sibling ORB sub-region. Unusually, all orbital area subdivisions (ORBl, ORBm, ORBvl) were also excluded from Allen\'s injection program.' },
    887: { label: 'Not in Allen\'s design', text: 'The efferent cochlear group has no injection experiments at any CCF hierarchy level. It is a small, specialized auditory efferent nucleus.' },
    161: { label: 'Not in Allen\'s design', text: 'The nucleus intercalatus has no injection experiments at any CCF hierarchy level. It is a tiny vestibular-related medullary nucleus; siblings NR (13 experiments) and PRP (5 experiments) have data.' },
    995: { label: 'Not in Allen\'s design', text: 'The paramedian reticular nucleus has no injection experiments at any CCF hierarchy level. It is a small reticular nucleus adjacent to larger targets (VI, VII, AMB) that were injected.' },
    568: { label: 'Not in Allen\'s design', text: 'The accessory abducens nucleus has no injection experiments at any CCF hierarchy level. It is a very small accessory motor nucleus; neighbors VI, VII, and AMB have data.' },
    789: { label: 'Not in Allen\'s design', text: 'Nucleus z has no injection experiments at any CCF hierarchy level. It is a proprioceptive relay among the smallest nuclei in the medulla; neighbors NTS (32 experiments) and SPVC (19 experiments) have data.' },
  };
  const DEFAULT_NO_DATA = { label: 'No injection data', text: 'This region has no injection experiments in the Allen Mouse Brain Connectivity Atlas.' };

  const METRIC_NOTES = {
    relative: 'Relative: projection energy / injection volume (size-normalized per target structure)',
    absolute: 'Absolute: labeled volume × intensity / injection volume (favors larger terminal fields)',
  };

  // Interaction
  let selected = null;
  let mode = 'efferent';   // 'efferent' | 'afferent'
  let metric = 'relative'; // 'relative' | 'absolute'

  function setMetricNote() {
    document.getElementById('metric-note').textContent = METRIC_NOTES[metric];
  }
  setMetricNote();

  document.getElementById('btn-efferent').addEventListener('click', () => {
    mode = 'efferent';
    document.getElementById('btn-efferent').classList.add('active');
    document.getElementById('btn-afferent').classList.remove('active');
    if (selected !== null) triggerSelect(selected);
  });
  document.getElementById('btn-afferent').addEventListener('click', () => {
    mode = 'afferent';
    document.getElementById('btn-afferent').classList.add('active');
    document.getElementById('btn-efferent').classList.remove('active');
    if (selected !== null) triggerSelect(selected);
  });
  document.getElementById('btn-relative').addEventListener('click', () => {
    metric = 'relative';
    document.getElementById('btn-relative').classList.add('active');
    document.getElementById('btn-absolute').classList.remove('active');
    setMetricNote();
    if (selected !== null) triggerSelect(selected);
  });
  document.getElementById('btn-absolute').addEventListener('click', () => {
    metric = 'absolute';
    document.getElementById('btn-absolute').classList.add('active');
    document.getElementById('btn-relative').classList.remove('active');
    setMetricNote();
    if (selected !== null) triggerSelect(selected);
  });

  const MIN_OPACITY = 0.06;

  function triggerSelect(allenId) {
    const isEff = mode === 'efferent';
    const injMap = metric === 'relative' ? injectionMapRel : injectionMapAbs;
    const projMap = metric === 'relative' ? projectionMapRel : projectionMapAbs;
    const conns = isEff ? (injMap[allenId] || []) : (projMap[allenId] || []);
    const partnerId = isEff ? 'projection_structure_id' : 'injection_structure_id';

    // Build per-region strength map, normalized to the strongest connection
    const strengthMap = {};
    const relevant = conns.filter(c => c[partnerId] !== allenId);
    const localMax = relevant.reduce((m, c) => Math.max(m, c.normalized_volume), 0) || 1;
    for (const conn of relevant) {
      strengthMap[conn[partnerId]] = conn.normalized_volume / localMax;
    }

    paths
      .classed('dimmed', false)
      .classed('selected', rd => rd.allenId === allenId)
      .style('opacity', rd => {
        if (rd.allenId === allenId) return 1;
        const s = strengthMap[rd.allenId];
        return s !== undefined ? Math.max(MIN_OPACITY, s) : MIN_OPACITY;
      });

    showInfo(allenId, conns, metadata, mode);
  }

  paths.on('click', (event, d) => {
    if (event.defaultPrevented) return; // ignore drag-end clicks
    const allenId = d.allenId;
    const injMap = metric === 'relative' ? injectionMapRel : injectionMapAbs;
    const projMap = metric === 'relative' ? projectionMapRel : projectionMapAbs;
    const hasData = mode === 'efferent' ? injMap[allenId] !== undefined : projMap[allenId] !== undefined;

    if (!hasData) {
      paths.classed('dimmed', false).classed('selected', false).style('opacity', null);
      selected = null;
      const meta = metadata[allenId] || {};
      const reason = NO_DATA_REASONS[allenId] || DEFAULT_NO_DATA;
      showNoDataInfo(meta, reason);
      return;
    }

    selected = allenId;
    triggerSelect(allenId);
  });

  // Click background to reset
  svg.on('click', (event) => {
    if (event.defaultPrevented) return; // ignore drag-end clicks
    if (event.target.tagName === 'svg' || event.target.tagName === 'g') {
      paths.classed('dimmed', false).classed('selected', false).style('opacity', null);
      selected = null;
      clearInfo();
    }
  });

  // Zoom and pan — fit map to container on load, then allow free navigation
  const zoom = d3.zoom()
    .on('zoom', (event) => g.attr('transform', event.transform));

  svg.call(zoom);

  // Compute initial fit transform once the container has been laid out,
  // then lock the minimum zoom to the fit scale so you can't zoom out past full view.
  requestAnimationFrame(() => {
    const { width: W, height: H } = container.getBoundingClientRect();
    const fitScale = Math.min(W / dataW, H / dataH);
    const tx = (W - dataW * fitScale) / 2 - (minX - pad) * fitScale;
    const ty = (H - dataH * fitScale) / 2 - (minY - pad) * fitScale;
    zoom.scaleExtent([fitScale, fitScale * 40]);
    svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(fitScale));
  });
}

function showInfo(allenId, conns, metadata, mode) {
  const meta = metadata[allenId] || {};
  document.getElementById('region-acronym').textContent = meta.acronym || allenId;
  document.getElementById('region-name').textContent = meta.name || '';
  document.getElementById('no-data-reason').style.display = 'none';

  const list = document.getElementById('connections-list');
  list.innerHTML = '';

  const isEff = mode === 'efferent';
  const partnerId = isEff ? 'projection_structure_id' : 'injection_structure_id';

  const tooltip = document.getElementById('tooltip');
  const sorted = [...conns]
    .filter(c => c[partnerId] !== allenId)
    .sort((a, b) => b.normalized_volume - a.normalized_volume);
  const localMax = sorted[0]?.normalized_volume || 1;
  for (const conn of sorted) {
    const partnerMeta = metadata[conn[partnerId]] || {};
    const pct = Math.round((conn.normalized_volume / localMax) * 100);
    const item = document.createElement('div');
    item.className = 'connection-item';
    item.innerHTML = `
      <div style="width:100%">
        <div>${partnerMeta.acronym || conn[partnerId]}</div>
        <div class="connection-bar" style="width:${pct}%"></div>
      </div>
    `;
    item.addEventListener('mousemove', e => {
      tooltip.style.display = 'block';
      tooltip.style.left = (e.pageX + 12) + 'px';
      tooltip.style.top  = (e.pageY - 28) + 'px';
      tooltip.innerHTML = `<strong>${partnerMeta.acronym || conn[partnerId]}</strong><br>${partnerMeta.name || ''}`;
    });
    item.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    list.appendChild(item);
  }
}

function showNoDataInfo(meta, reason) {
  document.getElementById('region-acronym').textContent = meta.acronym || '?';
  document.getElementById('region-name').textContent = meta.name || '';
  document.getElementById('no-data-label').textContent = reason.label;
  document.getElementById('no-data-text').textContent = reason.text;
  document.getElementById('no-data-reason').style.display = 'flex';
  document.getElementById('connections-list').innerHTML = '';
}

function clearInfo() {
  document.getElementById('region-acronym').textContent = '';
  document.getElementById('region-name').textContent = '';
  document.getElementById('no-data-reason').style.display = 'none';
  document.getElementById('connections-list').innerHTML = '';
}

main();
