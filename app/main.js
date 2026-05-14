import * as d3 from 'd3';

// ─── Data endpoints ───────────────────────────────────────────────────────────

const DATA = {
  regions:      '/data/swanson_regions.json',
  metadata:     '/data/region_metadata.json',
  connectivity: '/data/connectivity_matrix.json',
};

// ─── Why-no-data explanations (parcellation_mismatches.md §6) ─────────────────
// Shown in the info panel when clicking a region with no injection data.
// Keyed by Allen CCF ID.

const NO_DATA_REASONS = {
  // Category B — layer designation, not a discrete injectable nucleus
  16: {
    label: 'Layer designation',
    text:  'Layer 6b is a laminar designation spanning the entire isocortex cortical subplate, not a discrete nucleus. It cannot be specifically targeted for injection.',
  },
  // Category A — Allen tracked projections TO these regions but never injected them
  338: { label: 'Projection target only', text: 'Allen mapped projections to this region but did not inject it as a source. The subfornical organ is also a circumventricular organ outside the blood-brain barrier, making standard viral tracer injections impractical.' },
  318: { label: 'Projection target only', text: 'Allen mapped projections to this region but did not inject it as a source. The supragenual nucleus is a tiny pontine nucleus immediately adjacent to larger structures, making a clean targeted injection nearly impossible.' },
  903: { label: 'Projection target only', text: 'Allen mapped projections to this region but did not inject it as a source. The external cuneate nucleus is a small medullary sensory relay nucleus too close to neighboring structures for a clean injection.' },
  859: { label: 'Projection target only', text: 'Allen mapped projections to this region but did not inject it as a source. The parasolitary nucleus sits immediately adjacent to the nucleus of the solitary tract (NTS), which was injected.' },
  // Category C — sub-parcellation below Allen's injection resolution
  560: { label: 'Sub-parcellation', text: "The cochlear nucleus subpeduncular granular region falls below Allen's injection resolution. Its siblings DCO (18 experiments) and VCO (10 experiments) have data but are functionally distinct sub-regions." },
  // Category D — absent from Allen's experimental design entirely
  80:  { label: "Not in Allen's design", text: "No injection experiments exist at any level of this region's CCF hierarchy, despite neighbors DMH (79 experiments), MPO (47), and PVp (32) all having data. AHA sits in a transitional zone between the periventricular and lateral hypothalamus." },
  738: { label: "Not in Allen's design", text: "No injection experiments exist for ORBv or any sibling ORB sub-region. Unusually, all orbital area subdivisions (ORBl, ORBm, ORBvl) were also excluded from Allen's injection program." },
  887: { label: "Not in Allen's design", text: 'The efferent cochlear group has no injection experiments at any CCF hierarchy level. It is a small, specialized auditory efferent nucleus.' },
  161: { label: "Not in Allen's design", text: 'The nucleus intercalatus has no injection experiments at any CCF hierarchy level. It is a tiny vestibular-related medullary nucleus; siblings NR (13 experiments) and PRP (5 experiments) have data.' },
  995: { label: "Not in Allen's design", text: 'The paramedian reticular nucleus has no injection experiments at any CCF hierarchy level. It is a small reticular nucleus adjacent to larger targets (VI, VII, AMB) that were injected.' },
  568: { label: "Not in Allen's design", text: 'The accessory abducens nucleus has no injection experiments at any CCF hierarchy level. It is a very small accessory motor nucleus; neighbors VI, VII, and AMB have data.' },
  789: { label: "Not in Allen's design", text: 'Nucleus z has no injection experiments at any CCF hierarchy level. It is a proprioceptive relay among the smallest nuclei in the medulla; neighbors NTS (32 experiments) and SPVC (19 experiments) have data.' },
  // Fiber tracts — projection targets only, never injection sources
  784: { label: 'Fiber tract', text: 'The corticospinal tract is a descending motor pathway, not a discrete injectable nucleus. It appears in the connections list as an efferent target when brain regions send axons through this pathway.' },
  863: { label: 'Fiber tract', text: 'The rubrospinal tract is a descending motor pathway originating from the red nucleus. It appears as an efferent target for regions that drive this pathway.' },
  877: { label: 'Fiber tract', text: 'The tectospinal pathway descends from the superior colliculus. It appears as an efferent target for regions that project through this pathway.' },
  855: { label: 'Fiber tract — no Allen data', text: 'The reticulospinal tract descends from the pontine and medullary reticular formation bilaterally. Allen recorded no projection density into this tract.' },
  941: { label: 'Fiber tract — no Allen data', text: 'The vestibulospinal pathway descends from the lateral (Deiters\') and medial vestibular nuclei. Allen recorded no projection density into this pathway.' },
};

