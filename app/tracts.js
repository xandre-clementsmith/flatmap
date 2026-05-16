// Tract and pathway data — all pure constants, no DOM or D3 dependencies.
//
// To add a region to a tract's known connections:
//   append its CCF ID to afferent_termini (region receives the pathway)
//   or efferent_origins (region sends the pathway).
//   The reverse-lookup maps (REGION_KNOWN_AFFERENTS / EFFERENTS) are derived
//   automatically at the bottom of this file.

// ── Fiber tract CCF IDs ───────────────────────────────────────────────────────

export const TRACT_IDS = new Set([784, 863, 877, 855, 941]);

// Maps tract fiber Allen CCF ID → TRACT_PROJECTION_SITES key.
export const TRACT_FIBER_TO_KEY = { 784: 'cst', 863: 'rust', 877: 'tsp', 855: 'rst', 941: 'vsp' };

// Distinct colors for each tract — used in connection list bars and the pathway schematic.
export const TRACT_COLORS = {
  784: '#4ab5a0',  // cst  — teal-green
  863: '#d4894a',  // rust — amber
  877: '#9370cc',  // tsp  — violet
  855: '#5bafd4',  // rst  — sky blue
  941: '#c4a84a',  // vsp  — gold
};

// ── Why-no-data explanations ──────────────────────────────────────────────────
// Shown in the info panel when clicking a region with no injection data.
// Keyed by Allen CCF ID.

export const NO_DATA_REASONS = {
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

export const DEFAULT_NO_DATA = {
  label: 'No injection data',
  text:  'This region has no injection experiments in the Allen Mouse Brain Connectivity Atlas.',
};

// ── Ascending pathways ────────────────────────────────────────────────────────
// Each pathway maps to its first-order relay nuclei in the Allen CCF.
// 'primary' is the nucleus selected when clicking the pathway band.

export const ASCENDING_PATHWAYS = [
  { id: 'olf',  color: '#b060a0', nuclei: [507, 151, 159],           primary: 507  }, // MOB, AOB, AON
  { id: 'vis',  color: '#c0a030', nuclei: [170, 178, 851, 842, 628], primary: 170  }, // LGd, LGv, SCop, SCsg, NOT
  { id: 'vest', color: '#60c0c0', nuclei: [225, 202, 209, 217, 968],  primary: 225  }, // SPIV, MV, LAV, SUV, NOD
  { id: 'dcml', color: '#e07070', nuclei: [1039, 711, 789],          primary: 1039 }, // GR, CU, Z
  { id: 'als',  color: '#d4604a', nuclei: [718, 733, 362, 575, 599, 907, 930, 795, 811, 842, 147, 283, 350, 867, 651, 978], primary: 718  },
  { id: 'spcr', color: '#7060c8', nuclei: [83, 903, 955, 963, 912, 976, 984, 1091, 1007, 936, 944, 951, 957, 1033, 1025], primary: 83 }, // IO, ECU, LRN, cerebellar lobules
  { id: 'trig', color: '#e0a050', nuclei: [429, 437, 445, 7],        primary: 429  }, // SPVC, SPVI, SPVO, PSV
  { id: 'aud',  color: '#70b870', nuclei: [96, 101, 811, 1072, 1079, 1088], primary: 96 }, // DCO, VCO, ICc, MG*
  { id: 'visc', color: '#7090e0', nuclei: [651, 867],                primary: 651  }, // NTS, PB
  { id: 'hum',  color: '#a07840', nuclei: [338, 763, 286, 223, 207], primary: 286  }, // SFO, OV, SCH, ARH, AP
];

export const NUCLEUS_TO_ASCENDING = new Map();
for (const pw of ASCENDING_PATHWAYS) {
  for (const nid of pw.nuclei) NUCLEUS_TO_ASCENDING.set(nid, pw.id);
}

// ── Tract projection sites ────────────────────────────────────────────────────
// Single source of truth for all anatomically known but Allen-unmeasured connections.
// Each entry carries display metadata (color, label, sub) and pathway-panel routing
// (dir/route/primary), plus region lists:
//   afferent_termini  — CCF IDs of regions where this tract terminates
//   efferent_origins  — CCF IDs of regions where this tract originates

export const TRACT_PROJECTION_SITES = {

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
    label:   'DCML',
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
    dir:     'aff', route: 'spinal', primary: 83,
    afferent_termini: [
      // ── Precerebellar relay nuclei ──────────────────────────────────────
      1039, // GR   — gracile nucleus (dorsal spinocerebellar collaterals)
      711,  // CU   — cuneate nucleus (cuneocerebellar via scp)
      903,  // ECU  — external cuneate nucleus (cuneocerebellar, forelimb)
      789,  // Z    — nucleus Z (proprioceptive relay)
      83,   // IO   — inferior olivary complex (spino-olivary → climbing fibres)
      955,  // LRNm — lateral reticular nucleus, magnocellular (spino-reticulo-cerebellar)
      963,  // LRNp — lateral reticular nucleus, parvicellular
      // ── Cerebellar cortex: all vermis lobules I–IX + paravermal ─────────
      912,  // LING  — lingula (lobule I)
      976,  // CENT2 — lobule II
      984,  // CENT3 — lobule III
      1091, // CUL4_5 — culmen lobules IV–V (primary DSCT/VSCT target)
      1007, // SIM   — simple lobule (lobule VI, paravermal junction)
      936,  // DEC   — declive (lobule VI, posterior vermis)
      944,  // FOTU  — folium-tuber vermis (lobule VII)
      951,  // PYR   — pyramis (lobule VIII)
      957,  // UVU   — uvula (lobule IX)
      1033, // COPY  — copula pyramidis (paravermal posterior lobe)
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
      307,  // MARN — magnocellular reticular nucleus (ventromedial pontine RF)
      // ── Medullary reticular formation ─────────────────────────────────────
      1048, // GRN   — gigantocellular reticular nucleus (primary medullary RST origin)
      136,  // IRN   — intermediate reticular nucleus (medullary RST component)
      970,  // PGRNd — paragigantocellular reticular, dorsal part
      978,  // PGRNl — paragigantocellular reticular, lateral part
      1098, // MDRNd — medullary reticular nucleus, dorsal part
      1107, // MDRNv — medullary reticular nucleus, ventral part
      // ── Serotonergic raphespinal (functionally grouped with RST) ─────────
      230,  // RPA   — raphe pallidus (primary serotonergic RST component)
      222,  // RO    — raphe obscurus (additional serotonergic bulbospinal)
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
      63,   // PVHd — paraventricular hypothalamic nucleus, descending division
    ],
  },
};

