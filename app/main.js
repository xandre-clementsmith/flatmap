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

  // Build injection lookup: allenId -> [{ projection_structure_id, normalized_volume }]
  const injectionMap = {};
  for (const conn of connectivity.sparse_connections) {
    const id = conn.injection_structure_id;
    if (!injectionMap[id]) injectionMap[id] = [];
    injectionMap[id].push(conn);
  }

  // Set of allen IDs that have injection data
  const coveredIds = new Set(Object.keys(injectionMap).map(Number));

  // SVG setup — coordinate bounds will be set once we inspect the data
  const container = document.getElementById('map-container');
  const svg = d3.select(container).append('svg');
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

  // Compute bounding box across all region coords to set viewBox
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
  svg.attr('viewBox', `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`)
     .attr('preserveAspectRatio', 'xMidYMid meet');

  // Draw regions
  // NOTE: thisID in swanson_regions.json needs to be verified against Allen IDs
  // in region_metadata once data is available. Mapping may require adjustment.
  const paths = g.selectAll('path.region')
    .data(regions)
    .join('path')
    .attr('class', d => {
      const allenId = d.thisID;
      const base = d.hole ? 'region hole' : 'region';
      return coveredIds.has(allenId) ? base : `${base} no-data`;
    })
    .attr('d', d => pathFromCoords(d.coordsReg || []))
    .style('fill', d => {
      if (!coveredIds.has(d.thisID)) return '#2a2a2a';
      const meta = metadata[d.thisID];
      return meta ? meta.hexcolor : '#3a3a3a';
    });

  // Interaction
  let selected = null;

  paths.on('click', (event, d) => {
    const allenId = d.thisID;
    if (!coveredIds.has(allenId)) return;

    selected = allenId;
    const conns = injectionMap[allenId] || [];
    const projSet = new Set(conns.map(c => c.projection_structure_id));

    paths
      .classed('dimmed', rd => {
        const rid = rd.thisID;
        return rid !== allenId && !projSet.has(rid);
      })
      .classed('selected', rd => rd.thisID === allenId);

    showInfo(allenId, conns, metadata);
  });

  // Click background to reset
  svg.on('click', (event) => {
    if (event.target.tagName === 'svg' || event.target.tagName === 'g') {
      paths.classed('dimmed', false).classed('selected', false);
      selected = null;
      clearInfo();
    }
  });
}

function showInfo(allenId, conns, metadata) {
  const meta = metadata[allenId] || {};
  document.getElementById('region-acronym').textContent = meta.acronym || allenId;
  document.getElementById('region-name').textContent = meta.name || '';

  const list = document.getElementById('connections-list');
  list.innerHTML = '';

  const sorted = [...conns].sort((a, b) => b.normalized_volume - a.normalized_volume);
  for (const conn of sorted) {
    const projMeta = metadata[conn.projection_structure_id] || {};
    const pct = Math.round(conn.normalized_volume * 100);
    const item = document.createElement('div');
    item.className = 'connection-item';
    item.innerHTML = `
      <div>
        <div>${projMeta.acronym || conn.projection_structure_id}</div>
        <div class="connection-bar" style="width:${pct}%"></div>
      </div>
      <span>${pct}%</span>
    `;
    list.appendChild(item);
  }
}

function clearInfo() {
  document.getElementById('region-acronym').textContent = '';
  document.getElementById('region-name').textContent = '';
  document.getElementById('connections-list').innerHTML = '';
}

main();