const DEFAULT_NO_DATA = {
  label: 'No injection data',
  text:  'This region has no injection experiments in the Allen Mouse Brain Connectivity Atlas.',
};

// Opacity floor — dimmed regions never go fully invisible
const MIN_OPACITY = 0.06;

// Allen CCF IDs of fiber tract structures included as projection targets.
// These are never injection sources, so clicking them shows info without changing map state.
const TRACT_IDS = new Set([784, 863, 877, 855, 941]);

// Distinct colors for each tract — used in the connections list bars and the pathway schematic.
const TRACT_COLORS = {
  784: '#4ab5a0',  // cst  — teal-green
  863: '#d4894a',  // rust — amber
  877: '#9370cc',  // tsp  — violet
  855: '#5bafd4',  // rst  — sky blue
  941: '#c4a84a',  // vsp  — gold
};


// ─── Pure geometry utilities ──────────────────────────────────────────────────

/**
 * Convert a coordsReg value (single or multi-polygon) to an array of
 * [[x, y], …] point arrays — one inner array per polygon.
 */
function toPolygons(coords) {
  if (!coords) return [];
  const polys = Array.isArray(coords) ? coords : [coords];
  return polys
    .filter(p => p.x && p.x.length)
    .map(p => p.x.map((x, i) => [x, p.y[i]]));
}

/** Build an SVG path string from a coordsReg value (handles multi-polygon). */
function pathFromCoords(coords) {
  return toPolygons(coords)
    .map(pts => 'M' + pts.map(([x, y]) => `${x},${y}`).join('L') + 'Z')
    .join(' ');
}

/**
 * Index a sparse connection list by both injection and projection structure.
 * Returns { injMap: {id → [conn, …]}, projMap: {id → [conn, …]} }.
 * Used to look up efferents (injMap) or afferents (projMap) for a clicked region.
 */
function buildMaps(sparseConnections) {
  const injMap = {}, projMap = {};
  for (const conn of sparseConnections) {
    const inj  = conn.injection_structure_id;
    const proj = conn.projection_structure_id;
    if (!injMap[inj])  injMap[inj]  = [];
    if (!projMap[proj]) projMap[proj] = [];
    injMap[inj].push(conn);
    projMap[proj].push(conn);
  }
  return { injMap, projMap };
}


// ─── UI helpers ───────────────────────────────────────────────────────────────

/** Mark one button in a toggle pair as active and the other as inactive. */
function setActiveButton(activeId, inactiveId) {
  document.getElementById(activeId).classList.add('active');
  document.getElementById(inactiveId).classList.remove('active');
}

/** Populate the info panel with the selected region's connections.
 *  onSelectRegion(allenId) — optional callback invoked when the user clicks a connection item. */
