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
// Clicking a tract fiber routes to showTractInfo rather than showing Allen fiber-of-passage data.
const TRACT_IDS = new Set([784, 863, 877, 855, 941]);

// Maps tract fiber Allen CCF ID → TRACT_PROJECTION_SITES key.
const TRACT_FIBER_TO_KEY = { 784: 'cst', 863: 'rust', 877: 'tsp', 855: 'rst', 941: 'vsp' };

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


// Glow stubs — assigned inside main() once the D3 paths selection exists.
// Declared at module level so top-level functions (showInfo, etc.) can call them.
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

const REGION_DESCRIPTIONS = {
  // ── Isocortex ──────────────────────────────────────────────────────────────
  16:  "Layer 6b of the isocortex. The deepest neocortical layer; projects to the claustrum and thalamic reticular nucleus and coordinates thalamocortical dialogue.",
  39:  "Anterior cingulate area, dorsal part. Involved in cognitive control, attention, error monitoring, and conflict resolution; a key node of the prefrontal executive network.",
  48:  "Anterior cingulate area, ventral part. Processes affective and motivational aspects of pain and decision-making; strongly connected to the amygdala and hypothalamus.",
  104: "Agranular insular area, dorsal part. Receives somatic and motor signals; involved in interoception, motor preparation, and sensory-motor integration.",
  111: "Agranular insular area, posterior part. Integrates visceral, taste, and somatic information; important for body-state awareness and autonomic regulation.",
  119: "Agranular insular area, ventral part. Involved in gustatory and visceral processing; contributes to the affective valuation of interoceptive and sensory stimuli.",
  1011:"Dorsal auditory area. Higher-order auditory cortex involved in auditory object recognition and spatial processing.",
  1002:"Primary auditory cortex. Receives tonotopic thalamic input from MGv; performs frequency-specific spectrotemporal analysis of sound.",
  1027:"Posterior auditory area. Higher-order auditory cortex involved in processing complex acoustic features and auditory memory.",
  1018:"Ventral auditory area. Secondary auditory cortex involved in auditory integration and discrimination.",
  814: "Dorsal peduncular area. A medial prefrontal region projecting heavily to hypothalamus and brainstem; involved in visceral and autonomic regulation.",
  895: "Ectorhinal area. Parahippocampal cortex receiving polymodal sensory input; an intermediate relay conveying processed sensory information to the entorhinal cortex.",
  918: "Entorhinal area, lateral part. Primary cortical gateway to the hippocampus; receives multimodal sensory input and provides the main perforant path input to the dentate gyrus.",
  926: "Entorhinal area, medial part (dorsal zone). Encodes spatial and contextual information; integrates self-motion signals and contains grid cells critical for navigation.",
  934: "Entorhinal area, medial part (ventral zone). Part of the parahippocampal region; involved in spatial and contextual encoding alongside the dorsal medial entorhinal cortex.",
  1057:"Gustatory areas. Receive taste signals relayed via VPMpc thalamus; integrate flavor, texture, and hedonic information to guide ingestion decisions.",
  44:  "Infralimbic area. A ventromedial prefrontal region involved in habit formation, fear extinction, and autonomic regulation; strongly connected to amygdala, hypothalamus, and brainstem.",
  985: "Primary motor cortex. Directly controls voluntary movement via corticospinal projections; organized somatotopically with the hindlimb medial and forelimb lateral.",
  993: "Secondary motor cortex. Involved in motor planning, sequencing, and coordination; projects to primary motor cortex and directly to spinal cord.",
  731: "Orbital area, medial part. Part of orbitofrontal cortex; encodes reward value and expected outcomes; critical for flexible, value-guided decision-making.",
  723: "Orbital area, lateral part. Part of orbitofrontal cortex; integrates sensory qualities with reward history; involved in credit assignment and reversal learning.",
  738: "Orbital area, ventral part. Part of orbitofrontal cortex involved in olfactory and taste processing and reward-based evaluation of food stimuli.",
  746: "Orbital area, ventrolateral part. Part of orbitofrontal cortex integrating multimodal sensory information for reward-guided behavior.",
  922: "Perirhinal area. Parahippocampal cortex essential for object recognition memory and novelty detection; provides processed sensory input to entorhinal cortex.",
  961: "Piriform area. Primary olfactory cortex; receives direct mitral cell input from the olfactory bulb and encodes odor identity.",
  972: "Prelimbic area. Dorsomedial prefrontal cortex involved in working memory, fear expression, and goal-directed decision-making; projects to striatum, amygdala, and hypothalamus.",
  879: "Retrosplenial area, dorsal part. Involved in spatial navigation, contextual memory, and integration of allocentric and egocentric reference frames.",
  886: "Retrosplenial area, ventral part. Involved in spatial and contextual memory consolidation; bridges hippocampal and neocortical memory systems.",
  894: "Retrosplenial area, lateral agranular part. Part of retrosplenial cortex; participates in spatial processing and head-direction signal integration.",
  329: "Primary somatosensory area, barrel field. Processes whisker-related tactile information; each barrel corresponds to a single facial whisker, making this a model for cortical topographic organization.",
  337: "Primary somatosensory area, lower limb. Processes tactile and proprioceptive input from the hindlimb.",
  345: "Primary somatosensory area, mouth. Processes orofacial somatosensory input including touch and pressure around the mouth.",
  353: "Primary somatosensory area, nose. Processes nasal tactile input relayed from the trigeminal system.",
  361: "Primary somatosensory area, trunk. Processes somatosensory input from the body trunk and thorax.",
  369: "Primary somatosensory area, upper limb. Processes tactile and proprioceptive input from the forelimb.",
  378: "Supplemental somatosensory area. Secondary somatosensory cortex integrating bilateral somatosensory information; contributes to tactile discrimination and cross-modal processing.",
  541: "Temporal association areas. Multimodal association cortex involved in object recognition, auditory processing, and long-term declarative memory.",
  677: "Visceral area. Receives interoceptive visceral input relayed via thalamus; integrates body-state signals and participates in autonomic regulation.",
  312782546: "Anterior visual area. Higher-order visual cortex processing optic flow and wide-field motion; involved in visual navigation.",
  402: "Anterolateral visual area. Higher-order visual cortex; processes motion and spatial relationships in the visual scene.",
  394: "Anteromedial visual area. Higher-order visual cortex integrating motion and spatial navigation signals; strongly connected to posterior parietal cortex.",
  409: "Lateral visual area. Secondary visual cortex processing visual detail and object features.",
  385: "Primary visual cortex. First cortical processing stage of vision; receives direct retinotopic input from the dorsal lateral geniculate nucleus; encodes orientation, spatial frequency, and contrast.",
  425: "Posterolateral visual area. Higher-order visual cortex involved in visuospatial processing.",
  533: "Posteromedial visual area. Higher-order visual area involved in spatial processing and visual navigation.",
  417: "Rostrolateral visual area. Higher-order visual cortex; part of the rodent visual cortical hierarchy.",

  // ── Hippocampal formation ──────────────────────────────────────────────────
  382: "Field CA1 of the hippocampus. Critical for episodic memory encoding and spatial map representation; receives Schaffer collateral input from CA3 and projects via the subiculum to entorhinal cortex and prefrontal cortex.",
  423: "Field CA2 of the hippocampus. Involved in social memory and temporal context coding; receives unique inputs from the supramammillary nucleus and entorhinal cortex; highly resistant to excitotoxic insult.",
  463: "Field CA3 of the hippocampus. Receives mossy fiber input from the dentate gyrus; performs pattern completion via recurrent collaterals; rapidly encodes new associative memories.",
  726: "Dentate gyrus. Performs pattern separation of cortical inputs before transmitting them to CA3; generates new granule cells throughout adult life (adult neurogenesis), contributing to memory clearance and context discrimination.",
  502: "Subiculum. Main output of the hippocampus; projects to entorhinal cortex, mammillary bodies, prefrontal cortex, and nucleus accumbens; involved in spatial navigation and memory retrieval.",
  1084:"Presubiculum. Receives strong head-direction signals from the thalamus; important for maintaining the spatial orientation framework used by entorhinal grid cells.",
  1037:"Postsubiculum. Contains head-direction cells; provides orientation signals to the entorhinal cortex and other parahippocampal structures critical for navigation.",
  843: "Parasubiculum. Part of the parahippocampal region; contains grid cells and border cells; contributes to the spatial metric used in navigation.",
  982: "Fasciola cinerea. A rudimentary cortical strip of the hippocampal formation overlying the dentate gyrus.",
  19:  "Induseum griseum. A vestigial cortical structure overlying the dorsal corpus callosum; considered a rudimentary part of the hippocampal formation.",

  // ── Amygdala ───────────────────────────────────────────────────────────────
  303: "Basolateral amygdalar nucleus, anterior part. A key site for fear conditioning and reward learning; receives sensory cortex and thalamic inputs; projects to prefrontal cortex, striatum, and central amygdala.",
  311: "Basolateral amygdalar nucleus, posterior part. Processes aversive and emotionally salient stimuli; projects to the central amygdala to drive fear responses.",
  451: "Basolateral amygdalar nucleus, ventral part. Part of the basolateral complex involved in emotional memory and reward; projects to prefrontal cortex and ventral striatum.",
  327: "Basomedial amygdalar nucleus, anterior part. Receives olfactory input and projects to hypothalamus; involved in olfactory-based social and emotional responses.",
  334: "Basomedial amygdalar nucleus, posterior part. Processes pheromone and olfactory signals; contributes to species-specific social and reproductive behavior.",
  544: "Central amygdalar nucleus, capsular part. Part of the central amygdala output system; involved in regulating behavioral and autonomic fear responses.",
  551: "Central amygdalar nucleus, lateral part. Receives input from the basolateral amygdala; serves as an integration zone for fear acquisition and modulation.",
  559: "Central amygdalar nucleus, medial part. Primary output of the amygdala to brainstem fear circuits; controls freezing behavior, analgesia, and autonomic stress responses.",
  403: "Medial amygdalar nucleus. Receives pheromone input from the accessory olfactory bulb; critical for sex-specific and species-specific social, territorial, and reproductive behavior.",
  131: "Lateral amygdalar nucleus. The initial site of Pavlovian fear conditioning; receives thalamic and cortical sensory inputs and transmits fear-related associations to the basal nucleus.",
  639: "Cortical amygdalar area, anterior part. Receives direct olfactory bulb input; involved in olfactory processing and odor-guided behavior.",
  655: "Cortical amygdalar area, posterior lateral zone. Processes olfactory information; contributes to chemosensory-based social and reproductive behavior.",
  663: "Cortical amygdalar area, posterior medial zone. Receives accessory olfactory bulb input; involved in pheromone processing and reproductive behavior regulation.",
  780: "Posterior amygdalar nucleus. Receives auditory and somatosensory input; part of the amygdaloid complex involved in multimodal sensory integration and defensive behaviors.",
  788: "Piriform-amygdalar area. Transition zone between piriform cortex and the amygdala; receives direct olfactory bulb input.",
  23:  "Anterior amygdalar area. Transitional zone at the anterior pole of the amygdala; receives olfactory and other sensory inputs.",
  292: "Bed nucleus of the accessory olfactory tract. Small nucleus associated with the accessory olfactory system and pheromone signal processing.",
  1105:"Intercalated amygdalar nucleus. Small clusters of GABAergic neurons situated between the basolateral and central amygdala; gate information transfer and are critical for fear extinction.",

  // ── Striatum and basal ganglia ─────────────────────────────────────────────
  672: "Caudoputamen. Dorsal striatum; the main input nucleus of the basal ganglia for motor control; involved in habit formation and procedural learning. Receives dopaminergic input from SNc and massive cortical glutamatergic input.",
  56:  "Nucleus accumbens. Ventral striatum; the core interface between limbic and motor systems; critical for reward processing, motivation, and reinforcement learning. Receives dopamine from VTA and converging input from prefrontal cortex, hippocampus, and amygdala.",
  754: "Olfactory tubercle. Part of the ventral striatum; receives olfactory and dopaminergic input; integrates olfactory signals with motivational state.",
  998: "Fundus of striatum. Transition zone at the base of the striatum connecting dorsal and ventral striatal territories.",
  1022:"Globus pallidus, external segment. Part of the indirect basal ganglia pathway; inhibits the subthalamic nucleus and serves as an integration hub in basal ganglia circuitry.",
  1031:"Globus pallidus, internal segment. Primary output nucleus of the basal ganglia via thalamus; tonically inhibits the motor thalamus to gate movement; receives direct and indirect pathway convergence.",
  470: "Subthalamic nucleus. The only glutamatergic nucleus in the basal ganglia; part of the indirect pathway providing excitatory drive to GPi; a clinically critical target for deep brain stimulation in Parkinson's disease.",
  374: "Substantia nigra, compact part. Contains dopaminergic neurons of the nigrostriatal pathway projecting to the dorsal striatum; encodes reward prediction errors; degeneration of these neurons is the hallmark of Parkinson's disease.",
  381: "Substantia nigra, reticular part. Shares circuitry with GPi as an output nucleus of the basal ganglia; tonically inhibits the superior colliculus and thalamus to gate saccadic eye movements and voluntary movement.",

  // ── Thalamus ───────────────────────────────────────────────────────────────
  64:  "Anterodorsal nucleus. Part of the anterior thalamic group; contains robust head-direction cells; a critical node in the circuit for spatial orientation and navigation.",
  255: "Anteroventral nucleus. Part of the anterior thalamic group; part of the Papez circuit; involved in episodic memory and spatial navigation via reciprocal connections with hippocampus and cingulate cortex.",
  575: "Central lateral nucleus. Intralaminar thalamic nucleus; involved in arousal, attention, and motor control; projects broadly to striatum and cortex.",
  599: "Central medial nucleus. Intralaminar thalamic nucleus projecting broadly to striatum and cerebral cortex; involved in attention, arousal, and sensorimotor gating.",
  59:  "Intermediodorsal nucleus. Medial thalamic nucleus projecting to prefrontal cortex and striatum; involved in memory and limbic functions.",
  1113:"Interanterodorsal nucleus. Part of the anterior thalamic complex involved in spatial memory and limbic circuits.",
  1120:"Interanteromedial nucleus. Part of the anterior thalamic complex; contributes to spatial memory and the Papez memory circuit.",
  27:  "Intergeniculate leaflet. Part of the lateral geniculate complex; contains neuropeptide Y neurons that receive retinal input; involved in non-image-forming visual functions including circadian photoentrainment.",
  155: "Lateral dorsal nucleus. Anterior thalamic group nucleus; contains head-direction cells; involved in spatial navigation and memory as part of the extended hippocampal system.",
  170: "Dorsal lateral geniculate nucleus. Primary visual thalamic relay; transmits retinotopic signals from the retina to primary visual cortex; organized in laminae corresponding to different retinal ganglion cell types.",
  178: "Ventral lateral geniculate nucleus. Non-image-forming visual nucleus; involved in circadian rhythm regulation, photic modulation of locomotion, and pupillary responses.",
  186: "Lateral habenula. Part of the habenular complex involved in aversive signaling; inhibits midbrain dopamine neurons in response to absent or unexpected rewards, encoding negative prediction errors.",
  218: "Lateral posterior nucleus. Higher-order thalamic nucleus receiving superior colliculus input; involved in visuospatial processing and multisensory integration; projects to posterior parietal and visual association cortex.",
  362: "Mediodorsal nucleus. Main thalamic relay to the prefrontal cortex; involved in working memory, attention, and cognitive control; functionally linked to cognitive aspects of basal ganglia output.",
  1072:"Medial geniculate complex, dorsal part. Higher-order auditory thalamic nucleus involved in multimodal integration and auditory fear conditioning.",
  1088:"Medial geniculate complex, medial part. Multimodal thalamic nucleus receiving auditory, somatosensory, and pain inputs; projects broadly to amygdala and cortex; involved in auditory fear learning and arousal.",
  1079:"Medial geniculate complex, ventral part. Primary auditory thalamic relay; transmits tonotopically organized signals from the inferior colliculus to primary auditory cortex.",
  483: "Medial habenula. Part of the habenular complex; contains substance P and acetylcholine neurons; projects via the fasciculus retroflexus to the interpeduncular nucleus; involved in stress responses, anxiety, aversion, and mood regulation.",
  907: "Paracentral nucleus. Intralaminar thalamic nucleus involved in nociception, arousal, and motor control.",
  930: "Parafascicular nucleus. Intralaminar thalamic nucleus; projects to striatum and cortex; involved in attention, nociception, and motor sequence learning.",
  1020:"Posterior complex of the thalamus. Higher-order thalamic nucleus receiving nociceptive and somatosensory input from the spinal cord; projects to somatosensory and insular cortex.",
  1029:"Posterior limiting nucleus of the thalamus. Part of the posterior thalamic complex; involved in multisensory processing.",
  15:  "Parataenial nucleus. Small anterior thalamic nucleus projecting to striatum and limbic cortex; involved in limbic and motivational functions.",
  149: "Paraventricular nucleus of the thalamus. Midline thalamic nucleus projecting heavily to nucleus accumbens, amygdala, and prefrontal cortex; a critical relay for stress signals, arousal states, and limbic-striatal integration.",
  181: "Nucleus of reuniens. Midline thalamic nucleus interconnecting the hippocampus and medial prefrontal cortex; involved in working memory, spatial navigation, and extinction of conditioned fear.",
  189: "Rhomboid nucleus. Midline thalamic nucleus projecting to prefrontal cortex and striatum; involved in limbic and cognitive functions.",
  262: "Reticular nucleus of the thalamus. Inhibitory GABAergic nucleus surrounding the thalamus; gates thalamic relay by sending feedback inhibition; critical for thalamocortical oscillations, selective attention, and sleep spindles.",
  366: "Submedial nucleus of the thalamus. Part of the ventral thalamic group involved in processing orofacial nociceptive information.",
  629: "Ventral anterior-lateral complex. Motor thalamus receiving convergent output from basal ganglia and cerebellum; projects to motor and premotor cortex to coordinate movement.",
  685: "Ventral medial nucleus. Motor thalamus receiving basal ganglia (GPi/SNr) output; projects to motor cortex and striatum; involved in gating voluntary movement initiation.",
  718: "Ventral posterolateral nucleus. Somatosensory relay for the body; receives medial lemniscal and spinothalamic tract input; projects topographically to primary somatosensory cortex.",
  725: "Ventral posterolateral nucleus, parvicellular part. Somatosensory thalamic subdivision for deep tissue and proprioceptive signals from the body.",
  733: "Ventral posteromedial nucleus. Somatosensory relay for the face; receives trigeminal (medial lemniscal) input; projects to the barrel cortex and face area of somatosensory cortex.",
  741: "Ventral posteromedial nucleus, parvicellular part. Relays gustatory information from the nucleus of the solitary tract to the gustatory cortex.",
  325: "Suprageniculate nucleus. Thalamic nucleus receiving auditory and somatosensory input; involved in multisensory processing and projects to amygdala.",
  321: "Subgeniculate nucleus. Small thalamic nucleus located beneath the lateral geniculate; involved in visual thalamic processing.",
  367: "TBD",

  // ── Septal area ────────────────────────────────────────────────────────────
  564: "Medial septal nucleus. Contains cholinergic and GABAergic neurons projecting to the hippocampus; paces the hippocampal theta rhythm; critical for spatial memory, attention, and navigation.",
  250: "Lateral septal nucleus, caudal part. Receives hippocampal output via the fornix; involved in stress responses, anxiety regulation, and social behavior.",
  258: "Lateral septal nucleus, rostral part. Processes hippocampal output; involved in stress responses, aggression, and social recognition memory.",
  266: "Lateral septal nucleus, ventral part. Involved in autonomic and neuroendocrine regulation; projects to hypothalamic areas controlling HPA axis activity.",
  596: "Diagonal band nucleus. Contains cholinergic neurons projecting to hippocampus and olfactory bulb; important for attention, memory, and olfactory processing.",
  310: "Septofimbrial nucleus. Part of the septal area involved in hippocampo-septal interactions and limbic memory circuitry.",
  333: "Septohippocampal nucleus. Part of the septal complex containing cholinergic neurons involved in regulating hippocampal activity.",
  581: "Triangular nucleus of septum. Small septal nucleus projecting to hypothalamus.",
  287: "Bed nucleus of the anterior commissure. Small nucleus associated with the anterior commissure involved in limbic circuitry.",
  351: "Bed nuclei of the stria terminalis. Extended amygdala structure integrating limbic input to regulate autonomic and neuroendocrine stress responses; involved in anxiety, fear, and social behavior.",
  50:  "Precommissural nucleus. Small nucleus in the septal region associated with the anterior commissure; TBD specific function.",

  // ── Hypothalamus ───────────────────────────────────────────────────────────
  72:  "Anterodorsal preoptic nucleus. Part of the preoptic area; involved in thermoregulation and sleep regulation.",
  80:  "Anterior hypothalamic area. Involved in temperature regulation, defensive behavior, and integration of homeostatic stress responses.",
  88:  "Anterior hypothalamic nucleus. Involved in thermoregulation and defensive behaviors; integrates somatosensory and stress signals.",
  223: "Arcuate hypothalamic nucleus. Contains key neuroendocrine and metabolic neurons including NPY/AgRP (hunger-promoting) and POMC/CART (satiety-promoting) neurons; regulates food intake, energy balance, growth hormone release, and reproduction.",
  263: "Anteroventral preoptic nucleus. Part of the preoptic area involved in sleep regulation, thermoregulation, and reproductive behavior.",
  272: "Anteroventral periventricular nucleus. Sexually dimorphic nucleus in the preoptic region; critical for generating the preovulatory LH surge that triggers ovulation.",
  830: "Dorsomedial hypothalamic nucleus. Involved in circadian control of feeding, body weight, and stress responses; projects to brainstem autonomic centers and regulates sympathetic outflow.",
  804: "Fields of Forel. Fiber tracts and associated neurons at the junction of the hypothalamus and midbrain; involved in motor coordination and relay between midbrain tegmentum and hypothalamus.",
  194: "Lateral hypothalamic area. Contains orexin/hypocretin and melanin-concentrating hormone neurons; regulates arousal, feeding, sleep-wake transitions, and reward; projects throughout the brain.",
  210: "Lateral mammillary nucleus. Part of the mammillary body; receives head-direction signals from the dorsal tegmental nucleus; involved in spatial navigation.",
  452: "Median preoptic nucleus. Involved in thermoregulation, fluid homeostasis, and sleep; contains osmosensitive neurons that relay signals to vasopressin-producing cells.",
  491: "Medial mammillary nucleus. Part of the Papez circuit; receives fornix input from the hippocampus and projects to the anterior thalamus; critical for episodic memory and spatial navigation.",
  732: "Medial mammillary nucleus, median part. A subdivision of the medial mammillary nucleus involved in memory and navigation circuits.",
  515: "Medial preoptic nucleus. Critical for male sexual behavior, parental behavior, and thermoregulation; contains sexually dimorphic nuclei regulated by gonadal hormones.",
  523: "Medial preoptic area. Integrates gonadal hormone signals to regulate reproductive behavior, thermoregulation, and sleep; major site of testosterone action.",
  531: "Medial pretectal area. Part of the pretectal complex involved in visual reflexes and the control of pupil diameter.",
  946: "Posterior hypothalamic nucleus. Involved in thermogenesis, arousal, and autonomic regulation; integrates thermoregulatory and behavioral state signals.",
  980: "Dorsal premammillary nucleus. A key node for processing threat and predator stress; involved in organizing defensive behavior and coordinating hypothalamic defense responses.",
  1004:"Ventral premammillary nucleus. Involved in reproductive behavior; receives olfactory input and projects to hypothalamic areas controlling gonadotropin release.",
  38:  "Paraventricular hypothalamic nucleus. Contains CRH, vasopressin, and oxytocin neurons; central regulator of the HPA stress axis, autonomic nervous system, and neuroendocrine function.",
  63:  "Paraventricular hypothalamic nucleus, descending division. Projects to brainstem autonomic nuclei and spinal cord; regulates sympathetic and parasympathetic outflow and cardiovascular function.",
  30:  "Periventricular hypothalamic nucleus, anterior part. Contains somatostatin neurons inhibiting growth hormone release; involved in neuroendocrine regulation.",
  118: "Periventricular hypothalamic nucleus, intermediate part. Contains dopaminergic neurons regulating prolactin release; part of the tuberoinfundibular dopamine system.",
  126: "Periventricular hypothalamic nucleus, posterior part. Involved in neuroendocrine regulation and reproductive control.",
  133: "Periventricular hypothalamic nucleus, preoptic part. Contains neuroendocrine neurons involved in reproductive and autonomic regulation.",
  173: "Retrochiasmatic area. Transition zone between the caudal hypothalamus and the optic chiasm region; involved in neuroendocrine integration.",
  347: "Subparaventricular zone. Region immediately adjacent to the PVH; integrates circadian signals from the SCN to regulate sleep, feeding, and autonomic rhythms.",
  286: "Suprachiasmatic nucleus. Master circadian pacemaker; receives direct retinal input via the retinohypothalamic tract and generates 24-hour biological rhythms that are distributed to the rest of the brain.",
  390: "Supraoptic nucleus. Contains magnocellular neurons producing vasopressin and oxytocin that are released directly into the bloodstream; regulates water balance, blood pressure, and social bonding.",
  525: "Supramammillary nucleus. Sends theta-pacing signals to the hippocampus independently of the medial septum; involved in spatial memory and sensorimotor integration.",
  614: "Tuberal nucleus. Part of the hypothalamic tuberal region; involved in reproductive and metabolic regulation.",
  1126:"Tuberomammillary nucleus, dorsal part. Contains histaminergic neurons promoting wakefulness; projects widely to the cortex; targeted by sedating antihistamines.",
  1:   "Tuberomammillary nucleus, ventral part. Contains histaminergic neurons involved in promoting arousal and wakefulness; part of the ascending arousal system.",
  693: "Ventromedial hypothalamic nucleus. Involved in satiety signaling, defensive behavior, and sexual behavior; contains dense estrogen receptors; a key node for glucose sensing and energy homeostasis.",
  689: "Ventrolateral preoptic nucleus. Contains galanin/GABA neurons that actively promote sleep by inhibiting the ascending arousal systems; the main 'sleep switch' in the brain.",
  763: "Vascular organ of the lamina terminalis. Circumventricular organ lacking a blood-brain barrier; detects plasma osmolality and circulating angiotensin II to regulate fluid balance and thirst.",
  338: "Subfornical organ. Circumventricular organ without a blood-brain barrier; detects circulating hormones including angiotensin II and relaxin; controls thirst, salt appetite, and fluid homeostasis.",
  1109:"Parastrial nucleus. Small nucleus adjacent to the stria terminalis; involved in neuroendocrine signaling.",
  1124:"Suprachiasmatic preoptic nucleus. Part of the preoptic area adjacent to the SCN; involved in circadian-regulated reproductive behavior.",

  // ── Olfactory system ───────────────────────────────────────────────────────
  507: "Main olfactory bulb. First central relay of olfactory information; performs initial odor processing and spatial mapping; projects to piriform cortex, amygdala, and entorhinal cortex.",
  151: "Accessory olfactory bulb. Processes pheromone signals from the vomeronasal organ; projects to the medial amygdala and hypothalamus to regulate social and reproductive behavior.",
  159: "Anterior olfactory nucleus. Early olfactory processing station that modulates olfactory bulb activity via centrifugal feedback; involved in olfactory memory and discrimination.",
  566: "Postpiriform transition area. Transition zone between piriform cortex and the amygdala; part of the primary olfactory cortex.",
  619: "Nucleus of the lateral olfactory tract. Receives direct mitral cell input from the olfactory bulb; part of the primary olfactory cortex.",
  597: "Taenia tecta, dorsal part. Hippocampal rudiment overlying the olfactory bulb; receives olfactory input and is involved in olfactory processing.",
  605: "Taenia tecta, ventral part. Part of the olfactory cortex; involved in processing olfactory information.",

  // ── Claustrum and related ──────────────────────────────────────────────────
  583: "Claustrum. Thin sheet of neurons densely interconnected with virtually all areas of the cerebral cortex; proposed to coordinate cortical activity across sensory modalities and may play a role in conscious perception.",
  952: "Endopiriform nucleus, dorsal part. Deep layer of olfactory cortex receiving piriform input; highly susceptible to seizure activity and involved in olfactory processing.",
  966: "Endopiriform nucleus, ventral part. Deep endopiriform region involved in olfactory processing.",
  342: "Substantia innominata. Contains the nucleus basalis of Meynert with cholinergic neurons projecting to the entire cerebral cortex; critical for attention, learning, and memory; degeneration of these neurons contributes to Alzheimer's disease.",
  298: "Magnocellular nucleus. Contains large cholinergic neurons projecting to cortex and amygdala; part of the basal forebrain cholinergic system supporting attention and memory.",

  // ── Midbrain ───────────────────────────────────────────────────────────────
  795: "Periaqueductal gray. Surrounds the cerebral aqueduct; a hub for integrating and coordinating responses to pain, threat, and stress; contains opioid-sensitive neurons mediating analgesia; organizes vocalization, reproductive behavior, and defensive responses.",
  214: "Red nucleus. Contains magnocellular (rubrospinal) and parvicellular (rubro-olivary) neurons; the magnocellular division is the origin of the rubrospinal tract for limb movement control; receives cerebellar input from the interposed nucleus.",
  246: "Midbrain reticular nucleus, retrorubral area. Located caudal to the red nucleus; contains dopaminergic A8 group neurons; involved in motor control and reward processing.",
  128: "Midbrain reticular nucleus. Brainstem motor region involved in locomotion, postural control, and arousal; an important origin of reticulospinal fibers descending to the spinal cord.",
  616: "Cuneiform nucleus. Part of the mesencephalic locomotor region; stimulation elicits locomotion; projects to the reticular formation and coordinates locomotor rhythm initiation.",
  231: "Anterior tegmental nucleus. Small midbrain tegmental nucleus; involved in limbic and autonomic regulation.",
  880: "Dorsal tegmental nucleus. Contains head-direction cells; part of the Papez-adjacent circuit for spatial navigation; projects to mammillary bodies and anterior thalamus.",
  100: "Interpeduncular nucleus. Receives habenular input via the fasciculus retroflexus; involved in stress responses, anxiety, circadian rhythms, and the aversive effects of nicotine.",
  162: "Laterodorsal tegmental nucleus. Contains cholinergic neurons involved in REM sleep generation, arousal, and reward; projects to thalamus, hypothalamus, and limbic areas.",
  1052:"Pedunculopontine nucleus. Contains cholinergic and glutamatergic neurons involved in movement initiation, arousal, and gait control; part of the mesencephalic locomotor region; degeneration contributes to gait freezing in Parkinson's disease.",
  749: "Ventral tegmental area. Contains dopaminergic neurons of the mesolimbic and mesocortical systems; projects to nucleus accumbens (reward and motivation) and prefrontal cortex (cognition); critical for reinforcement learning, addiction, and motivated behavior.",
  591: "Central linear nucleus raphe. Contains dopaminergic neurons near the ventral tegmental area; involved in behavioral and cardiovascular regulation.",
  679: "Superior central nucleus raphe. Contains serotonergic neurons projecting to hippocampus and cortex; involved in anxiety, depression, and associative learning.",
  872: "Dorsal raphe nucleus. The largest serotonergic nucleus in the brain; projects throughout the forebrain; regulates mood, anxiety, sleep-wake cycles, and appetite; the primary target of SSRI antidepressants.",
  12:  "Interfascicular nucleus raphe. Contains dopaminergic neurons adjacent to the fasciculus retroflexus near the VTA; involved in limbic and reward regulation.",
  197: "Rostral linear nucleus raphe. Contains serotonergic and dopaminergic neurons; involved in limbic mood and motivation regulation.",
  1044:"Peripeduncular nucleus. Located adjacent to the cerebral peduncle; receives auditory and multimodal input; involved in acoustic and limbic processing.",
  1077:"Perireunensis nucleus. Small thalamic nucleus adjacent to the nucleus of reuniens; TBD specific function.",
  609: "Subparafascicular area. Located adjacent to the parafascicular nucleus; receives auditory and somatosensory input; projects to amygdala; involved in multimodal thalamic integration.",
  414: "Subparafascicular nucleus, magnocellular part. Thalamic nucleus receiving auditory and somatosensory input; projects to the amygdala; involved in multimodal sensory-limbic integration.",
  422: "Subparafascicular nucleus, parvicellular part. Projects to auditory cortex and limbic areas; involved in multimodal thalamic processing.",
  356: "Preparasubthalamic nucleus. Small nucleus adjacent to the subthalamic region; TBD specific function.",
  364: "Parasubthalamic nucleus. Small nucleus adjacent to the STN involved in hypothalamic-basal ganglia interactions.",
  757: "Ventral tegmental nucleus. Small tegmental nucleus involved in spatial orientation and navigation; part of the circuit linking mammillary bodies and the dorsal tegmentum.",

  // ── Raphe and pontine tegmentum ────────────────────────────────────────────
  206: "Nucleus raphe magnus. Contains serotonergic neurons that project via the dorsal raphe spinal tract to the spinal cord dorsal horn; a key node of the descending pain-control system that produces stimulation-produced analgesia.",
  222: "Nucleus raphe obscurus. Serotonergic nucleus in the medullary raphe; projects to spinal cord; involved in somatic motor facilitation, autonomic regulation, and control of respiratory rhythm.",
  230: "Nucleus raphe pallidus. Contains serotonergic neurons that project to the spinal cord; involved in thermoregulation by activating sympathetic pathways to brown adipose tissue and skin vasculature.",
  238: "Nucleus raphe pontis. Pontine raphe nucleus; projects to cerebellum and spinal cord; involved in modulation of cerebellar and spinal motor activity.",

  // ── Parabrachial and related ───────────────────────────────────────────────
  867: "Parabrachial nucleus. Integrates pain, taste, thermosensory, and visceral information; the critical ascending relay for interoceptive signals from the spinal cord and nucleus of the solitary tract to the forebrain (amygdala, hypothalamus, thalamus).",
  123: "Kölliker-Fuse nucleus. Part of the lateral parabrachial complex; a key node for respiratory pattern generation, particularly controlling inspiratory-expiratory phase transitions.",

  // ── Locus coeruleus and noradrenergic ─────────────────────────────────────
  147: "Locus coeruleus. Primary noradrenergic nucleus; projects widely to cerebral cortex, hippocampus, cerebellum, and spinal cord; regulates arousal, attention, cognitive flexibility, and the stress response.",
  283: "Lateral tegmental nucleus. Contains noradrenergic A1 and A2 neurons; involved in cardiovascular regulation and autonomic control.",
  350: "Subceruleus nucleus. Located ventral to the locus coeruleus; contains noradrenergic A7 neurons; involved in REM sleep generation and descending motor regulation.",
  358: "Sublaterodorsal nucleus. Key generator of REM sleep; glutamatergic neurons here project to the spinal cord to produce the muscle atonia characteristic of REM sleep.",

  // ── Pontine and medullary reticular formation ──────────────────────────────
  280: "Barrington's nucleus. Contains the sole neurons driving bladder voiding via excitatory projections to sacral parasympathetic neurons; also involved in defecation and pelvic organ coordination.",
  1048:"Gigantocellular reticular nucleus. The largest reticular nucleus in the medullary RF; the primary origin of reticulospinal fibers; involved in locomotion, posture, and somatic motor facilitation.",
  136: "Intermediate reticular nucleus. Medullary reticular region involved in autonomic and motor regulation; coordinates swallowing, respiration, and other rhythmic behaviors.",
  307: "Magnocellular reticular nucleus. Pontine reticular nucleus contributing to the reticulospinal tract; involved in postural and somatic motor control.",
  1098:"Medullary reticular nucleus, dorsal part. Medullary reticular region involved in descending motor control via the reticulospinal tract.",
  1107:"Medullary reticular nucleus, ventral part. Medullary reticular region involved in motor and autonomic regulation.",
  995: "Paramedian reticular nucleus. Small medullary nucleus involved in cerebellar control of eye movements; projects to the cerebellar vermis.",
  852: "Parvicellular reticular nucleus. Part of the medullary reticular formation involved in swallowing, respiration, and autonomic regulation.",
  970: "Paragigantocellular reticular nucleus, dorsal part. Located adjacent to the gigantocellular nucleus; involved in autonomic and motor regulation.",
  978: "Paragigantocellular reticular nucleus, lateral part. Contains pre-sympathetic neurons and noradrenergic A1 cells; involved in cardiovascular regulation and descending pain modulation.",
  1093:"Pontine reticular nucleus, caudal part. Part of the paramedian pontine reticular formation (PPRF); involved in generating horizontal saccades and contributes to the reticulospinal tract.",
  146: "Pontine reticular nucleus. Rostral part of the PPRF; involved in horizontal gaze control, postural regulation, and reticulospinal motor commands.",
  574: "Tegmental reticular nucleus. Pontine precerebellar nucleus relaying cortical and tectal signals to the cerebellum for motor coordination.",
  1069:"Parapyramidal nucleus. Small serotonergic nucleus near the pyramidal tract in the medullary base; projects to spinal cord; involved in motor and autonomic regulation.",
  604: "Nucleus incertus. Contains relaxin-3-expressing neurons projecting to hippocampus and septum; involved in stress responses, arousal, and hippocampal theta rhythm regulation.",

  // ── Locus coeruleus-adjacent ───────────────────────────────────────────────
  318: "Supragenual nucleus. Small nucleus in the pontine dorsal tegmentum involved in motor coordination and vestibular integration.",

  // ── Colliculi ──────────────────────────────────────────────────────────────
  811: "Inferior colliculus, central nucleus. Primary auditory midbrain nucleus; integrates ascending auditory streams; performs binaural processing, sound localization, and spectrotemporal analysis.",
  820: "Inferior colliculus, dorsal nucleus. Higher-order auditory nucleus involved in multisensory integration and auditory learning.",
  828: "Inferior colliculus, external nucleus. Multimodal nucleus receiving somatosensory and auditory input; a key site for auditory-motor and sensorimotor integration.",
  580: "Nucleus of the brachium of the inferior colliculus. Relay nucleus connecting the inferior colliculus to the medial geniculate complex; involved in auditory thalamic processing.",
  271: "Nucleus sagulum. Part of the lateral lemniscal system; involved in auditory processing and projects to the inferior colliculus.",
  851: "Superior colliculus, optic layer. Receives direct retinal input; drives visual orienting reflexes toward salient stimuli via projections to premotor brainstem circuits.",
  842: "Superior colliculus, superficial gray layer. Primary visual input layer; responds to luminance and contrast; the main driver of visual orienting reflexes.",
  834: "Superior colliculus, zonal layer. Superficial visual layer of the superior colliculus; receives retinal input.",
  10:  "Superior colliculus, intermediate gray layer (motor-related). Integrates visual, auditory, and somatosensory inputs to generate orienting movements of the head and eyes.",
  17:  "Superior colliculus, intermediate white layer (motor-related). Contains efferent fibers conveying orienting movement commands from the SC to brainstem premotor circuits.",
  26:  "Superior colliculus, deep gray layer (motor-related). Coordinates head and body orientation movements; receives input from frontal cortex, basal ganglia, and sensory layers.",
  42:  "Superior colliculus, deep white layer (motor-related). White matter layer carrying motor output from the deep SC.",
  874: "Parabigeminal nucleus. Cholinergic nucleus adjacent to the brachium of the superior colliculus; modulates SC activity and visual attention.",

  // ── Pretectum ──────────────────────────────────────────────────────────────
  215: "Anterior pretectal nucleus. Involved in descending pain modulation; electrical stimulation produces analgesia; also involved in attention and defensive behavior.",
  706: "Olivary pretectal nucleus. Receives direct retinal input from intrinsically photosensitive retinal ganglion cells; the primary mediator of the pupillary light reflex.",
  634: "Nucleus of the posterior commissure. Part of the pretectal region; involved in the coordination of vertical eye movements.",
  1061:"Posterior pretectal nucleus. Part of the pretectal area involved in visual and oculomotor reflexes.",
  628: "Nucleus of the optic tract. Receives direct retinal input; drives compensatory eye movements (optokinetic nystagmus) in response to whole-field visual motion.",

  // ── Accessory optic system ─────────────────────────────────────────────────
  66:  "Lateral terminal nucleus of the accessory optic system. Detects optic flow signals; drives the optokinetic reflex to stabilize gaze during self-motion.",

  // ── Zona incerta and subthalamic region ───────────────────────────────────
  797: "Zona incerta. Subthalamic GABAergic nucleus that gates and coordinates sensory, motor, and limbic processing; regulates feeding, attention, defensive behaviors, and rhythmic motor patterns.",

  // ── Auditory brainstem ─────────────────────────────────────────────────────
  96:  "Dorsal cochlear nucleus. Processes complex auditory features including spectral notches used for sound localization in elevation; projects to the contralateral inferior colliculus.",
  101: "Ventral cochlear nucleus. Initial processing of auditory timing, frequency, and intensity; three projection pathways mediate binaural processing for sound localization.",
  112: "Granular lamina of the cochlear nuclei. Intermediate layer between the dorsal and ventral cochlear nuclei involved in auditory processing.",
  560: "Cochlear nucleus, subpeduncular granular region. Part of the cochlear nucleus complex involved in auditory processing.",
  642: "Nucleus of the trapezoid body. Receives calyceal input from the anteroventral cochlear nucleus; critical for encoding interaural time differences for low-frequency sound localization.",
  612: "Nucleus of the lateral lemniscus. Auditory nucleus on the ascending pathway; involved in binaural processing and temporal coding before reaching the inferior colliculus.",
  90:  "Nucleus of the lateral lemniscus, horizontal part. Part of the lateral lemniscal complex involved in binaural auditory processing.",
  99:  "Nucleus of the lateral lemniscus, ventral part. Processes auditory timing information; projects to the inferior colliculus.",
  114: "Superior olivary complex, lateral part. Computes interaural level differences for high-frequency sound localization; receives excitatory cochlear nucleus input ipsilaterally and inhibitory input contralaterally via the MNTB.",
  105: "Superior olivary complex, medial part. Binaural coincidence detector for interaural time differences; critical for low-frequency sound localization.",
  122: "Superior olivary complex, periolivary region. Provides efferent olivocochlear feedback to cochlear outer hair cells; modulates cochlear gain and sensitivity.",
  887: "Efferent cochlear group. Neurons providing direct efferent innervation to cochlear hair cells; modulates outer hair cell motility and cochlear sensitivity.",

  // ── Trigeminal system ──────────────────────────────────────────────────────
  7:   "Principal sensory nucleus of the trigeminal. Processes discriminative touch from the face; the facial analog of the dorsal column nuclei; projects to VPM thalamus.",
  429: "Spinal nucleus of the trigeminal, caudal part. Processes pain and temperature from the face and oral cavity; analogous to the superficial spinal cord dorsal horn; a key relay for orofacial pain and headache.",
  437: "Spinal nucleus of the trigeminal, interpolar part. Processes deep pain from teeth and temporomandibular joint; involved in dental pain and headache pathways.",
  445: "Spinal nucleus of the trigeminal, oral part. Processes orofacial mechanoreception and nociception; important for jaw reflexes and orofacial pain.",
  460: "Midbrain trigeminal nucleus. Contains the cell bodies of primary proprioceptive afferents from jaw muscles; the only location in the CNS where primary sensory neuron cell bodies reside (outside the dorsal root ganglia).",
  534: "Supratrigeminal nucleus. Located dorsal to the motor trigeminal nucleus; involved in jaw-opening reflexes and coordination of masticatory rhythm.",
  621: "Motor nucleus of the trigeminal. Contains motor neurons innervating the muscles of mastication (masseter, temporalis, pterygoids, digastric); controls chewing movements.",

  // ── Cranial motor nuclei ───────────────────────────────────────────────────
  661: "Facial motor nucleus. Contains motor neurons innervating all muscles of facial expression via the facial nerve (CN VII); organized into subnuclei for different facial regions.",
  576: "Accessory facial motor nucleus. Small accessory group of facial motoneurons associated with the facial motor nucleus.",
  653: "Abducens nucleus. Contains motor neurons for the lateral rectus muscle (horizontal eye movements) and interneurons projecting via the MLF to drive the contralateral medial rectus.",
  568: "Accessory abducens nucleus. Small accessory group adjacent to the abducens nucleus; may contribute to retraction of the globe and eyelid movements.",
  35:  "Oculomotor nucleus. Contains motor neurons for four extraocular muscles (medial, superior, inferior recti and inferior oblique) and levator palpebrae; controls vertical and medial eye movements.",
  115: "Trochlear nucleus. Contains motor neurons for the superior oblique muscle; the only cranial nerve to exit the brainstem dorsally; controls intorsion and depression of the adducted eye.",
  975: "Edinger-Westphal nucleus. Contains preganglionic parasympathetic neurons projecting to the ciliary ganglion; controls pupillary constriction and lens accommodation.",
  67:  "Interstitial nucleus of Cajal. Part of the vertical gaze holding network; integrates eye velocity signals to maintain vertical and torsional eye position.",
  587: "Nucleus of Darkschewitsch. Involved in vertical gaze control; part of the pretecto-olivary pathway coordinating eye movements and motor coordination.",
  773: "Hypoglossal nucleus. Contains motor neurons innervating all tongue muscles via the hypoglossal nerve (CN XII); critical for swallowing, chewing, and speech articulation.",
  143: "Nucleus ambiguus, ventral division. Contains motor neurons for pharyngeal and laryngeal muscles via CN IX and X; critical for swallowing and vocalization.",
  939: "Nucleus ambiguus, dorsal division. Contains parasympathetic preganglionic neurons projecting to the cardiac ganglion (heart rate control); also innervates soft palate.",
  839: "Dorsal motor nucleus of the vagus nerve. Contains preganglionic parasympathetic neurons projecting via the vagus nerve to thoracic and abdominal viscera; regulates heart rate, respiratory rate, and gastrointestinal motility.",
  106: "Inferior salivatory nucleus. Contains preganglionic parasympathetic neurons for the parotid gland via the glossopharyngeal nerve (CN IX); controls salivation.",

  // ── Nucleus of the solitary tract and area postrema ───────────────────────
  651: "Nucleus of the solitary tract. Primary visceral sensory relay nucleus; receives all visceral afferents via CN VII, IX, and X; processes cardiovascular, respiratory, and gastrointestinal signals; projects to hypothalamus, amygdala, and parabrachial nucleus.",
  859: "Parasolitary nucleus. Small nucleus adjacent to the NTS involved in visceral sensory integration.",
  207: "Area postrema. Circumventricular organ lacking a blood-brain barrier; serves as the chemoreceptor trigger zone for vomiting; detects blood-borne toxins, emetic drugs, and hormones.",

  // ── Vestibular nuclei ──────────────────────────────────────────────────────
  225: "Spinal vestibular nucleus. Processes vestibular signals related to body rotation and head position; projects to the spinal cord via the vestibulospinal tract for postural control.",
  202: "Medial vestibular nucleus. Integrates vestibular and visual signals to generate the vestibuloocular reflex (VOR) and gaze stabilization; projects to oculomotor nuclei.",
  209: "Lateral vestibular nucleus. Contains Deiters' neurons; the origin of the lateral vestibulospinal tract providing powerful facilitation of extensor motor neurons for postural control; receives cerebellar input.",
  217: "Superior vestibular nucleus. Processes semicircular canal input; contributes to eye movement stabilization and postural reflexes via projections to oculomotor nuclei.",
  640: "Efferent vestibular nucleus. Provides efferent feedback to hair cells of the vestibular labyrinth; modulates the sensitivity of vestibular afferents.",

  // ── Olivary and precerebellar ──────────────────────────────────────────────
  83:  "Inferior olivary complex. The sole source of cerebellar climbing fibers that synapse on Purkinje cells; encodes motor errors and timing signals critical for cerebellar motor learning and coordination.",
  955: "Lateral reticular nucleus, magnocellular part. Precerebellar nucleus receiving spinal cord, red nucleus, and cortical input; projects to the cerebellar vermis; involved in limb movement coordination.",
  963: "Lateral reticular nucleus, parvicellular part. Precerebellar nucleus involved in transmitting spinal and supraspinal signals to the cerebellum.",
  931: "Pontine gray. The largest precerebellar nucleus; relays cortical motor and cognitive information to the cerebellar hemispheres via the pontocerebellar tract; critical for voluntary movement coordination.",

  // ── Other medullary ────────────────────────────────────────────────────────
  203: "Linear nucleus of the medulla. Small medullary nucleus; TBD specific function.",
  169: "Nucleus prepositus. Neural integrator for horizontal gaze holding; receives abducens nucleus input and maintains eye position by integrating eye velocity signals.",
  161: "Nucleus intercalatus. Small medullary nucleus near the solitary tract; involved in integrating eye movement and visceral signals.",
  177: "Nucleus of Roller. Part of the hypoglossal complex; involved in tongue movement coordination.",

  // ── Cerebellar deep nuclei ─────────────────────────────────────────────────
  846: "Dentate nucleus. The largest deep cerebellar nucleus; receives input from the lateral cerebellar hemisphere; projects via the superior cerebellar peduncle to the motor thalamus (VL); critical for voluntary limb movement, cognitive processing, and motor learning.",
  91:  "Interposed nucleus. Deep cerebellar nucleus between the dentate and fastigial nuclei; involved in correcting limb movements during reaching; projects to the red nucleus and motor thalamus.",
  989: "Fastigial nucleus. Deep cerebellar nucleus receiving input from the cerebellar vermis; projects to brainstem reticular and vestibular nuclei and the spinal cord; controls trunk, axial muscles, and gaze.",
  372: "Infracerebellar nucleus. Small nucleus located below the cerebellum; TBD specific function.",

  // ── Cerebellar cortex ──────────────────────────────────────────────────────
  1056:"Crus 1 (ansiform lobule). Lateral cerebellar hemisphere lobule; receives pontine and climbing fiber input; involved in higher cognitive functions and coordination with associative cortex.",
  1064:"Crus 2 (ansiform lobule). Lateral cerebellar hemisphere lobule; involved in cognitive processing, fine motor control, and communication with the cerebral cortex.",
  1049:"Flocculus. Part of the vestibulocerebellum; critical for vestibuloocular reflex (VOR) adaptation and smooth pursuit eye movements.",
  1041:"Paraflocculus. Adjacent to the flocculus; involved in VOR and optokinetic reflex control.",
  912: "Lingula (lobule I). The most anterior vermal lobule; receives spinocerebellar input; involved in proprioceptive processing and trunk control.",
  976: "Lobule II. Anterior vermal lobule receiving spinocerebellar tract input; involved in proprioception and somatosensory integration.",
  984: "Lobule III. Anterior vermal lobule; part of the spinocerebellar territory for proprioceptive processing.",
  1091:"Lobules IV–V (culmen). Anterior vermal lobules receiving dense spinocerebellar input; involved in coordination of limb movements.",
  936: "Declive (lobule VI). Posterior vermal lobule receiving visual and vestibular input; involved in visuomotor control.",
  944: "Folium-tuber vermis (lobule VII). Posterior vermal lobule receiving spinocerebellar and mossy fiber input.",
  951: "Pyramis (lobule VIII). Posterior vermal lobule receiving spinocerebellar and vestibulocerebellar input.",
  957: "Uvula (lobule IX). Posterior vermal lobule receiving strong vestibular input; involved in balance and postural control.",
  968: "Nodulus (lobule X). Part of the vestibulocerebellum; receives direct vestibular input; involved in responses to head tilt, otolith signals, and optokinetic responses.",
  1033:"Copula pyramidis. Posterior lobe hemisphere region adjacent to the pyramis; involved in motor coordination.",
  1025:"Paramedian lobule. Hemisphere lobule adjacent to the vermis; involved in limb coordination via spinocerebellar and corticocerebellar input.",
  1007:"Simple lobule. Hemisphere lobule receiving somatosensory cortex and spinocerebellar input; involved in limb movement control.",

  // ── Small/specialized nuclei ───────────────────────────────────────────────
  765: "Nucleus x. Small vestibular-related nucleus near the superior vestibular nucleus; TBD specific function.",
  781: "Nucleus y. Part of the paramedian tract group; involved in eye movement control and vestibular integration.",
  789: "Nucleus z. Located at the medulla-spinal cord junction; receives proprioceptive input from the forelimb; part of the dorsal column-medial lemniscal pathway for upper limb proprioception.",
  898: "Pontine central gray. Gray matter surrounding the pontine tegmentum; involved in autonomic and behavioral state regulation.",
};

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
  setDescription(REGION_DESCRIPTIONS[allenId] || '');

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
    if (conn.normalized_value / localMax < 0.02) break; // hide tail entries that are <2% of max
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
    item.addEventListener('mouseenter', () => { if (!isTract) startGlow(conn[partnerId]); });
    item.addEventListener('mousemove', e => {
      tooltip.style.display = 'block';
      tooltip.style.left    = (e.pageX + 12) + 'px';
      tooltip.style.top     = (e.pageY - 28) + 'px';
      tooltip.innerHTML = `<strong>${partnerMeta.acronym || conn[partnerId]}</strong><br>${partnerMeta.name || ''}`;
    });
    item.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; stopGlow(); });
    item.addEventListener('click', () => {
      tooltip.style.display = 'none';
      stopGlow();
      if (onSelectRegion) onSelectRegion(conn[partnerId]);
    });
    list.appendChild(item);
  }
}

