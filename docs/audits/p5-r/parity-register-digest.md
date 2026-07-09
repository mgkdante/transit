
========================================================================================
## HOME
Transit's home (apps/web/src/routes/[[lang=locale]]/+page.svelte) is a single-screen "command board" — one Surface stacking a two-column hero (Masthead + live-pulse TerminalPanel), a quiet "What this is" prose block, and a launchpad tile grid. It is honest, competent, and well-composed as a dashboard directory — but it has NONE of yesid's home THEATRE: no scroll journey, no metro-draw intro, no color takeover, no thesis headline (it uses the agency name as h1), no live SQL terminal + PULL FRESH DATA, no manifesto beat, no vertical edge-titles, no hazard-tape rhythm, and no climactic conversion CTA. yesid's home is a 7-movement scroll narrative (HomePage.svelte) that OPENS on an 800%-pinned m

  [IDENTITY] Scroll journey / metro-draw intro / color takeover — the entire opening theatre
    spec: Build features/home/HeroJourney.svelte as a scroll-pinned scene. (1) Add a lazy ScrollTrigger+DrawSVG+CustomEase loader to motion/utils/gsap.ts (mirror yesid loadDrawSVG/loadCustomEase; keep the chrome bundle lean via dynamic import). (2) Ship a transit-native network SVG (a schematic line drawing of the provider's real trunk routes — ornament, aria-hidden, NOT presented as data) as static/images/network-schematic.svg, drawn with a traveling --primary dot. (3) Timeline: 'NEXT STOP: SCROLL DOWN' 

  [IDENTITY] Thesis headline — the two-line display statement instead of the agency name
    spec: Feed the Masthead heading a two-line THESIS (keep the existing orange-dot terminator, brand/Masthead.svelte), demote manifest.display_name to the kicker/CornerMeta. Bilingual options (line1 / line2, EN // FR): (A) 'THE NETWORK, / MEASURED HONESTLY.' // 'LE RÉSEAU, / MESURÉ HONNÊTEMENT.'  (B) 'NUMBERS THAT / DON'T LIE.' // 'DES CHIFFRES / QUI NE MENTENT PAS.'  (C) 'EVERY BUS, / ACCOUNTED FOR.' // 'CHAQUE BUS, / RENDU DES COMPTES.' — (A) is the strongest transit-voice analog of yesid's 'don't brea

  [IDENTITY] Live SQL terminal + PULL FRESH DATA — the signature interaction
    spec: Build features/home/LiveNetworkTerminal.svelte inside a TerminalPanel: (1) a static syntax-highlighted query (reuse yesid's --primary/--terminal-ink/--accent-text span coloring) reading e.g. `SELECT route_short_name, round(avg(abs(delay_min)),1) AS avg_delay, count(vehicle_id) FROM live.vehicles GROUP BY 1 ORDER BY 3 DESC LIMIT 5`; (2) a live results table computed CLIENT-SIDE from the store's live.vehicles by faceting aggregateLive (v1/live/aggregate.ts) per route_short_name — real live rows, h

  [MAJOR] Manifesto beat — full-viewport color-takeover thesis movement
    spec: Promote 'What this is' to features/home/HonestyManifesto.svelte — a full-viewport beat on the blueprint-grid substrate (P5.4 grid tokens already exist site-wide). Compose: a huge display line carrying the honesty thesis ('WHEN A NUMBER IS MISSING, / WE SHOW IT MISSING.' // 'QUAND UNE DONNÉE MANQUE, / ON L'AFFICHE ABSENTE.') at clamp display scale in --primary; a mono terminal prompt line above (reuse TerminalCursor pattern); the existing 3 honesty pillars (Live/Honest/Accountable, +page.svelte:2

  [MAJOR] Vertical edge-titles on home sections
    spec: Give each home MOVEMENT (Manifesto, LiveTerminal, Launchpad/Terminus) a rotated vertical edge-title, alternating L/R, reusing the existing SectionHeading primitive with a rotated-title wrapper (port yesid's .rotated-title CSS block, HomePage.svelte:325-413: vertical-rl, sticky top:50%, --left rotate 180deg, hidden < 1024px with a horizontal mobile fallback). Skip the computeRotatedTitleSize util for v1 — a font-size: min(clamp(3.5rem,7vw,6rem),5.5dvh) is adequate. Titles: 'MANIFESTE/MANIFESTO', 

  [MAJOR] Section rhythm — hazard-tape between movements + numbered stations
    spec: Insert <Separator variant='hazard'> between each journey movement (hero → manifesto → live terminal → terminus), matching yesid's cadence. Number the movements with the existing NumberedChip (brand/NumberedChip.svelte) on each SectionHeading — 01 Manifesto / 02 Network / 03 Explore — so the scroll has station-count rhythm. Optionally wire SectionProgress (already in the brand barrel) as a journey rail. All existing primitives; no new components.

  [MINOR] Schematic / draftsman background ornament layer
    spec: Add a home schematic ornament layer behind the Manifesto and/or hero movement — a -z-10 absolute layer of --primary-tinted repeating-linear-gradient rules + solder-dot radial-gradients (port Manifesto.svelte:230-249 verbatim; it already uses color-mix on --primary and respects reduced-motion). Optionally add corner scale-marks via the existing CornerMarks primitive (brand/CornerMarks.svelte). Texture only, aria-hidden, no data claim.

  [MAJOR] Climactic conversion CTA — the journey has no destination action
    spec: Give the home its ONE per-view conversion moment (the hard-law amber-ground exception): a CTA band at the journey's terminus — 'Open the live map' / 'Ouvrir la carte en direct' routing to /map (openSurface({kind:'map'})), styled amber ground (the single reserved conversion CTA for this view, exactly as the law permits one per view). Keep all launchpad tiles --primary. This turns the closing directory into a destination with a clear primary action, matching yesid's mid-journey CtaBand rhythm.

  KEEP: Honest-absence on the live pulse KPIs is exemplary and AT PARITY with yesid's own honesty  | TerminalPanel chassis (brand/TerminalPanel.svelte) — signal-head titlebar, hazard stripe,  | Full EN+FR provider-agnostic copy templating on short_name/city/display_name (+page.svelte | The Masthead identity family (kicker → display title + orange dot → lede) with CornerMeta  | The launchpad IA — surfaces grouped Explore / Accountability / Trust with weighted feature

========================================================================================
## /MAP (FEATURES/MAP)
The map is the kinetic flagship — the live canvas, motion controller, encoding doctrine and full-bleed/overlay laws are genuinely at parity and must be kept. But every piece of CHROME floating over it is bespoke, generic-card CSS that composes ZERO brand primitives. TerminalPanel, CornerMarks, CornerMeta, Masthead, StatusDot signal-head, and hazard Separator all exist in lib/components/brand/ and the map imports none of them (verified: grep for those names across features/map/*.svelte returns nothing). yesid's brand IS the terminal-window chassis (HeroSqlPanel, TerminalPanel: 2px --border-rule frame + signal-head titlebar + hazard stripe + mono footer readout) plus draftsman schematic orname

  [IDENTITY] Overlay panels use generic rounded-card CSS instead of the TerminalPanel chassis — the single defining brand element yesid uses everywhere
    spec: Re-vessel every floating panel as <TerminalPanel>. Near-me: title='stm@live:near-me>' tag='GEO', body = the search form, footer readout = origin + nearest-N. Filter panel: title='filter:state>' with the chips in the body, footerItems = active-count. Hover peek: compact TerminalPanel (noGlow, noPadding). All get the signal-head (StatusDot green pulse + caution/stop @25%), the hazard Separator stripe, 2px --border-rule frame, --surface-2 solid (occlusion law). This alone flips the map from 'map wi

  [MAJOR] Title block is bare kicker+heading floating text — no Masthead grammar, no signal head, no hazard tape, and it uses a forbidden text-shadow
    spec: Rebuild MapHeadTitle as a compact horizontal Masthead-derived strip: SectionLabel variant='station' kicker ('RÉSEAU · EN DIRECT'), SectionHeading dot heading ('Carte en direct.'), the freshness folded into a meta slot, closed by a short hazard Separator. Kill the text-shadow — instead seat the title inside a small solid --surface-2 terminal lozenge (occlusion) so it survives over tiles WITHOUT text glow. Reuse Masthead's SectionLabel/SectionHeading/Separator so the map head reads byte-identical 

  [MAJOR] No schematic/draftsman ornament layer — the canvas has only a soft vignette where yesid frames heroes in full blueprint linework
    spec: Add a pointer-events:none schematic frame layer over the canvas edges (NOT over the map center — respect the marks): Beck-style route linework in the top-left/bottom-right dead corners at color-mix(--primary 12%), plus a mono DWG ref-label strip ('DWG: STM-LIVE-NET · SCALE NTS · REV.LIVE') echoing ProjectsBlueprint's labels. This is a NEW map-local primitive (MapSchematicFrame) composing the Beck-line pattern from ManifestoEdgeLeft; it lives in the vignette's z-band. Reinforces 'same transit-dra

  [MAJOR] Canvas edges are unframed (bare vignette) — no CornerMarks tick frame, no coordinate CornerMeta readout
    spec: Drop <CornerMarks size='md' opacity=0.4> as an aria-hidden overlay inside .map-surface, and a <CornerMeta>-style mono coordinate readout pinned to one dead corner showing REAL live values: center lat/lon, current zoom, 'ÎLE DE MONTRÉAL', vehicle count ('617 TRACKED'). Wire it to the existing camera + live.vehicles reads (already reactive in MapHero). Honest-data only (CornerMeta's A4 rule). Gives the canvas the instrument frame yesid heroes wear.

  [MAJOR] Live status is a lone floating pill, not the signal-head terminal readout that is yesid's live-data voice
    spec: Fold freshness into a single terminal-strip readout with the signal-head: StatusDot green pulse (fresh) / caution (stale) + a mono prompt line 'stm@live:vehicles> 617 tracked · 24s ago'. Either as the meta slot of the re-chassied title TerminalPanel, or a standalone mono strip using the signal-head markup from TerminalPanel:80-90. This is the pulsing-live-data beat that makes the map feel plugged into the same warehouse as yesid's SQL panel.

  [MINOR] Detail panel opens as a generic RightPanel, not a terminal record readout
    spec: Render the selection inside a TerminalPanel: title = entity idiom ('vehicle:40123'), tag = route badge ('51 E'), meta = live status, footer readout = the honest fix stats (lat/lon · speed_kmh · reported_utc, plus the not-reporting note). Selecting a bus should read like querying a record in the yesid terminal. Keep MapSelectionDetail's data logic; wrap its zones in the chassis + hazard stripe.

  [MINOR] Filter/controls panel is an unframed floating div, not a titled terminal instrument
    spec: Wrap the controls snippet in a TerminalPanel (title='controls:filter>', noGlow for dense data). Put the motion toggle in the titlebar meta slot, hazard-stripe it off from the chip body. The filter chips (state color swatches — frozen) stay; only the vessel gains the terminal frame so it matches the near-me + detail panels as a coherent instrument set.

  [MINOR] Numbered/wayfinding rhythm and MetroStation ornament are entirely absent from the map's legend and near-me results
    spec: Give the nearby-stops results a numbered wayfinding rhythm using NumberedChip (01/02/03 …) + a MetroStation node glyph per row, so the near-me list reads as a route sequence, not a generic search dropdown. Low-effort, high-brand-signal; composes existing primitives only.

  KEEP: Full-bleed canvas law + 13-layer absolute-overlay architecture (MapHero.svelte:1168-1252,  | The ONE amber conversion CTA is correctly placed and colored: near-me toggle rides --accen | Encoding doctrine (one color per entity type, state→combinable filter that repaints+hides) | URL-driven filter spine (createFilterStore + goto replaceState, MapHero.svelte:212-231) ma | Honest-absence discipline: liveEdgeState / feed-stall banner / per-bus not-reporting note 

========================================================================================
## /NETWORK + /HOTSPOTS + /REPEAT-OFFENDERS (DASHBOARDS)
Same as above.

  [IDENTITY] Vertical edge-title column (the signature yesid listing chrome)
    spec: Promote yesid's edge-title-column into a transit EdgeTitle brand primitive (lib/components/brand/EdgeTitle.svelte): a zero-width position:absolute rail pinned to the Surface left gutter (honor the existing .surface-shell.network anchor), display:none <1024px, writing-mode:vertical-rl + rotate(180deg), sticky top:0 height:100dvh. Props: text (the surface name from t.heading — 'RESEAU'/'NETWORK', 'POINTS CHAUDS'/'HOTSPOTS', 'RECIDIVISTES'), plus the top+bottom MetroStation dot clusters. Font: --fo

  [MAJOR] Schematic blueprint background layer behind the masthead
    spec: Give the Masthead an optional blueprint slot: add a `backdrop?: Snippet` zone rendered as a full-bleed absolute layer behind .masthead-head (z-0, aria-hidden), reusing transit's existing grid/ornament tokens (the same blueprint-grid used by TerminalPanel/EntityDetail per grep). Compose a lightweight transit BlueprintShell-equiv: faint SVG linework at ~0.12 opacity (double in light per yesid's BlueprintShell.svelte:92-99 light-mode bump) + 4 corner crosshairs + 3 mono --text-micro ref-labels carr

  [MAJOR] Corner-readout density (CornerMeta) on the dashboard heads
    spec: Pass Masthead's existing `cornerMeta` snippet (already plumbed, Masthead.svelte:58/93-96) a <CornerMeta crosshair> on each surface. Fill real data: topLeft = provider ('STM'), topRight = generated_utc (reuse FreshnessStamp value), bottomLeft = network→'{routes} lignes · {stops} arrets' / hotspots→'{total_ranked_routes}+{total_ranked_stops} classes' / repeat→'{total_ranked_trips}+{total_ranked_vehicles}', bottomRight = active window caption (t.window[grainKey]) or build short-hash. Cheap (no new 

  [MAJOR] Verdict/#1-callout as living terminal theatre, not dead text/card
    spec: Wrap the hotspots verdict + the repeat-offenders hero in TerminalPanel to match network's LIVE band. hotspots: TerminalPanel title='HOTSPOT // WORST' tag=grain, body = the existing verdictLine + linked #1 name, footerItems=[{severe rate},{n},{window}] from topHotspot (severe_pct/observation_count already computed at HotspotsBoard.svelte:208-220). repeat: TerminalPanel title='RECIDIVISTE // #1' with the heroName/heroRate/heroStreak (already computed, RepeatOffenders.svelte:190-211) as body + a fo

  [MAJOR] Numbered 01/02 section rhythm across the group
    spec: Give hotspots and repeat a numbered spine even though each has fewer sections: number the tabbed ladder region + the tray as 01/02 (or number the route|stop / trip|vehicle sub-boards) via SectionHeading number={n}. At minimum add number={1} to the primary ladder heading and number={2} to the un-ranked tray heading in HotspotSection.svelte:141-175 and RepeatOffendersSection.svelte:167-213. Pair with SectionProgress (already used in network's rail, NetworkSurface.svelte:578) so all three dashboard

  [MAJOR] Metro-connected numbered ladder rows (connective tissue)
    spec: In HotspotSection and RepeatOffendersSection, wrap each ranked row in the yesid ProjectListingPage pattern: a flex row of <MetroStation index={rank} showLine /> + the existing RankedRow (untouched — the frozen chart mark stays exactly as-is, MetroStation is chrome beside it, not inside the bar). Cap pulseDelay to a single quiet stagger (or 0 on the dashboards to respect scroll-honesty). This adds the numbered-node rhythm and vertical line spine without touching dataviz marks. The un-ranked tray 

  [MINOR] Control-rail consistency: repeat-offenders on the legacy top-rail
    spec: Migrate repeat-offenders to SurfaceRail exactly as hotspots did (HotspotsBoard.svelte:300-337 is the drop-in template): build a railContent snippet with the View overline + the GrainPicker (grainSegments from grainAvailability) + the window caption, render <SurfaceRail> only when showGrainPicker, and switch the region to the 2-col [rail|content] grid. Removes the last SurfaceControls consumer in the group and makes all three dashboards share one rail idiom.

  [MINOR] Left-hugged command-board masthead treatment (density parity)
    spec: Compose the above three head-level moves into one 'dashboard command-board' recipe applied uniformly: EdgeTitle (gap 1) + Masthead backdrop blueprint (gap 2) + CornerMeta (gap 3), plus promote each surface's status chips (FreshnessStamp, ConformanceBadge, feed-age, generated_utc) into a single mono meta rail rendered via Masthead's meta snippet with hazard-tape close. Document as a shared spec so network/hotspots/repeat instantiate the identical head chrome — the group then reads as one command 

  KEEP: Masthead + closing hazard-tape head family is used consistently on all three surfaces (Mas | Network's glass SurfaceRail + numbered TocNav + SectionProgress is genuine map-style rail  | Network's LIVE band already ships real terminal theatre: TerminalPanel with the three-aspe | StationTabs signage-active tabs (route|stop, trip|vehicle) match the yesid StationTabs idi | Honest-absence doctrine and Chart Doctrine absolute domains are intact everywhere (AbsentV

========================================================================================
## /LINES + /STOPS + /SEARCH (LISTING SURFACES) VS YESID /PROJECTS GRAMMAR
These three surfaces are OFF parity at the identity level. yesid /projects is a layered draftsman composition — a sticky giant VERTICAL edge-title + accent-rail grid, a full-bleed schematic blueprint header (TBM linework, crosshairs, ref-labels, scale marks), a numbered MetroStation station-spine down every entry, framed terminal-chrome preview cards with connected metro-chip chains, and a persistent left filter rail. Transit's listings are a correct-but-flat Masthead + top ControlsRail + naked EntityList — right tokens, no theatre. The single biggest move: restore the shared listing SKELETON (a `+layout` porting yesid's "Recipe 4: Edge Title Grid" — edge-title column, accent rail, left filt

  [IDENTITY] Vertical giant edge-title + accent-rail listing grid (yesid "Recipe 4: Edge Title Grid")
    spec: Add ONE shared listing layout (a +layout.svelte for lines/stops/search, or a ListingEdgeLayout composed inside each Surface) porting Recipe 4 verbatim: desktop grid `auto 2px 1fr`, sticky vertical-rl edge-title (clamp(6rem,12vw,13rem)/900, orange dot), metro-dot station lead-ins (reuse the existing metro-dots markup or MetroStation), accent-rail at --primary 35%. Edge titles from existing short copy — Lines/Lignes, Stops/Arrêts, Search/Recherche. Desktop-only (min-width:1024px); mobile keeps the

  [IDENTITY] Full-bleed schematic blueprint header (draftsman linework + crosshairs + ref-labels + scale marks)
    spec: Build a transit BlueprintShell (port yesid's brand/BlueprintShell 1:1 — crosshairs + 3 ref-labels + hero/details snippets) and a ListingBlueprint header behind the Masthead. Port a transit-native schematic drawing from yesid's own svg/transit set (BlueprintStationSection / BlueprintTrackPlan / BlueprintCatenary already exist there). Ref-labels in transit voice EN+FR ('SEC-NET / STM','DWG: ROUTE-INDEX','ÉCH. NTS'). Keep opacity 0.10-0.18 (dark) / ~0.42 (light) so rows stay scannable. DrawSVG scro

  [IDENTITY] Numbered MetroStation station-spine down every listing entry (01/02 rhythm)
    spec: Thread MetroStation index+showLine down the single-column result lists. STRONGEST fit: StopsIndex by-line/by-direction groups (visibleGroups, StopsIndex.svelte:307-316) — a stop sequence IS a metro line, so showLine draws the real track and index = the seq station number. Lines index + Search groups get numbered entries 01.. (showLine optional, pulseDelay=i*0.4 stagger). For the lines 2-up grid, either drop to a numbered single column on desktop or number within each column so the spine stays ho

  [MAJOR] Framed terminal-chrome preview tiles + hover glow vs flat text rows
    spec: Give each grid tile the framed card chassis: 3px --border-brand hairline + --radius-lg + a cursorGlow-equivalent hover (transit motion actions) + title→--primary on hover, matching ProjectCard.svelte:301-303/160. For the lines catalogue specifically, promote high-signal tiles to a TerminalPanel-framed card (mono `stm:gold> route 105` header line) to echo yesid's terminal-chrome preview cards — but keep density: frame + glow only, no per-row media banner, so the list stays scannable.

  [MAJOR] Connected metro-chip route CHAINS vs isolated mono pills
    spec: Build a RouteChain mini-primitive: the stop's routes as connected roundels on a short horizontal --line-amber track (reuse MetroStation roundel geometry + StopLabel plate voice), each roundel = the route short-name, guarded GTFS colour allowed on the roundel fill (the one dynamic colour, already sanctioned in EntityRow.svelte:72-76). Replace .entity-row-routes with RouteChain. On line rows, show a mode-glyph→direction chain. Static by default; the track can light on hover (alpha-only, safe under

  [MAJOR] Persistent left filter rail vs filters buried in the top head
    spec: On desktop, move the sort/status (lines), line-combobox/sort (stops) and scope/mode (search) filters into a persistent sticky left rail, extending the Recipe-4 skeleton to [edge-title][accent-rail][filter-rail clamp(220px,22vw,320px)][content] — mirroring yesid's nested listing-grid. Reuse SurfaceRail or a ListingFilterRail; group controls with the divider-dashed rhythm and mono section overlines transit already uses (.lines-control-label). Keep the mobile collapsible top rail as-is (a left colu

  [MINOR] Corner schematic readouts + scale-mark annotation (drafting margin)
    spec: Feed Masthead's cornerMeta slot on all three surfaces with REAL data (A4 law): total lines / total stops / filtered-N / generated_utc as mono corner readouts, plus CornerMarks crosshairs at the results-zone corners and a thin scale-mark rule. Pure composition of existing primitives (CornerMeta + CornerMarks + Separator) — no new component, adds the draftsman texture layer cheaply.

  [MAJOR] Kinetic filter/sort reflow (FLIP) vs instant swap
    spec: Add a FLIP reflow on filter/scope/mode changes over the keyed rows (data-batch target), reduced-motion-gated. It does NOT fight scroll (legal on data surfaces — it animates position, never hijacks the wheel), so it satisfies the P5.3 no-scroll-jacking law while restoring theatre. Keep the worst-sort freeze-on-settle for streaming badges; FLIP only the discrete filter transitions. Layer magnetic on tag/mode chips for micro-kinesis.

  KEEP: Masthead already closes on the hazard-tape Separator (Masthead.svelte:112, variant="hazard | Honest-absence idle census bands (StopsIndex.svelte:322, SearchSurface.svelte:311) are on- | The station-voice kicker + orange-dot SectionHeading + ~52ch lede zone order in Masthead.s | Reliability badges + the ONE guarded GTFS colour swatch (EntityRow.svelte:72-76) give the  | brand/ already holds byte-faithful ports of MetroStation, StopLabel, NumberedChip, Termina

========================================================================================
## /LINES/[ID] + /STOP/[ID] + /TRIP (LINE RELIABILITY · STOP DETAIL · TRIP)
The tokens, honest-absence, and the reliability §0-§4 rider-question arc are genuinely at parity — the reliability tab is the site's gold-standard story. But the DETAIL HEAD is where these three surfaces fall off a cliff versus yesid /projects/[slug]. yesid opens with a full-bleed manifesto hero: --manifesto color ground, dot-grid schematic, interactive canvas, cursor:crosshair, edge telemetry columns framing a display-scale glow title, then a 3-col body with a persistent stat rail. Transit's line/stop/trip heads are a plain flush-left text stack on the page background with three whisper-corner readouts hidden below 768px — a form label, not a masthead. The single biggest move: give all thre

  [IDENTITY] Detail head has no manifesto hero band
    spec: Extract DetailShell's header band (.detail-header-grid over --manifesto, padding-block clamp(1.75rem,4vw,3rem), position:relative+overflow:hidden) into a shared DetailHeaderBand wrapper. Wrap EntityDetail's .surface-head AND TripDetail's Masthead inside it. Add min-height ~380px + cursor:crosshair. Tokens exist: --manifesto (app.css:164), .detail-header-grid (app.css:374). Transit-local, no new tokens.

  [IDENTITY] No edge telemetry columns framing the title
    spec: Build LineTelemetryEdge/StopTelemetryEdge/TripTelemetryEdge reusing yesid's edge grammar verbatim (font-mono 10px, --chrome-ink-opacity, line-height 2.4, uppercase, absolute left/right, aria-hidden). LEFT = identity+state (LINE {id} / TYPE / FIRST / LAST / STATUS→verdict word); RIGHT = topology (STOPS n / DIRS n / LIVE n NODES). Real v1 data only (route file + live index + reliability); a null datum drops its line (yesid's no-invented-defaults rule, ProjectDetailHeader.svelte:35-38). Render insi

  [MAJOR] Title is not display-scale — the line id reads small
    spec: Add a `display` size variant to Masthead/SectionHeading rendering the detail-head title at --text-display (exists, app.css:90), uppercase, font-black. Glow via the header dot-grid ground / sanctioned rest-glow — NOT text-shadow (glow law: glow never text). Line id becomes the hero; stop name + trip id follow the same scale. Keep exactly one h1 + one orange dot per page (Masthead invariant).

  [MAJOR] No persistent glance stat-rail — key facts buried in tabs
    spec: Build LineGlanceRail/StopGlanceRail composing MetricDisplay + small TerminalPanel stat cards (first/last bus · directions · live buses · OTP verdict · served stops · active alerts). Seat the surface in a 2-col [tabs | glance-rail] grid at ≥1024 (glance sticky top:var(--chrome-offset)), reflowing to a mobileSummary strip below — reuse DetailShell's grid+sticky mechanics WITHOUT adopting its long-scroll ToC narrative model (tabs stay the data-surface spine).

  [MAJOR] §0 verdict is a passive banner, not a living terminal
    spec: Compose selectVerdict output INTO a TerminalPanel: titlebar `stm@transit:gold`, tag `SELECT`; body = a mono query line (SELECT otp FROM line {id} WHERE window='today') + the verdict sentence + OTP BAN as the 'result'; footerItems = n · window · generated_utc. Add the sanctioned amber re-query affordance (the ONE view CTA — but line already spends amber on map drilldown, so make re-query a quiet mono action, not amber-ground). Frozen chart marks untouched — chrome around them only.

  [MINOR] No numbered ToC rail on the reliability narrative
    spec: Add a sticky TocNav rail (transit already has TocNav + toc.ts via DetailShell) listing §0-§4 with number badges, seated in the glance/tab grid from the glance-rail gap. Number the cluster headings 0-4. Pure reuse of existing primitives; retires the scope-glyph decoding burden.

  [MAJOR] No schematic ornament / draftsman texture layer
    spec: Inside the new DetailHeaderBand layer (all aria-hidden watermark, --chrome-ink-opacity): CornerMarks (size md, opacity 0.12), a corner crosshair SVG, a top mono tick-ruler, and — for the transit domain — a faint route-schematic motif (a metro polyline with a station tick, echoing yesid's traveling-dot metro map) drawn from the route's own direction geometry. Texture only, no data marks; keeps the four-color + frozen-marks laws.

  [MINOR] Trip head diverges + no conversion close
    spec: Unify all three heads on the same DetailHeaderBand + telemetry-edge assembly (trip's ephemeral stand-down keeps a lighter variant, TripDetail.svelte:191-197). Add a quiet closing register at surface end ('See it live on the map') that REUSES the single existing map conversion rather than adding a second amber ground — a closing beat, not a new CTA.

  KEEP: Reliability §0-§4 internal arc (RouteReliabilityClusters + Section0-4): rider-question IA, | Honest-absence doctrine throughout: EdgeState emptyReason inference (RouteDetail.svelte:20 | Deep-linkable ?tab mirror + metro station-signage active-tab chip (EntityDetail.svelte:142 | Real-data-only telemetry primitives — TerminalPanel, CornerMeta, FreshnessStamp (StopDetai | Colour/token discipline: --primary interactive-only, dataviz status fills on delay marks, 

========================================================================================
## /METRICS + /STATUS (P5.4C DETAILSHELL PORTS)
The DetailShell ports nailed the STRUCTURE (dot-grid band, hazard tape, 1fr-2fr-1fr grid, numbered ToC, stat rail, display h1+dot+lede) but shipped the yesid projects/[slug] header as a THIN LEFT-ALIGNED STRIP where yesid runs a 420–440px theatrical full-bleed band. The single biggest move: rebuild the DetailShell header as the real yesid ProjectDetailHeader band — full-bleed behind the nav, min-height ~440px, crosshair cursor, centered content, the interactive ManifestoCanvas layer, the schematic ornament suite (CornerMarks + chevrons + crosshair + grid-tick row), and upright mono edge-metadata instrument columns — instead of the current padded dot-grid strip with a 4-corner CornerMeta. Sep

  [IDENTITY] Theatrical header band (composition, height, cursor, behind-nav, centering)
    spec: Rebuild DetailShell's header band to the ProjectDetailHeader envelope: add min-height:clamp(420px,52vh,440px); background:var(--manifesto) (already there); cursor:crosshair; and the negative-margin/padding-top pair off the existing --chrome-offset/nav-clearance knob so the band bleeds edge-to-edge behind the floating NavPill. Center the header content (align-items/text-align center) for these two detail surfaces via a DetailShell prop (e.g. headerAlign='center') so the house left-aligned Masthea

  [IDENTITY] Interactive ManifestoCanvas pointer layer
    spec: Port ManifestoCanvas into a transit brand primitive (HeaderCanvas.svelte) that takes containerEl and paints a pointer-reactive schematic over the --manifesto ground, respecting prefers-reduced-motion (static fallback) and staying pointer-events:none/aria-hidden. This is a NEW primitive but is pure header ornament (not a data mark, not scroll-jacking — legal on data surfaces). Mount it as a DetailShell header layer behind the content inner, bound to the band element. Reuse @yesid/motion timing to

  [MAJOR] Schematic corner-ornament suite (CornerMarks + chevrons + crosshair + grid-tick row)
    spec: Compose the existing brand/CornerMarks (size=md, opacity 0.12) into the DetailShell header absolute-decoration layer, and add the three sibling ornaments as a small DetailShell HeaderOrnament block: 3 chevron divs (top-right), a 44px stroke=var(--primary) crosshair SVG (bottom-right), and a mono --text-micro tick row (top-center) whose numbers derive from the real 80px grid step (0,80,160…480) using --primary at --chrome-ink-opacity. All aria-hidden, hidden <1024, tokens only.

  [MAJOR] Upright mono edge-metadata instrument columns
    spec: Add a DetailShell EdgeMeta layer (aria-hidden, hidden <1024): two absolute mono columns pinned at the band's vertical center-left/right, styled to the yesid constants (10px, letter-spacing 1.5px, line-height 2.4, color --primary @ --chrome-ink-opacity). Feed it REAL data honest-absence-style: /metrics left = PROVIDER/DATASET/GENERATED/SOURCES + a separator + metric&family counts; right = the five reliability clusters as LAYER rows + NODES=metric count. /status left = lanes passing/total, feeds f

  [MAJOR] /status aggregate is a framed sentence, not living terminal theatre (§C5.9)
    spec: Make the aggregate panel read as a real terminal health query: render a mono prompt line (e.g. `transit@gold:health>` + a lane-gate 'query' string), the N/M-passing verdict as the result row, and populate footerItems with real stats (lanes total, feeds fresh, generated_utc from prov.generated_utc). Add a TerminalPanel `aspect` prop so the signal head reflects laneStat.worst (green when all pass, caution/stop lit when a lane fails) instead of always-green — the frozen StatusDot marks are reused, 

  KEEP: Dot-grid header ground ported 1:1 — transit app.css:374-390 mirrors yesid app.css:331-337  | Closing edge-to-edge hazard tape rhythm is faithful — DetailShell.svelte:112 (Separator va | 3-column body grid is exact parity — DetailShell.svelte:206-215 (1fr 2fr 1fr, gap 2rem, st | Numbered ToC rhythm + SEC n/m readout + sticky stat rail match yesid's TocNav badge gramma | Display h1 size + orange dot + lede measure are at parity — SectionHeading .section-headin

========================================================================================
## /RECEIPT + /ALERTS
The receipt gets the terminal WINDOW right (TerminalPanel is a faithful port of yesid's TerminalChrome) but fills it with a mini-dashboard of rounded metric cards, so the flagship never reads as an issued receipt or terminal printout — the accountability metaphor fails at the body level. Single biggest move: rebuild the frame interior as a mono LEDGER document — prompt header → tabular label/value line-items → full-width count strip → tone-colored display verdict — the way yesid renders HeroSqlPanel. Alerts is a competent, honest log-with-filters; its identity gap is composition, not content: it sits as a narrow centered island where yesid /projects is a full-bleed, left-edge-titled listing 

  [IDENTITY] Receipt terminal-frame body renders as a mini-dashboard of rounded metric cards instead of a receipt/terminal ledger document
    spec: New `ReceiptLedger` presenter rendered inside `<TerminalPanel noPadding>`: mono two-column line-items — label left (`--font-mono`, `--text-micro`, uppercase, `--muted-foreground`), value right (`--font-mono`, `font-variant-numeric:tabular-nums`, `--accent-text`), exactly the HeroSqlPanel results-grid grammar (HeroSqlPanel.svelte:76-86). Separate rows with `--border-subtle` hairlines, no radius/border/card chassis. Fold the four headline figures + affected counts into ledger rows; keep the inline

  [IDENTITY] Alerts surface is a narrow centered island, not a full-bleed left-edge-titled listing
    spec: Drop the surface content-cap (AlertHistory.svelte:417-420). Let the masthead + breakdown + [rail|log] grid breathe wide/edge-to-edge like `.listing-grid`; anchor the h1 to the left page gutter (the listing-header-text grammar) rather than a centered block. The glass filter rail already exists (SurfaceRail); only the centering must go. Keep the log column itself at its 52rem reading measure INSIDE the wide grid, so prose stays legible while the composition goes full-bleed.

  [MAJOR] The day-verdict sentence — the receipt's payoff — renders as quiet body prose, not a display-type tone-keyed beat
    spec: Promote `.receipt-day-verdict` to `--font-heading` at display/heading scale and color-key the leading clause word by tone via the existing reliabilityVerdict floors (90/75 → on-time/warn/poor tone tokens) — the exact fix the home pulse got (§C5.1). Keep the honest templating + GC2 stand-down clause verbatim. Glow never text (color only).

  [MAJOR] affected|worst renders as a ragged two-card row instead of a full-width receipt count strip
    spec: Render affected counts (lines/stops/alerts/vehicles) as ONE full-width horizontal count strip spanning the frame — the proof-metric-strip grammar: equal `1fr` cells with `--border-subtle` inter-cell dividers, value `--font-heading`/`tabular-nums`/`--accent-text` over mono uppercase label. Drop worst-of-day out of the side-by-side grid to its own full-width ledger label/value pair below the strip. Replace the `.receipt-layout` grid-areas entirely; the ragged-height problem disappears because ther

  [MAJOR] Receipt lacks the issued/queried prompt-header ceremony that makes a terminal panel feel live
    spec: Add a prompt header row at the ledger body top: a pulsing `<StatusDot color="green" pulse>` (vendored) + a mono muted prompt echoing the day query, e.g. `transit@stm:receipt> issued 2026-07-08`, with a `--border-subtle` hairline beneath — the HeroSqlPanel header grammar (HeroSqlPanel.svelte:47-56). EN+FR prompt copy in receipt.copy. Amber stays interaction-only: do NOT copy yesid-home's amber 'PULL FRESH DATA' button here (would break the one-amber-CTA-per-view law; the receipt is read-only).

  [MAJOR] Alerts log is a flat card stack with no numbered metro-timeline spine — reads as a data table, not a chronology
    spec: Wrap each alert-history-row in a flex row led by `<MetroStation index={i+1} showLine pulseDelay={i*0.4}>` (brand/MetroStation.svelte), exactly the ProjectListingPage.svelte:273-283 pattern — a numbered newest-first timeline with the vertical --line-amber spine connecting entries. Keep the severity glyph + tinted card as the row body. This distinguishes the accountability LOG from a data table and adds the journey rhythm without touching frozen chart marks.

  [MAJOR] Receipt has no schematic drafting-margin ornament (CornerMeta / ref-labels) — no texture layer on the 'issued document'
    spec: Drop a `<CornerMeta>` into the receipt Masthead `cornerMeta` slot with REAL data (provider · generated_utc · date-key · build short-hash) — primitive + slot already exist. Add a ruled drafting ref-label on the TerminalPanel margin (`DWG: RECEIPT · REV` / `SCALE NTS`) via CornerMarks, echoing the BlueprintShell labels grammar (ProjectsBlueprint.svelte:15). aria-hidden, pointer-events-none, hidden <768 (hero-zone-only rule). Texture, never a data mark.

  [MINOR] The three S13 receipt cuts are a flat stacked list with no numbered 01/02/03 rhythm
    spec: Give the three cuts a numbered spine: either MetroStation nodes (brand/MetroStation.svelte, showLine) in a flex-row-per-cut like ProjectListingPage.svelte:273-283, or numbered SectionHeading chips (§C2.7 D4 numbered-chip variant — already the sanctioned section-title renderer). Adds journey rhythm + connective tissue to the hoisted line-groups without new primitives.

  KEEP: TerminalPanel (brand/TerminalPanel.svelte) is a faithful, at-parity port of yesid's Termin | The honest-absence doctrine is exemplary and beyond yesid: null → styled 'no-observations' | Alerts §C5.13 story order (headline → Tier-2 breakdown → filter rail → log) with all five  | The alerts SurfaceRail glass left filter rail — sticky 2-col [rail|log] at ≥1024, pill→she | The day-verdict sentence itself EXISTS and is honestly templated from the receipt's own nu

========================================================================================
## SITE-WIDE TEXTURE & THEATRE INVENTORY
Transit HEAD ported yesid's *primitives* faithfully (TerminalPanel, CornerMeta, Footer, hazard tape, tokens, four-color doctrine all at parity) but shipped almost none of the *theatre* those primitives were built to stage. Every yesid surface is a layered composition — a schematic BlueprintShell drawing behind, a rotated giant edge-title down the margin, GSAP scrub scenes drawing a metro line as you scroll, a full-bleed color-takeover thesis, glow-at-rest beams — and transit renders flat card-on-background boards instead. The single biggest move: stand up the scroll-scene layer. yesid's entire "metro JOURNEY" identity (HeroBanner pin + MetroNetwork DrawSVG + Manifesto crescendo + Closer brea

  [IDENTITY] Scroll-scene machinery (the metro JOURNEY)
    spec: Promote yesid scrubs/ into transit as a Tier-2 motion layer (vendor/design/motion/src/scrubs/ OR transit-local src/lib/motion/scrubs/): createHeroTimeline, createCrescendoScrub, backgroundBreathing, createDrawScrub. Add loadDrawSVG/loadCustomEase to vendor gsap.ts (currently only ScrollTrigger/SplitText eager). Port MetroNetwork.svelte as the home hero's line-draw canvas. All scrubs already self-no-op under prefers-reduced-motion — keep that. This is the load-bearing build for R2; every other th

  [IDENTITY] Schematic / technical-drawing background layer
    spec: Port BlueprintShell.svelte as a transit-local brand primitive (SVG art is domain-specific → stays transit-local, not @yesid). Build a transit draftsman SVG set (bus/route schematic, stop platform section, network line diagram — the transit analog of yesid's tunneling drawings) as the hero/details snippets. Mount it behind narrative headers (home hero, listing headers on lines/stops/hotspots) using the existing --primary color-mix opacity tuning. Wire createDrawScrub so the linework draws on scro

  [IDENTITY] Vertical edge-titles
    spec: Restore the edge-title-column as a transit-local layout primitive (EdgeTitleColumn.svelte) wrapping the listing content in a 3-col grid [auto | 2px accent-rail | 1fr], ≥1024 only, exactly per projects/+layout.svelte. Feed it the localized surface name (Lignes/Lines, Arrêts/Stops, etc.) + orange edge-dot. Compose the existing MetroStation dots top/bottom. Mount at the route +layout level for lines/stops/hotspots/alerts/network listing surfaces. Pure CSS, no motion dependency — cheapest high-impac

  [MAJOR] Color-takeover sections
    spec: Add a full-bleed takeover section between hero and 'What this is' — a 100dvh band on a saturated ground (dark --manifesto analog and/or a full --accent orange beat, honoring the ONE-amber-ground-CTA law by making this a NARRATIVE band, not a conversion CTA). Stage the transit thesis (honesty-first / 'no fabricated zero') at Manifesto display scale (clamp giant condensed type). Compose circuit-grid + hazard corners + crescendo scrub. IMPORTANT: reproduce the drama WITHOUT text-shadow glow — yesid

  [MAJOR] Terminal-chrome preview cards + live-SQL panel
    spec: Reuse the kept TerminalPanel as the chrome for two new compositions: (1) a live-SQL hero panel reading transit's own /v1 (the honest analog of yesid pulling transit data) with the amber 'PULL FRESH DATA' as the one permitted ground-CTA on that view; (2) a numbered departure-board (TerminalPanel + numbered 01/02 rows via NumberedChip) for the launchpad or a surface index. No new chrome primitive needed — compose existing TerminalPanel + NumberedChip.

  [MAJOR] Glow-at-rest ambience
    spec: Paint at-rest ambience using the already-vendored sectionGlow (attach to hero + takeover sections, consumer ::before radial per its documented contract) and add a transit CloserFloodlight analog (blurred --accent beam behind a narrative closer). Wire backgroundBreathing (once promoted with the scrubs in Gap 1) on the takeover band. All alpha-only radials → SAFE-ALWAYS under reduced-motion. Reminder: beams/backgrounds only — never text-shadow glow (HARD LAW).

  [MINOR] Numbered rhythm + rotated section headings
    spec: Wire MetroStation index+showLine into EntityRow/EntityList so listing rows carry the numbered station rhythm (matches ProjectListingPage). Add alternating rotated SectionHeading treatment to the home narrative sections (reuse the rotated-title--left/right pattern) to give the scroll its numbered/kinetic cadence. Both compose existing primitives — no new build.

  [MINOR] Schematic marginalia density across surfaces
    spec: Once BlueprintShell lands (Gap 2), pass transit-voice ref-labels ([SEC / NETWORK-DIAGRAM], [DWG: ROUTE-SECTION], [SCALE NTS | REV.x]) so every narrative/listing header carries the crosshair+label frame. Layer CornerMarks on detail cards. Keep aria-hidden decoration; reuse existing CornerMeta/CornerMarks primitives — pure composition, ships with the BlueprintShell work.

  KEEP: TerminalPanel.svelte (227 lines, brand/) is a faithful port of yesid TerminalChrome — sign | Marginalia primitives are at parity: CornerMeta.svelte + CornerMarks.svelte + SectionLabel | Footer.svelte (223 lines) is a byte-faithful two-row port of yesid layout/Footer.svelte —  | Token + doctrine foundation is correct: four-color law, hazard tape (Separator variant=haz | MetroStation.svelte + NumberedChip.svelte already exist in brand/ — the numbered-rhythm pr