function showInfo(allenId, conns, metadata, mode, onSelectRegion = null) {
  const meta = metadata[allenId] || {};
  document.getElementById('region-acronym').textContent = meta.acronym || allenId;
  document.getElementById('region-name').textContent    = meta.name    || '';
  document.getElementById('no-data-reason').style.display = 'none';

  const isEff     = mode === 'efferent';
  const partnerId = isEff ? 'projection_structure_id' : 'injection_structure_id';
  const tooltip   = document.getElementById('tooltip');

  // Sort connections strongest-first, excluding self-connections.
  // Tracts and brain regions are sorted together so that strong tract connections
  // (e.g. RN→rust at rank #1, MOp→cst at rank #4) are not buried at the bottom.
  const sorted   = [...conns].filter(c => c[partnerId] !== allenId)
                              .sort((a, b) => b.normalized_value - a.normalized_value);
  const localMax = sorted[0]?.normalized_value || 1;

  const list = document.getElementById('connections-list');
  list.innerHTML = '';

  for (const conn of sorted) {
    const isTract     = TRACT_IDS.has(conn[partnerId]);
    // Tracts only make sense as efferent targets; skip them in afferent mode.
    if (isTract && !isEff) continue;
    const partnerMeta = metadata[conn[partnerId]] || {};
    const pct  = Math.round((conn.normalized_value / localMax) * 100);
    const item = document.createElement('div');
    const barColor = isTract ? (TRACT_COLORS[conn[partnerId]] || '#3d9e8a') : null;
    item.className = 'connection-item';
    item.innerHTML = `
      <div style="width:100%">
        <div>${partnerMeta.acronym || conn[partnerId]}</div>
        <div class="connection-bar" style="width:${pct}%${barColor ? `;background:${barColor}` : ''}"></div>
      </div>
    `;
    item.addEventListener('mousemove', e => {
      tooltip.style.display = 'block';
      tooltip.style.left    = (e.pageX + 12) + 'px';
      tooltip.style.top     = (e.pageY - 28) + 'px';
      tooltip.innerHTML = `<strong>${partnerMeta.acronym || conn[partnerId]}</strong><br>${partnerMeta.name || ''}`;
    });
    item.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    item.addEventListener('click', () => {
      tooltip.style.display = 'none';
      if (onSelectRegion) onSelectRegion(conn[partnerId]);
    });
    list.appendChild(item);
  }
}

/** Show the info panel with a no-data explanation for regions without connectivity. */
function showNoDataInfo(meta, reason) {
  document.getElementById('region-acronym').textContent = meta.acronym || '?';
  document.getElementById('region-name').textContent    = meta.name    || '';
  document.getElementById('no-data-label').textContent  = reason.label;
  document.getElementById('no-data-text').textContent   = reason.text;
  document.getElementById('no-data-reason').style.display = 'flex';
  document.getElementById('connections-list').innerHTML = '';
  document.getElementById('known-connections').style.display = 'none';
}

/** Clear the info panel back to its blank state (called on background click). */
function clearInfo() {
  document.getElementById('region-acronym').textContent = '';
  document.getElementById('region-name').textContent    = '';
  document.getElementById('no-data-reason').style.display = 'none';
  document.getElementById('connections-list').innerHTML = '';
  document.getElementById('known-connections').style.display = 'none';
}

/** Reset the descending pathway schematic to its dim resting state. */
function clearPathwayPanel() {
  for (const id of ['tract-cst', 'tract-rust', 'tract-tsp', 'tract-rst', 'tract-vsp']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.setAttribute('opacity', '0.15');
    el.setAttribute('stroke-width', '2');
  }
}

// ── Ascending pathways ─────────────────────────────────────────────────────
// Each pathway maps to its first-order relay nuclei in the Allen CCF.
// 'primary' is the nucleus selected when clicking the pathway band.

const ASCENDING_PATHWAYS = [
  { id: 'olf',  color: '#b060a0', nuclei: [507, 151, 159],           primary: 507  }, // MOB, AOB, AON
  { id: 'vis',  color: '#c0a030', nuclei: [170, 178, 851, 842, 628], primary: 170  }, // LGd, LGv, SCop, SCsg, NOT
  { id: 'vest', color: '#60c0c0', nuclei: [225, 202, 209, 217],      primary: 225  }, // SPIV, MV, LAV, SUV
  { id: 'dcml', color: '#e07070', nuclei: [1039, 711, 903],          primary: 1039 }, // GR, CU, ECU
  { id: 'als',  color: '#d4604a', nuclei: [718],                     primary: 718  }, // VPL (STT thalamic relay)
  { id: 'spcr', color: '#7060c8', nuclei: [222],                     primary: 222  }, // IO (spino-olivary relay)
  { id: 'trig', color: '#e0a050', nuclei: [429, 437, 445, 7],        primary: 429  }, // SPVC, SPVI, SPVO, PSV
  { id: 'aud',  color: '#70b870', nuclei: [96, 101, 811, 1072, 1079, 1088], primary: 96 }, // DCO, VCO, ICc, MG*
  { id: 'visc', color: '#7090e0', nuclei: [651, 867],                primary: 651  }, // NTS, PB
  { id: 'hum',  color: '#a07840', nuclei: [338, 763, 286, 223, 207], primary: 286  }, // SFO, OV, SCH, ARH, AP
];