/** Show the info panel with a no-data explanation for regions without connectivity. */
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

/** Clear the info panel back to its blank state (called on background click). */
function clearInfo() {
  document.getElementById('region-acronym').textContent = '';
  document.getElementById('region-name').textContent    = '';
  document.getElementById('no-data-reason').style.display = 'none';
  document.getElementById('connections-list').innerHTML = '';
  document.getElementById('known-connections').style.display = 'none';
  setDescription('');
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
  { id: 'vest', color: '#60c0c0', nuclei: [225, 202, 209, 217, 968],  primary: 225  }, // SPIV, MV, LAV, SUV, NOD
  { id: 'dcml', color: '#e07070', nuclei: [1039, 711, 789],          primary: 1039 }, // GR, CU, Z
  { id: 'als',  color: '#d4604a', nuclei: [718, 733, 362, 575, 599, 907, 930, 795, 811, 842, 147, 283, 350, 867, 651, 978], primary: 718  },
  { id: 'spcr', color: '#7060c8', nuclei: [83, 903, 955, 963, 912, 976, 984, 1091, 1007, 936, 944, 951, 957, 1033, 1025], primary: 83 }, // IO, ECU, LRN, cerebellar lobules
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
      // Lateral hemisphere (crus I/II/ansiform), flocculonodular lobe (NOD, FL),
      // and deep nuclei excluded per user specification.
      912,  // LING  — lingula (lobule I) — minor spinocerebellar input
      976,  // CENT2 — lobule II (anterior lobe, vermis)
      984,  // CENT3 — lobule III (anterior lobe, vermis)
      1091, // CUL4_5 — culmen lobules IV–V (anterior lobe, primary DSCT/VSCT target)
      1007, // SIM   — simple lobule (lobule VI, paravermal junction)
      936,  // DEC   — declive (lobule VI, posterior vermis)
      944,  // FOTU  — folium-tuber vermis (lobule VII)
      951,  // PYR   — pyramis (lobule VIII, significant DSCT target)
      957,  // UVU   — uvula (lobule IX, posterior vermis)
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
      // ── Pontine RF continued ───────────────────────────────────────────────
      307,  // MARN  — magnocellular reticular nucleus (ventromedial pontine RF)
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

// Motor CN band id → TRACT_PROJECTION_SITES key (for info panel on band click)
const BAND_TO_TRACT_KEY = {
  'mcn-iii': 'cn_iii', 'mcn-iv': 'cn_iv', 'mcn-v': 'cn_vm',
  'mcn-vi': 'cn_vi', 'mcn-vii': 'cn_vii', 'mcn-ix': 'cn_ix',
  'mcn-xii': 'cn_xii', 'mcn-ne': 'cn_ne',
};
const TRACT_KEY_TO_BAND = Object.fromEntries(
  Object.entries(BAND_TO_TRACT_KEY).map(([bandId, tractKey]) => [tractKey, bandId])
);

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

    document.getElementById('region-acronym').textContent    = sites.label;
    document.getElementById('region-name').textContent       = sites.sub;
    document.getElementById('no-data-reason').style.display  = 'none';
    document.getElementById('known-connections').style.display = 'none';
    setDescription('');
    const tooltip   = document.getElementById('tooltip');
    const list      = document.getElementById('connections-list');
    list.innerHTML  = '';

    for (const rid of regionIds) {
      const meta = metadata[rid] || {};
      const item = document.createElement('div');
      item.className = 'connection-item';
      item.innerHTML = `
        <div style="width:100%">
          <div>${meta.acronym || rid}</div>
          <div class="connection-bar" style="width:100%;background:${sites.color};opacity:0.7"></div>
        </div>`;
      item.addEventListener('mouseenter', () => { startGlow(rid); });
      item.addEventListener('mousemove', e => {
        tooltip.style.display = 'block';
        tooltip.style.left    = (e.pageX + 12) + 'px';
        tooltip.style.top     = (e.pageY - 28) + 'px';
        tooltip.innerHTML = `<strong>${meta.acronym || rid}</strong><br>${meta.name || ''}`;
      });
      item.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; stopGlow(); });
      item.addEventListener('click', () => { stopGlow(); selectRegion(rid); panToRegion(rid); });
      list.appendChild(item);
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
