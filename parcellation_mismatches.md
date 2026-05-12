# Parcellation Mismatch Log

Tracks every resolved mismatch between the Swanson flatmap parcellation (iblatlas `swanson_json()`) and the Allen Mouse Brain Connectivity Atlas injection dataset. Updated as new issues are found.

---

## 1. `thisID` is a BrainRegions array index, not an Allen CCF ID

**Discovery:** Every region label was wrong — MOp appeared in the habenula position, visual areas in motor cortex, etc.

**Root cause:** `swanson_json()` stores `thisID` as a **row index** into the `BrainRegions` arrays, not an Allen CCF ID. `thisID=19` → `br.id[19]=985` (MOp).

**Fix:** `export_phase0.py` computes `r['allenId'] = int(br.id[r['thisID']])` for every region before any downstream use. The frontend uses `d.allenId` exclusively.

---

## 2. Multi-site injections — first-match attribution

**Discovery:** Red nucleus (RN, Allen ID 214) had 29 cached experiments but zero injection credit. Every experiment also listed other structures first (e.g. 128, 12) and the original code took `matching[0]`.

**Fix:** Changed to attribute each experiment to **all** matching injection structures in `valid_set`, not just the first. `exp_to_inj_structs[exp_id] = list(targets)`.

---

## 3. Injection into parent structure not on flatmap — child propagation

**Discovery:** Superior colliculus (SC) and inferior colliculus (IC) sub-layers were dark grey despite hundreds of Allen experiments. Experiments targeted parent structures (`IC`, `SCs`, `SCm`) which are absent from the Swanson flatmap; only their sub-regions appear.

**Fix:** `flatmap_descendants(struct_id, valid_set)` walks the Allen CCF hierarchy and returns all valid-set descendants. Applied to every injection structure in every experiment before CSV reading.

**Active propagations (as of last export):**

| Allen ID | Acronym | Name | Flatmap children |
|----------|---------|------|-----------------|
| 4 | IC | Inferior colliculus | ICc (811), ICd (820), ICe (828) |
| 127 | AM | Anteromedial nucleus | AMd (1096), AMv (1104) |
| 135 | AMB | Nucleus ambiguus | AMBv (143), AMBd (939) |
| 235 | LRN | Lateral reticular nucleus | LRNm (955), LRNp (963) |
| 294 | SCm | Superior colliculus motor related | SCig (10), SCiw (17), SCdg (26), SCdw (42) |
| 295 | BLA | Basolateral amygdalar nucleus | BLAa (303), BLAp (311), BLAv (451) |
| 302 | SCs | Superior colliculus sensory related | SCzo (834), SCsg (842), SCop (851) |
| 319 | BMA | Basomedial amygdalar nucleus | BMAa (327), BMAp (334) |
| 395 | MDRN | Medullary reticular nucleus | MDRNd (1098), MDRNv (1107) |
| 398 | SOC | Superior olivary complex | SOCm (105), SOCl (114), POR (122) |
| 475 | MG | Medial geniculate complex | MGd (1072), MGv (1079), MGm (1088) |
| 536 | CEA | Central amygdalar nucleus | CEAc (544), CEAl (551), CEAm (559) |
| 589 | TT | Taenia tecta | TTd (597), TTv (605) |
| 647 | COAp | Cortical amygdalar area posterior part | COApl (655), COApm (663) |
| 920 | CENT | Central lobule | CENT2 (976), CENT3 (984) |
| 928 | CUL | Culmen | CUL4/5 (1091) |
| 1017 | AN | Ansiform lobule | ANcr1 (1056), ANcr2 (1064) |

---

## 4. Hole regions with injection data

**Discovery:** 16 Swanson flatmap regions are flagged `hole: true` (they render inside a parent polygon). Several have Allen injection data and were appearing colored but unresponsive.

**Fix:** Removed `pointer-events: none` from `.region.hole` CSS. Removed `|| d.hole` guard from the JS click handler. Holes with data now behave identically to normal regions.

**Hole regions with injection data:**