const NUCLEUS_TO_ASCENDING = new Map();
for (const pw of ASCENDING_PATHWAYS) {
  for (const nid of pw.nuclei) NUCLEUS_TO_ASCENDING.set(nid, pw.id);
}


// ─── Tract projection sites ───────────────────────────────────────────────────
// Single source of truth for all anatomically known but Allen-unmeasured connections.
// Each entry carries display metadata (color, label, sub) and pathway-panel routing
// (dir/route/primary), plus region lists:
//   afferent_termini  — CCF IDs of regions where this tract terminates
//                       → tract shown as afferent input when those regions are clicked
//   efferent_origins  — CCF IDs of regions where this tract originates
//                       → tract shown as efferent output when those regions are clicked
//
// To add a region: append its CCF ID to the appropriate array. Nothing else needed.

const TRACT_PROJECTION_SITES = {

  // ── Ascending sensory pathways ─────────────────────────────────────────────

  olf: {
    color:   '#b060a0',
    label:   'Olfactory (CN I)',
    sub:     'Olfactory epithelium — not in Allen CCF',
    dir:     'aff', route: 'cranial', primary: 507,
    afferent_termini: [
      507,  // MOB  — main olfactory bulb
      151,  // AOB  — accessory olfactory bulb
      159,  // AON  — anterior olfactory nucleus
    ],
  },

  vis: {
    color:   '#c0a030',
    label:   'Optic / Retinal (CN II)',
    sub:     'Retinal ganglion cells — not in Allen CCF',
    dir:     'aff', route: 'cranial', primary: 170,
    afferent_termini: [
      170,  // LGd  — dorsal lateral geniculate (primary thalamic relay)
      178,  // LGv  — ventral lateral geniculate
      851,  // SCop — superior colliculus, optic layer
      842,  // SCsg — superior colliculus, superficial grey
      628,  // NOT  — nucleus of the optic tract (pretectal)
      385,  // VISp — primary visual cortex
      286,  // SCH  — suprachiasmatic nucleus (direct retinal input, circadian)
    ],
  },

  vest: {
    color:   '#60c0c0',
    label:   'Vestibular (CN VIII)',
    sub:     'Vestibular apparatus — not in Allen CCF',
    dir:     'aff', route: 'cranial', primary: 225,
    afferent_termini: [
      225,  // SPIV — spinal vestibular nucleus
      202,  // MV   — medial vestibular nucleus
      209,  // LAV  — lateral vestibular nucleus (Deiters')
      217,  // SUV  — superior vestibular nucleus
      968,  // NOD  — nodulus (lobule X), flocculonodular lobe (direct CN VIII input)
    ],
  },

  dcml: {
    color:   '#e07070',
    label:   'DC / Medial lemniscus',
    sub:     'Fine touch & proprioception from body — spinal cord origin not in Allen CCF',
    dir:     'aff', route: 'spinal', primary: 1039,
    afferent_termini: [
      1039, // GR   — gracile nucleus (lower limb)
      711,  // CU   — cuneate nucleus (upper limb / trunk)
      789,  // Z    — nucleus Z (proprioceptive relay, no Allen injection data)
      718,  // VPL  — ventral posterolateral thalamus (second-order relay)
      337,  // SSp-ll — primary somatosensory, lower limb
      369,  // SSp-ul — primary somatosensory, upper limb
      361,  // SSp-tr — primary somatosensory, trunk
      378,  // SSs  — supplemental somatosensory cortex
    ],
  },

  als: {
    color:   '#d4604a',
    label:   'Anterolateral system',
    sub:     'Pain & temperature from body — spinal cord origin not in Allen CCF',
    dir:     'aff', route: 'spinal', primary: 718,
    afferent_termini: [
      // ── Brainstem targets (spinoreticular / spinomesencephalic / spinoparabrachial) ──
      651,  // NTS   — nucleus of the solitary tract (spinosolitary tract)
      978,  // PGRNl — paragigantocellular reticular / rostral VLM (≈A1 NE group)
      867,  // PB    — parabrachial nucleus (spinoparabrachial tract)
      795,  // PAG   — periaqueductal gray (spinomesencephalic tract)
      283,  // LTN   — lateral tegmental nucleus (≈A5 NE group, ventrolateral pons)
      147,  // LC    — locus coeruleus = A6 noradrenergic group
      350,  // SLC   — subceruleus nucleus = A7 noradrenergic group
      811,  // ICc   — inferior colliculus central nucleus (spinomesencephalic)
      842,  // SCsg  — superior colliculus superficial grey (spinomesencephalic)
      // ── Thalamic relay: specific nuclei (spinothalamic tract) ────────────
      718,  // VPL   — ventral posterolateral (body pain & temperature relay)
      733,  // VPM   — ventral posteromedial (face pain via trigeminal STT)
      362,  // MD    — mediodorsal nucleus (affective / autonomic pain dimension)
      // ── Intralaminar thalamic nuclei (arousal & diffuse cortical projection) ──
      575,  // CL    — central lateral nucleus
      599,  // CM    — central medial nucleus
      907,  // PCN   — paracentral nucleus
      930,  // PF    — parafascicular nucleus
      // ── Somatosensory cortex (higher-order termini) ───────────────────
      337,  // SSp-ll — primary somatosensory, lower limb
      369,  // SSp-ul — primary somatosensory, upper limb
      361,  // SSp-tr — primary somatosensory, trunk
      378,  // SSs   — supplemental somatosensory cortex
    ],
  },

  spcr: {
    color:   '#7060c8',
    label:   'Spinocerebellar',
    sub:     'Proprioception from spinal cord — origin not in Allen CCF',
    dir:     'aff', route: 'spinal', primary: 222,
    afferent_termini: [
      // ── Precerebellar relay nuclei ──────────────────────────────────────
      1039, // GR   — gracile nucleus (dorsal spinocerebellar collaterals)
      711,  // CU   — cuneate nucleus (cuneocerebellar via scp)
      903,  // ECU  — external cuneate nucleus (cuneocerebellar, forelimb)
      789,  // Z    — nucleus Z (proprioceptive relay)
      222,  // IO   — inferior olive (climbing fiber relay, spino-olivary)
      // ── Cerebellar cortex: vermis + paravermal anterior & posterior lobe ─
      // Lateral hemisphere, flocculonodular lobe, and deep nuclei excluded.
      976,  // CENT2 — lobule II (anterior lobe, vermis)
      992,  // CUL4  — culmen lobule IV (anterior lobe, vermis/paravermal)
      936,  // DEC   — declive / lobule VI (posterior lobe, vermis)
      957,  // UVU   — uvula / lobule IX (posterior vermis)
      1025, // PRM   — paramedian lobule (posterior paravermal)
    ],
  },

  // ── Descending spinal pathways ─────────────────────────────────────────────

  rst: {
    color:   '#5bafd4',
    label:   'Reticulospinal tract',
    sub:     'Descending motor & autonomic — spinal cord targets not in Allen CCF',
    dir:     'eff', route: 'spinal', primary: 795,
    efferent_origins: [
      // ── Mesencephalic reticular formation ────────────────────────────────
      795,  // PAG  — periaqueductal gray
      616,  // CUN  — cuneiform nucleus (dorsal mesencephalic locomotor region)
      1052, // PPN  — pedunculopontine nucleus (mesopontine tegmentum)
      128,  // MRN  — midbrain reticular nucleus (broader mesencephalic origin)
      // ── Pontine reticular formation ───────────────────────────────────────
      280,  // B    — Barrington's nucleus (pontine micturition center)
      146,  // PRNr — pontine reticular nucleus, rostral (oral pontine reticular)
      1093, // PRNc — pontine reticular nucleus, caudal (caudal pontine reticular)
      350,  // SLC  — subceruleus nucleus (coeruleospinal / A7 bulbospinal)
      // ── Medullary reticular formation ─────────────────────────────────────
      1048, // GRN  — gigantocellular reticular nucleus (primary medullary RST origin)
      978,  // PGRNl — paragigantocellular reticular nucleus, lateral
      1098, // MDRNd — medullary reticular nucleus, dorsal part
      1107, // MDRNv — medullary reticular nucleus, ventral part
    ],
  },

  vsp: {
    color:   '#c4a84a',
    label:   'Vestibulospinal tract',
    sub:     'Balance & postural control — spinal cord targets not in Allen CCF',
    dir:     'eff', route: 'spinal', primary: 217,
    efferent_origins: [
      225,  // SPIV — spinal vestibular nucleus (lateral VST origin)
      202,  // MV   — medial vestibular nucleus (medial VST origin)
      209,  // LAV  — lateral vestibular nucleus / Deiters' (lateral VST)
      217,  // SUV  — superior vestibular nucleus
    ],
  },

  trig: {
    color:   '#e0a050',
    label:   'Trigeminal sensory (CN V)',
    sub:     'Face & head mechanoreception — peripheral origin not in Allen CCF',
    dir:     'aff', route: 'cranial', primary: 429,
    afferent_termini: [
      429,  // SPVC — spinal trigeminal nucleus, caudalis
      437,  // SPVI — spinal trigeminal nucleus, interpolaris
      445,  // SPVO — spinal trigeminal nucleus, oralis
      7,    // PSV  — principal sensory trigeminal nucleus
      329,  // SSp-bfd — primary somatosensory, barrel field (whiskers)
      345,  // SSp-m  — primary somatosensory, mouth
      353,  // SSp-n  — primary somatosensory, nose
    ],
  },

  aud: {
    color:   '#70b870',
    label:   'Auditory (CN VIII)',
    sub:     'Cochlear input — hair cells not in Allen CCF',
    dir:     'aff', route: 'cranial', primary: 96,
    afferent_termini: [
      96,   // DCO  — dorsal cochlear nucleus
      101,  // VCO  — ventral cochlear nucleus
      1002, // AUDp — primary auditory cortex
    ],
  },

  visc: {
    color:   '#7090e0',
    label:   'Visceral / Gustatory (CN IX/X)',
    sub:     'Visceral afferents — peripheral origin not in Allen CCF',
    dir:     'aff', route: 'cranial', primary: 651,
    afferent_termini: [
      651,  // NTS  — nucleus of the solitary tract
      867,  // PB   — parabrachial nucleus (second-order relay)
    ],
  },

  hum: {
    color:   '#a07840',
    label:   'Homeostatic (CVO)',
    sub:     'Circumventricular organ inputs — blood-borne signals',
    dir:     'aff', route: 'cranial', primary: 286,
    afferent_termini: [
      338,  // SFO  — subfornical organ
      763,  // OV   — vascular organ of the lamina terminalis
      286,  // SCH  — suprachiasmatic nucleus
      223,  // ARH  — arcuate nucleus (hypothalamus)
      207,  // AP   — area postrema
    ],
  },

  // ── Motor cranial nerves ───────────────────────────────────────────────────
  // These project to peripheral muscles / glands — targets not in Allen CCF.
  // Listed as efferent outputs when their motor nuclei are selected.

  cn_iii: {
    color:   '#5090d0',
    label:   'Oculomotor (CN III)',
    sub:     'Extraocular muscles, levator palpebrae, pupil & lens — not in Allen CCF',
    dir:     'eff', route: 'cranial', primary: 35,
    efferent_origins: [
      975,  // EW   — Edinger-Westphal nucleus (parasympathetic)
      35,   // III  — oculomotor nucleus (somatic motor)
    ],
  },

  cn_iv: {
    color:   '#70a0b0',
    label:   'Trochlear (CN IV)',
    sub:     'Superior oblique muscle — not in Allen CCF',
    dir:     'eff', route: 'cranial', primary: 115,
    efferent_origins: [
      115,  // IV   — trochlear nucleus
    ],
  },

  cn_vm: {
    color:   '#c89050',
    label:   'Trigeminal motor (CN V)',
    sub:     'Masticatory muscles — masseter, temporalis, pterygoids — not in Allen CCF',
    dir:     'eff', route: 'cranial', primary: 621,
    efferent_origins: [
      621,  // V    — trigeminal motor nucleus
    ],
  },

  cn_vi: {
    color:   '#5070c0',
    label:   'Abducens (CN VI)',
    sub:     'Lateral rectus muscle — not in Allen CCF',
    dir:     'eff', route: 'cranial', primary: 653,
    efferent_origins: [
      653,  // VI   — abducens nucleus
    ],
  },

  cn_vii: {
    color:   '#c07060',
    label:   'Facial motor (CN VII)',
    sub:     'Facial expression muscles, stapedius — not in Allen CCF',
    dir:     'eff', route: 'cranial', primary: 661,
    efferent_origins: [
      661,  // VII  — facial nucleus (branchial motor)
      576,  // VIIIN — facial nerve intermediate (visceral motor)
    ],
  },

  cn_ix: {
    color:   '#9060a0',
    label:   'Glossopharyngeal / Vagal motor (CN IX/X)',
    sub:     'Pharyngeal & laryngeal muscles, visceral parasympathetics — not in Allen CCF',
    dir:     'eff', route: 'cranial', primary: 143,
    efferent_origins: [
      106,  // DMX  — dorsal motor nucleus of the vagus (parasympathetic)
      143,  // AMB  — nucleus ambiguus (branchial motor)
      839,  // AMBd — nucleus ambiguus, dorsal division
      939,  // AMBv — nucleus ambiguus, ventral division
    ],
  },

  cn_xii: {
    color:   '#60a060',
    label:   'Hypoglossal (CN XII)',
    sub:     'Tongue musculature — not in Allen CCF',
    dir:     'eff', route: 'cranial', primary: 773,
    efferent_origins: [
      773,  // XII  — hypoglossal nucleus
    ],
  },

  cn_ne: {
    color:   '#a07840',
    label:   'Neuroendocrine (hypothalamic)',
    sub:     'Anterior pituitary via portal system — not in Allen CCF',
    dir:     'eff', route: 'cranial', primary: 38,
    efferent_origins: [
      38,   // PVH  — paraventricular hypothalamic nucleus
      390,  // PVHd — paraventricular hypothalamic nucleus, descending
    ],
  },
};