// ── Derived reverse-lookup maps ───────────────────────────────────────────────
// Built automatically from TRACT_PROJECTION_SITES — do not edit by hand.

export const REGION_KNOWN_AFFERENTS = new Map(); // regionId → [tractKey, …]
export const REGION_KNOWN_EFFERENTS = new Map(); // regionId → [tractKey, …]

for (const [tid, sites] of Object.entries(TRACT_PROJECTION_SITES)) {
  for (const rid of (sites.afferent_termini || [])) {
    (REGION_KNOWN_AFFERENTS.get(rid) ?? REGION_KNOWN_AFFERENTS.set(rid, []).get(rid)).push(tid);
  }
  for (const rid of (sites.efferent_origins || [])) {
    (REGION_KNOWN_EFFERENTS.get(rid) ?? REGION_KNOWN_EFFERENTS.set(rid, []).get(rid)).push(tid);
  }
}

// ── Motor cranial nerve maps ──────────────────────────────────────────────────

export const NUCLEUS_TO_MOTOR_CN = new Map([
  [35, 'mcn-iii'], [975, 'mcn-iii'],
  [115, 'mcn-iv'],
  [621, 'mcn-v'],
  [653, 'mcn-vi'],
  [661, 'mcn-vii'], [576, 'mcn-vii'],
  [106, 'mcn-ix'], [143, 'mcn-ix'], [839, 'mcn-ix'], [939, 'mcn-ix'],
  [773, 'mcn-xii'],
  [38, 'mcn-ne'], [63, 'mcn-ne'],
]);

// Motor CN band id → TRACT_PROJECTION_SITES key
export const BAND_TO_TRACT_KEY = {
  'mcn-iii': 'cn_iii', 'mcn-iv': 'cn_iv', 'mcn-v': 'cn_vm',
  'mcn-vi': 'cn_vi', 'mcn-vii': 'cn_vii', 'mcn-ix': 'cn_ix',
  'mcn-xii': 'cn_xii', 'mcn-ne': 'cn_ne',
};

export const TRACT_KEY_TO_BAND = Object.fromEntries(
  Object.entries(BAND_TO_TRACT_KEY).map(([bandId, tractKey]) => [tractKey, bandId])
);

// Which route to auto-show for each ascending pathway (direction is always 'aff')
export const PATHWAY_ROUTE = { dcml: 'spinal', als: 'spinal', spcr: 'spinal' };

// Opacity and stroke-width scale from weakest to strongest tract connection.
// Auto-open threshold: if any tract connection is ≥ 10% of the region's local max,
// the pathway panel opens automatically.
export const PATHWAY_OPEN_THRESHOLD = 0.10;

// SVG element IDs for the five spinal tract lines in the pathway schematic.
export const TRACT_SVG_IDS = { 784: 'tract-cst', 863: 'tract-rust', 877: 'tract-tsp', 855: 'tract-rst', 941: 'tract-vsp' };