| thisID | Allen ID | Acronym | Name |
|--------|----------|---------|------|
| 745 | 523 | MPO | Medial preoptic nucleus |
| 758 | 88 | AHN | Anterior hypothalamic nucleus |
| 777 | 515 | MPN | Medial preoptic nucleus |
| 795 | 194 | LHA | Lateral hypothalamic area |
| 803 | 797 | ZI | Zona incerta |
| 824 | 749 | VTA | Ventral tegmental area |
| 826 | 246 | RR | Midbrain reticular nucleus, retrorubral area |
| 827 | 128 | MRN | Midbrain reticular nucleus |
| 839 | 795 | PAG | Periaqueductal gray |
| 868 | 1052 | PPN | Pedunculopontine nucleus |
| 891 | 867 | PB | Parabrachial nucleus |
| 912 | 898 | PCG | Pontine central gray |
| 914 | 1093 | PRNc | Pontine reticular nucleus caudal part |
| 976 | 1048 | GRN | Gigantocellular reticular nucleus |
| 989 | 852 | PARN | Parvicellular reticular nucleus |
| 992 | 970 | PGRNd | Paragigantocellular reticular nucleus dorsal part |

---

## 5. Sub-regions of flatmap parent — downward propagation

**Discovery:** FF, ND, INC, PRC, KF, Mmme all showed dark grey despite their parent structures having injection data. The issue: `flatmap_descendants` stopped recursing as soon as it hit a valid_set node (the parent), so it never collected the children that are *also* in valid_set.

**Root cause:** Original `flatmap_descendants` logic: `if cur in valid: append; else: recurse`. When ZI (on flatmap) was found, it stopped and never reached FF or A13 (also on flatmap, children of ZI).

**Fix:** Changed to always recurse into children regardless of whether the current node is in valid_set:
```python
if cur in valid:
    result.append(cur)
stack.extend(children_map.get(cur, []))  # always recurse
```

**Resolved regions:**

| Region | Allen ID | Parent | Parent Allen ID | Parent exps |
|--------|----------|--------|-----------------|-------------|
| FF (Fields of Forel) | 804 | ZI | 797 | 102 |
| A13 (A13 dopamine group) | 796 | ZI | 797 | 102 |
| ND (Nucleus of Darkschewitsch) | 587 | PAG | 795 | 116 |
| INC (Interstitial nucleus of Cajal) | 67 | PAG | 795 | 116 |
| PRC (Precommissural nucleus) | 50 | PAG | 795 | 116 |
| KF (Koelliker-Fuse subnucleus) | 123 | PB | 867 | 58 |
| Mmme (Medial mammillary nucleus median part) | 732 | MM | 491 | 32 |

---

## 6. Regions with zero Allen injection experiments (confirmed unfixable)

**Discovery:** 14 regions confirmed to have zero injection experiments in the Allen Mouse Brain Connectivity Atlas at every level of their CCF hierarchy (verified via `mcc.get_experiments(injection_structure_ids=descendant_ids)` and `structure_set_ids` inspection).

**Conclusion:** All 14 are absent from Allen's `Mouse Connectivity - Projection All Injection Structures` set (id 112905828) by design. No propagation strategy can recover data that was never collected.

### Category A — Projection targets only

In Allen's `Mouse Connectivity - Target Search` set (id 184527634) but absent from injection sets. Allen mapped projections *to* these regions but never injected them as sources. All four are leaf nodes. The likely reason is technical: SFO is a circumventricular organ outside the blood-brain barrier with atypical tracer uptake; ECU, PAS, and SG are tiny brainstem nuclei immediately adjacent to larger structures — clean targeted injections would be nearly impossible without contamination.

| Acronym | Allen ID | Name |
|---------|----------|------|
| SFO | 338 | Subfornical organ |
| SG | 318 | Supragenual nucleus |
| ECU | 903 | External cuneate nucleus |
| PAS | 859 | Parasolitary nucleus |

### Category B — Layer / zone designation