// Reverse maps derived from TRACT_PROJECTION_SITES.
// Adding a region ID to any array above automatically populates these.
const REGION_KNOWN_AFFERENTS = new Map(); // regionId → [tractId, …]
const REGION_KNOWN_EFFERENTS = new Map(); // regionId → [tractId, …]
for (const [tid, sites] of Object.entries(TRACT_PROJECTION_SITES)) {
  for (const rid of (sites.afferent_termini || [])) {
    if (!REGION_KNOWN_AFFERENTS.has(rid)) REGION_KNOWN_AFFERENTS.set(rid, []);
    REGION_KNOWN_AFFERENTS.get(rid).push(tid);
  }
  for (const rid of (sites.efferent_origins || [])) {
    if (!REGION_KNOWN_EFFERENTS.has(rid)) REGION_KNOWN_EFFERENTS.set(rid, []);
    REGION_KNOWN_EFFERENTS.get(rid).push(tid);
  }
}

// Motor cranial nerve + neuroendocrine nucleus → band id
const NUCLEUS_TO_MOTOR_CN = new Map([
  [35, 'mcn-iii'], [975, 'mcn-iii'],
  [115, 'mcn-iv'],
  [621, 'mcn-v'],
  [653, 'mcn-vi'],
  [661, 'mcn-vii'], [576, 'mcn-vii'],
  [106, 'mcn-ix'], [143, 'mcn-ix'], [839, 'mcn-ix'], [939, 'mcn-ix'],
  [773, 'mcn-xii'],
  [38, 'mcn-ne'], [390, 'mcn-ne'],
]);