Not a discrete injectable nucleus. **UI treatment: rendered black (#000000)** to distinguish it from ordinary no-data regions (dark grey).

| Acronym | Allen ID | Name | Note |
|---------|----------|------|------|
| 6b | 16 | Layer 6b, isocortex | Laminar designation spanning all of CTXsp (cortical subplate); path: root > CH > CTX > CTXsp > 6b. Not a specific injection target. |

### Category C — Sub-parcellations below injection resolution

In some ABA atlas sets but excluded from connectivity targeting.

| Acronym | Allen ID | Name | Status | Resolution |
|---------|----------|------|--------|------------|
| ENTmv | 934 | Entorhinal area, medial part, ventral zone | **Fixed** | ENTmv is the ventral zone of ENTm (926, 97 exps). Hierarchical siblings in Allen CCF, but ENTmv is anatomically a sub-zone of ENTm. Added `SIBLING_OVERRIDES = {934: 926}` in export script. |
| CNspg | 560 | Cochlear nucleus subpeduncular granular region | Left dark grey | Siblings DCO (18 exps) and VCO (10 exps) are functionally distinct sub-regions; attributing their data to CNspg would be misleading. |

### Category D — Absent from Allen's experimental design

All seven have completely empty `structure_set_ids` — not classified into any Allen group at all. Each is a small, specialized leaf-node nucleus with sibling structures that do have data. Allen's coverage stopped just short of each of these. No fix is possible without new injection experiments.

| Acronym | Allen ID | Name | Siblings with data |
|---------|----------|------|--------------------|
| AHA | 80 | Anterior hypothalamic area | DMH (79 exps), MPO (47), PVp (32) — sits in a transitional zone between periventricular and lateral hypothalamus |
| ORBv | 738 | Orbital area, ventral part | ORBl (47), ORBm (46), ORBvl (64) — all ORB siblings also absent from injection sets |
| ECO | 887 | Efferent cochlear group | VI (3), VII (19), AMB (12) — specialized auditory efferent nucleus |
| NIS | 161 | Nucleus intercalatus | NR (13), PRP (5) — tiny vestibular-related medullary nucleus |
| PMR | 995 | Paramedian reticular nucleus | VI (3), VII (19), AMB (12) — small reticular nucleus adjacent to larger targets |
| ACVI | 568 | Accessory abducens nucleus | VI (3), VII (19), AMB (12) — accessory motor nucleus, very small |
| Z | 789 | Nucleus z | NTS (32), SPVC (19), NTB (3) — proprioceptive relay, among the smallest nuclei in the medulla |

---

## 7. Co-injection site contamination — projection exclusion

**Discovery:** CA1 and CA3 appeared as each other's primary efferent target. The hippocampus is a feedforward loop (CA3 → CA1 via Schaffer collaterals), not strongly bidirectional. 37 of 96 CA1 experiments co-injected CA3; Allen records a large `normalized_projection_volume` for CA3 in those experiments because tracer was physically present at the CA3 injection site, not because of genuine CA1→CA3 axonal labeling.

**Root cause:** When an experiment injects structures A and B together, `is_injection=False` rows for both A and B still exist in `structure_unionizes.csv` with inflated `normalized_projection_volume` values (tracer at the injection site bleeds into the "projection" signal for those structures).

**Fix:** For each experiment, build `inj_struct_set` from all structures attributed to that experiment (including via parent propagation). Exclude any `structure_id ∈ inj_struct_set` from projection volumes when reading the CSV. Applied broadly — affects any co-injected pair, not just CA1/CA3.

---

## 8. Volume aggregation: sum → mean per injection structure

**Discovery:** Well-studied regions (hippocampus: 90+ experiments; small brainstem nuclei: 2–3 experiments) dominated the global max normalization. Summing `normalized_projection_volume` across all experiments for a given injection structure means a region with 90 experiments will have ~45× larger aggregate volume than one with 2 experiments showing identical projection strength, compressing weakly-studied regions into near-zero normalized values and distorting the relative strength of their connections.

**Fix:** After accumulating summed volumes, divide each `(inj_id, proj_id)` value by `exp_counts[inj_id]` — the number of cached experiments attributed to that injection structure. This gives mean `normalized_projection_volume` per injection experiment rather than raw sum. The denominator counts **all** experiments attributed to the structure (including those where the target was unlabeled), not just experiments where that specific connection was present. Using only present-connection counts as the denominator would bias toward connections that happen to be consistently labeled, rather than those that are consistently strong.

**Effect on global max:** Pre-mean max was ~2312 (dominated by high-experiment-count regions); post-mean max is ~13.9, reflecting the scale of a single experiment's projection volume. The relative ranking of connections within a given injection structure is unchanged; only cross-structure comparisons are affected.

---

## 9. Hemisphere triple-counting — filter to bilateral total (hemisphere_id=3)

**Discovery:** Each structure appears in `structure_unionizes.csv` three times per experiment: `hemisphere_id=1` (left hemisphere), `hemisphere_id=2` (right hemisphere), and `hemisphere_id=3` (bilateral total, exactly equal to h1+h2). Summing all three rows triple-counted every connection. This inflated all volumes by ~3× uniformly, but any asymmetry in ipsilateral vs contralateral signal between structures distorted relative connectivity values.

**Verification:** For experiment 112308468, confirmed `h1+h2 = h3` exactly for all non-zero structures in the CSV.

**Fix:** Added `row['hemisphere_id'] == '3'` filter to the projection volume reader. Uses the bilateral total directly — no information lost, no need to determine per-experiment injection hemisphere. **Effect:** Max mean volume halved from 13.9 → 6.9 (correctly reflecting single-hemisphere scale), relative structure-to-structure comparisons improved.

**Why not ipsilateral-only?** 75% of Allen experiments inject the right hemisphere (injection_z > 5700 µm, midline), so hemisphere_id=2 would approximate ipsilateral for most experiments. However, 25% inject the left hemisphere, where hemisphere_id=1 is ipsilateral — requiring per-experiment hemisphere lookup. The flatmap is also hemisphere-agnostic, making bilateral total the appropriate representation.

---

## 10. Fibers of passage — switch from normalized_projection_volume to normalized_projection_energy

**Discovery:** Red nucleus (RN) showed CP (caudoputamen) as its dominant efferent target at normalized_volume=0.32, with ACB (nucleus accumbens) second. This is anatomically implausible — RN projects primarily via the rubrospinal tract, not to striatum. The rubrospinal tract passes through the internal capsule immediately adjacent to CP, and Allen's `normalized_projection_volume` counts all labeled voxels regardless of whether they are terminal boutons or passing fibers.

**Root cause:** `normalized_projection_volume = projection_volume / injection_volume` measures the fraction of labeled voxels in a structure. A densely packed white matter tract passing through CP labels many voxels, inflating CP's "projection volume" far above genuine synaptic targets. The spinal cord (the actual primary target of the rubrospinal tract) is not on the flatmap, so the dominant signal had nowhere correct to land.

**Fix:** Switched primary metric to `projection_energy / injection_volume` (normalized projection energy).
- `projection_energy = projection_density × projection_intensity` weights voxels by their fluorescence intensity per unit area
- Terminal boutons accumulate fluorescent reporter protein and are more intensely labeled than thin passing fibers
- `projection_intensity` thus discriminates terminal fields from passers-through
- Dividing by `injection_volume` (from experiments.json) normalizes for injection size, equivalent to Allen's own normalization for projection volume
- All 2544 cached experiments had injection_volume; no data loss

**Validation:** After switch, RN's top efferents are RL, IF, RR, CLI, FF, VII, EW, AMB, NPC — midbrain tegmental nuclei and brainstem motor nuclei immediately surrounding RN, all anatomically correct. CP no longer appears in the top 20.

---

## 11. Injection-site exclusion suppresses adjacent primary targets (ENTm → DG)

**Discovery:** ENTm (medial entorhinal cortex) shows AV (anteroventral thalamic nucleus) as its top efferent rather than DG (dentate gyrus). The perforant path (ENT → DG) is the canonical primary output of entorhinal cortex and one of the most studied projections in neuroscience.

**Root cause:** ENTm and DG are anatomically adjacent. When tracer is injected into ENTm, it frequently spreads into DG, causing Allen to mark DG as `is_injection=True` in 13 of 97 cached experiments (13%). Our `is_injection=True` filter correctly removes injection-site artifacts — but DG's strongest labeling occurs precisely in those experiments where tracer reached DG, i.e. the 13 excluded experiments are the ones with the best perforant path signal. The 84 remaining experiments still show DG energy (mean 8× larger than AV in raw terms), but the selection bias suppresses the strongest DG signal.

**AV as a genuine target:** ENTm → AV is a real pathway (part of the parahippocampal → Papez circuit), so it is not anatomically wrong. It just shouldn't rank above DG.

**Attempted fix — density-ratio correction:** For accidentally-labeled structures (is_injection=True but not in inj_struct_set), a correction weight of `max(0, 1 - D_adjacent / D_ref)` was tested, where D_ref is the max injection density of the listed injection structures. This is principled and non-arbitrary: when D_adjacent ≈ D_ref the structure was co-injected (weight ≈ 0, stays excluded); when D_adjacent << D_ref only light spillover occurred (weight ≈ 1, signal mostly recovered). For ENTm/DG specifically, 10 of 13 cases had ratio ≈ 1.0 (genuine co-injection, correctly excluded) and only 3 cases had low ratios where partial recovery would apply.

**Why the correction fails in practice:** `projection_energy` at injection sites is intrinsically orders of magnitude larger than at terminal fields — dense cell body labeling (density 0.5–1.0 × high intensity) vs. sparse boutons (density 0.001–0.1 × lower intensity). Even a weight of 0.8 on an accidentally-labeled injection-site row produces a value that dominates the global normalization. Testing confirmed this: the global max inflated from 7,110 to 43,203, compressing all genuine projections into near-zero normalized values. The energy-scale gap between injection sites and terminal fields cannot be bridged with a density-ratio scalar alone — it would require spatial sublayer information (where exactly within the structure the label is located), which is absent from the cached aggregate CSVs.

**Current approach:** Full exclusion of all `is_injection=True` rows remains the most defensible choice. The ENTm/DG limitation is inherent to the experimental design and is documented here as a known bias rather than a fixable artifact.

**Affected regions:** Any region whose canonical primary target is spatially adjacent to the injection site is susceptible. ENTm/DG is the most prominent example. CA3 → CA1 (Schaffer collaterals) is a similar case (partially addressed by the co-injection exclusion fix in section 7, but the same adjacency bias applies to the `is_injection=True` filter).

---

## 12. Secondary contamination via the fimbria/fornix — DG efferents

**Discovery:** DG's top efferents are IPN (rank 1) and SFO (rank 2), with CA3 at rank 18. The canonical DG efferent is the mossy fiber pathway to CA3.

**Two compounding problems:**

*CA3 suppressed:* CA3 is physically adjacent to DG. 42 of 119 DG experiments mark CA3 as `is_injection=True`, removing it from DG's projection targets. Same adjacency mechanism as section 11 (ENTm/DG).

*IPN and SFO inflated — secondary contamination:* IPN appears in 109/119 DG experiments and SFO in 96/119. This frequency confirms it is systematic, not genuine. When DG is injected, tracer spreads to adjacent CA3, CA2, and hilar interneurons. Those cells' axons travel in the **fimbria/fornix**. SFO sits directly adjacent to the fornix column; labeled fornix fibers pass through its territory in every experiment. IPN lies near the path of the fasciculus retroflexus in the midbrain, close to where hippocampal-related tracts travel. The fimbria/fornix is a dense, brightly labeled bundle, producing high `projection_energy` in every adjacent structure — switching from `normalized_projection_volume` to `projection_energy` (section 10) did not resolve this because the fimbria is thick and intensely labeled, unlike the thin rubrospinal tract.

**Why this is harder than the RN/CP case:** For RN, the fiber-of-passage tract (rubrospinal) is the primary output and CP is not related. For DG, the secondary contamination flows through **accidentally-labeled neighboring neurons** whose own long-range efferents (via the fornix) then appear as DG's efferents. This cannot be resolved by an energy metric or injection-volume normalization.

**No fix available:** Resolving this would require either spatially targeted injections that avoid CA3/CA2, single-cell tracing, or retrograde confirmation from IPN that DG genuinely projects there. The DG efferent panel should be interpreted with this bias in mind: CA2 (rank 3) is likely correct; IPN, SFO, and fornix-adjacent structures are artifacts.

---

## 13. Injection coordinate outlier filter — off-target injection detection

**Discovery:** VTA (ventral tegmental area) showed CP (caudoputamen) as its dominant efferent instead of ACB (nucleus accumbens). Canonical VTA anatomy is the mesolimbic dopamine pathway: VTA → ACB (reward), VTA → PFC (mesocortical). CP is the primary SNc target via the nigrostriatal pathway.

**Root cause:** VTA and SNc are immediately adjacent in the midbrain. Lateral injections nominally targeting VTA frequently clip SNc. Analysis of 47 VTA-attributed experiments revealed a near-binary split by injection z-coordinate (Allen CCF midline ≈ 5700µm):

| Group | N | Mean CP energy | Mean ACB energy | Winner |
|-------|---|----------------|-----------------|--------|
| z ≤ 6100µm (medial, within ~400µm of midline) | 33 | 44 | 397 | ACB ✓ |
| z > 6100µm (lateral, drifting into SNc) | 14 | 694 | 179 | CP ✗ |

Allen's own `injection_structures` field tagged only 8 of the 14 contaminated experiments as SNc — 6 lateral experiments were not annotated as hitting SNc despite showing the nigrostriatal projection signature.

**Fix:** Added `filter_coordinate_outliers()` to the export pipeline. For each structure with ≥5 experiments:
1. Compute the 3D median injection centroid (x, y, z in µm)
2. Compute each experiment's 3D Euclidean distance from that median
3. Compute MAD (median absolute deviation) of those distances
4. Exclude any experiment from a structure's pool if distance > median + 3.0 × MAD

The filter operates on (experiment, structure) pairs — a lateral VTA injection is excluded from VTA's pool but may still correctly contribute to SNc, RN, or MRN. All removals are logged at export time.

**Known limitations — this approach is an approximation:**
- **k=3.0 is somewhat arbitrary.** VTA analysis showed contamination starting at ~450µm from the median; the MAD-based threshold caught most but the exact boundary is structure-specific.
- **Assumes spherical distribution.** Elongated or bilateral structures (e.g. corticospinal tracts, wide hypothalamic zones) may have high legitimate variance in one axis, causing the filter to either over- or under-threshold.
- **Not applied below min_exps=5.** Structures with fewer experiments have no statistical basis for outlier detection.
- **Not applied when MAD=0.** When all experiments are equidistant from the centroid, the filter skips rather than risk false positives.
- **Better approach (not yet implemented):** Check whether each injection centroid falls within the CCF annotation volume boundary for the claimed injection structure. This requires the ~500MB Allen CCF NIfTI annotation volume (`annotation_10.nrrd`) which is not currently cached. Would give true structure-boundary-based filtering with no tunable parameters.

**Structures to monitor at future exports:** VTA, DR (dorsal raphe — near MRN), LC (locus coeruleus — adjacent to PB). Any structure whose canonical output differs sharply from what the data shows is a candidate for coordinate review.

---

## Remaining gaps

- **364 uncached experiments** not yet read (would require downloading from Allen API). May resolve a small number of additional structures.
- **Transgenic vs. wild-type experiments + energy metric interaction:** 83% of experiments (2103/2544 cached) use Cre-dependent tracers that only label specific neuron subtypes. `projection_energy = projection_density × projection_intensity` is the chosen metric (section 10), but intensity is also sensitive to Cre line expression level — a highly-expressing line (e.g. Emx1-Cre labeling dense cortical excitatory neurons) produces higher energy than a sparse interneuron line even for identical connectivity. This makes cross-structure absolute comparisons less reliable. Within a region's own connectivity profile the bias mostly cancels (the same experiment pool contributes to all of its target scores), so within-structure relative rankings are largely unaffected. Wild-type-only filtering would lose 11 structures; not applied.
- **Fibers of passage:** `normalized_projection_volume` includes axons passing through a structure, not just terminal fields. Regions adjacent to major white matter tracts will appear artificially connected to all structures using those pathways. No fix available from Allen's cached data alone.
- **Experiment quality / coordinate filter (partial):** A MAD-based 3D coordinate outlier filter (§13) catches egregious off-target injections but is an approximation. True boundary-based filtering requires the Allen CCF annotation volume (not yet cached). Structures to monitor: VTA, DR, LC.
- **Peripheral targets: cranial nerves, end organs, and spinal cord (future):** The current dataset is brain-only. Many flatmap regions have their primary functional output or input outside the CNS — motor nuclei (VII, AMB, XII, III, IV, VI) project via cranial nerves to muscles; sensory relay nuclei (NTS, SPVC, DCO/VCO) receive from peripheral ganglia; hypothalamic and brainstem autonomic nuclei project to visceral organs via the vagus and sympathetic chain. Spinal cord is entirely absent, so descending motor systems (rubrospinal, corticospinal, reticulospinal) and ascending sensory pathways have no visible terminal target. Without these, efferent panels for motor and autonomic structures are misleading — their dominant output simply doesn't appear. Future direction: add peripheral target nodes (cranial nerve targets, spinal cord levels, major end organs) as non-flatmap entries in the connectivity data, renderable as a separate panel or overlay.
- **Neurotransmitter-specific connectivity layers (future):** The current dataset mixes all neurotransmitter types. Dopaminergic projections are systematically underrepresented because (a) DAT-Cre/TH-Cre experiments label only sparse volume-transmission axons with low projection_energy, and (b) the energy metric favors dense glutamatergic boutons over dopamine varicosities. This makes canonical neuromodulatory pathways (VTA→ACB, DR→cortex, LC→cortex) appear weaker than they functionally are. Future direction: add NT-specific views by filtering experiments.json on Cre driver line (DAT-Cre for dopamine, SERT-Cre for serotonin, Chat-Cre for acetylcholine, Gad2-Cre/VGAT-Cre for GABA). Allen Cre-line experiments use the same CSV format — the pipeline change would be a filter on experiment metadata, not a new data source.
- Non-hole regions with no data at any hierarchy level are listed in Section 6 above.