// Primary nucleus to select when clicking a motor CN band
const MOTOR_CN_PRIMARY = {
  'mcn-iii': 35, 'mcn-iv': 115, 'mcn-v': 621, 'mcn-vi': 653,
  'mcn-vii': 661, 'mcn-ix': 143, 'mcn-xii': 773, 'mcn-ne': 38,
};

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

  // Tract ID → pathway SVG element ID
  const TRACT_SVG_IDS = { 784: 'tract-cst', 863: 'tract-rust', 877: 'tract-tsp', 855: 'tract-rst', 941: 'tract-vsp' };

  // Light up the pathway schematic based on the selected region's efferent tract strengths.
  // Opacity and stroke-width scale together from the weakest (0.08 / 1.5px) to the
  // strongest (1.0 / 5.5px) tract for this region, so contrast is preserved even when
  // all three values are small in absolute terms.
  // Auto-open threshold: if any tract connection is ≥ 10% of the region's overall
  // local max, the pathway panel opens automatically.
  const PATHWAY_OPEN_THRESHOLD = 0.10;

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

  // Which route to auto-show for each ascending pathway (direction is always 'aff')
  const PATHWAY_ROUTE = { dcml: 'spinal', als: 'spinal', spcr: 'spinal' };

  // ── Ascending panel interaction ────────────────────────────────────────────

  function clearAscendingPanel() {
    document.querySelectorAll('.asc-band-visual').forEach(el => {
      el.setAttribute('opacity', '0.15');
      el.setAttribute('stroke-width', '1.5');
    });
    document.querySelectorAll('.asc-dot').forEach(el => {
      el.setAttribute('opacity', el.r?.baseVal?.value > 5 ? '0.55' : '0.45');
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
      el.setAttribute('opacity', pathwayId
        ? (isThis ? '1.0' : match ? '0.65' : '0.1')
        : (el.r?.baseVal?.value > 5 ? '0.55' : '0.45'));
    });
    if (pathwayId) {
      openPathwayPanel();
      switchToCombo('aff', PATHWAY_ROUTE[pathwayId] || 'cranial');
    }
  }

  // Ascending nucleus dots → select that region
  document.querySelectorAll('.asc-dot').forEach(dot => {
    dot.addEventListener('click', e => {
      e.stopPropagation();
      selectRegion(Number(dot.dataset.nucleusId));
    });
  });

  // Ascending band hit areas → select primary relay nucleus
  document.querySelectorAll('.asc-band-hit').forEach(band => {
    const pw = ASCENDING_PATHWAYS.find(p => p.id === band.dataset.pathway);
    if (pw) band.addEventListener('click', e => { e.stopPropagation(); selectRegion(pw.primary); });
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

  // Motor CN band hit areas → select primary nucleus
  document.querySelectorAll('.motor-cn-band-hit').forEach(band => {
    const primary = MOTOR_CN_PRIMARY[band.dataset.band];
    if (primary) band.addEventListener('click', e => { e.stopPropagation(); selectRegion(primary); });
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

  // Origin dots: only those with data-has-data="true" get click handlers.
  document.querySelectorAll('.pwy-origin-dot[data-has-data="true"]').forEach(dot => {
    dot.addEventListener('click', e => { e.stopPropagation(); selectRegion(Number(dot.dataset.tractId)); });
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

  // ── Interaction state ──────────────────────────────────────────────────────

  let selected = null;
  let mode     = 'efferent';  // 'efferent' | 'afferent'
  let metric   = 'relative';  // 'relative' | 'absolute'

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
      item.addEventListener('click', e => {
        e.stopPropagation();
        openPathwayPanel();
        switchToCombo(sites.dir || 'aff', sites.route || 'cranial');
        if (sites.primary) selectRegion(sites.primary);
      });
      knownList.appendChild(item);
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
    paths.classed('dimmed', false).classed('selected', false).style('opacity', null).style('stroke-width', null);
    selected = null;
    clearPathwayPanel();
    clearAscendingPanel();
    clearMotorCNPanel();
  }

  // Consolidates map-click and panel-click selection paths.
  function selectRegion(allenId) {
    if (TRACT_IDS.has(allenId)) {
      // Tracts are projection targets only — check whether any brain regions project into this tract.
      const projMap = metric === 'relative' ? projMapRel : projMapAbs;
      if (!projMap[allenId]?.length) {
        deselect();
        showNoDataInfo(metadata[allenId] || {}, NO_DATA_REASONS[allenId] || DEFAULT_NO_DATA);
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
      showNoDataInfo(metadata[allenId] || {}, NO_DATA_REASONS[allenId] || DEFAULT_NO_DATA);
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
