// metrics.content.ts — the in-app metric explainer's data module (slice-9.6).
//
// One entry per citizen-facing reliability metric, ported VERBATIM from the
// Notion "🔬 Metric Science Reference" (post-#59 honesty fixes, 2026-06-19). FR
// is the canonical product voice; EN mirrors it. The verbatim Defining SQL is
// language-neutral — the same fenced block serves both locales.
//
// This module is the SINGLE source of truth for:
//   · the /metrics explainer page sections (definition / math / SQL / "not" /
//     caveats), grouped by the five reliability clusters, and
//   · the (i) hover tip + deep-link anchor each metric label on the reliability
//     surface points at (see metricInfoFor()).
//
// DOCTRINE that MUST survive any edit (this honesty is the whole point):
//   · PROXY, not certified OTP — GTFS-RT predicted schedule-deviation, no AVL.
//   · avg_delay_min is an observation-weighted MEAN, never a "median".
//   · p50/p90 percentiles only at the DAY grain.
//   · everything observation-weighted, not trip/rider-weighted.
//   · cancellation + skipped-stop are RAMP-IN, no backfill.
//   · occupancy is a band-share of pings, NOT % full / not per-rider.
//   · the habits matrix is per-route self-normalized [0,1], not cross-route.
//   · NULL = "no data", never a fabricated 0.
//   · __unrouted__ / __unknown_stop__ are internal sentinels, never real.

import type { Locale } from '$lib/i18n';
import { localizeHref } from '$lib/i18n';

/** Stable identity for each explainer entry (drives the surface ↔ page link). */
export type MetricKey =
	| 'otp'
	| 'avgDelay'
	| 'p50p90'
	| 'severe'
	| 'regularityCov'
	| 'headway'
	| 'excessWait'
	| 'cancellation'
	| 'skippedStop'
	| 'serviceSpan'
	| 'occupancy'
	| 'habits'
	| 'seasonality'
	| 'weakStops';

/** Provenance confidence: every reliability metric is a feed-derived proxy. */
export type Confidence = 'proxy' | 'medium';

/** The five reliability-surface clusters that group the explainer sections. */
export type MetricClusterKey =
	| 'punctuality'
	| 'waitRegularity'
	| 'serviceDelivered'
	| 'crowding'
	| 'habits';

interface BilingualText {
	readonly en: string;
	readonly fr: string;
}
interface BilingualList {
	readonly en: readonly string[];
	readonly fr: readonly string[];
}

export interface MetricEntry {
	/** Stable identity (icon lookup, #each keys, surface ↔ page link). */
	readonly key: MetricKey;
	/** URL fragment, stable + unique kebab-case (e.g. 'avg-delay'). No leading '#'. */
	readonly anchor: string;
	/** Which surface cluster band this metric belongs under. */
	readonly cluster: MetricClusterKey;
	/** Notion family number (1..21) — a provenance trace back to the science doc. */
	readonly family: number;
	/** Feed-derived estimate ('proxy') vs point-in-time census ('medium'). */
	readonly confidence: Confidence;
	/** Display name (FR canonical, EN mirror). */
	readonly name: BilingualText;
	/** The metric's science-doc name (mono, language-neutral identifier label). */
	readonly sciName: string;
	/** ONE-LINE plain explanation — the (i) hover tip. */
	readonly oneLiner: BilingualText;
	/** Full plain-language definition (ported from the Notion lead paragraph). */
	readonly definition: BilingualText;
	/** The math, plain + formula (ported from the Notion "Formula:" line). */
	readonly math: BilingualText;
	/** Verbatim Defining SQL (language-neutral; reused for both locales). */
	readonly sql: string;
	/** "A citizen reads X, but it's actually Y" (ported from the Notion "Not:"). */
	readonly notReally: BilingualText;
	/** Honest caveats (ported from the Notion "Caveats" bullets). */
	readonly caveats: BilingualList;
}

// The five-cluster surface order (mirrors reliability.copy ReliabilityClusterKey),
// used to group the ToC + section overlines on the explainer page.
export const METRIC_CLUSTER_ORDER: readonly MetricClusterKey[] = [
	'punctuality',
	'waitRegularity',
	'serviceDelivered',
	'crowding',
	'habits',
] as const;

export const METRICS: readonly MetricEntry[] = [
	// ── 01 Punctuality ──────────────────────────────────────────────────────
	{
		key: 'otp',
		anchor: 'otp',
		cluster: 'punctuality',
		family: 1,
		confidence: 'proxy',
		name: { fr: 'Ponctualité', en: 'On-time %' },
		sciName: 'otp_pct',
		oneLiner: {
			fr: "La part des relevés de position de la ligne qui tombaient à l'heure (de 1 min en avance à moins de 5 min en retard) — pas un taux de trajets ni une ponctualité certifiée.",
			en: 'The share of the line’s position readings that landed on time (1 min early to under 5 min late) — not a trip count and not a certified punctuality rating.',
		},
		definition: {
			fr: "Pour une ligne, c'est la part de ses relevés de position GPS qui sont tombés à peu près à l'heure — de 1 minute en avance jusqu'à un peu moins de 5 minutes en retard. On suit le flux de position en direct toute la journée; chaque fois qu'on peut mesurer l'écart à l'horaire, ça compte comme une observation. La ponctualité, c'est simplement : de toutes ces observations où le retard était connu, combien étaient « à l'heure ». 90 % signifie 9 relevés sur 10 dans la fenêtre à l'heure. Ce n'est PAS un décompte de trajets et PAS une note de ponctualité officielle — c'est un instantané relevé par relevé, bâti sur le flux d'arrivées prédites, sans aucun journal d'arrivées certifié.",
			en: 'For one bus/tram route, this is the share of its GPS check-ins that landed roughly on schedule — from 1 minute early up to just under 5 minutes late. We watch each route’s live position feed all day, and every time we can tell how far ahead or behind schedule it is, that counts as one observation. On-time % is simply: of all those observations where we knew the delay, how many were “on time.” 90% means 9 out of 10 readings were within the on-time window. It is NOT a count of trips and NOT an official punctuality rating — it is a reading-by-reading snapshot built from the predicted-arrival feed, with no certified arrival/departure logs behind it.',
		},
		math: {
			fr: "otp_pct = round(100 × on_time_observation_count / delay_observation_count), en pourcentage entier. NULL (pas 0) quand on_time_observation_count est inconnu OU que delay_observation_count = 0. La bande à l'heure = delay_seconds dans [-60, +300) (≥ -60 s et < 300 s). Le numérateur remonte la chaîne de rollup avec une garde tout-ou-rien : à chaque niveau, SUM(on_time) UNIQUEMENT si COUNT(*) = COUNT(on_time) — si un seul seau enfant a un on_time NULL, l'agrégat entier devient NULL et s'affiche « aucune donnée » plutôt qu'un pourcentage sous-estimé. Pondéré par observations, pas par trajets.",
			en: 'otp_pct = round(100 × on_time_observation_count / delay_observation_count), as an integer percent. NULL (not 0) when on_time_observation_count is unknown OR delay_observation_count = 0. The on-time band = delay_seconds in [-60, +300) (≥ -60s and < 300s). The numerator propagates up the rollup chain with an all-or-nothing guard: at every level it is SUM(on_time) ONLY WHEN COUNT(*) = COUNT(on_time) — if ANY child bucket has a NULL on_time, the whole aggregate becomes NULL and renders “no data” rather than an understated percentage. Observation-weighted, not trip-weighted.',
		},
		sql: `-- on-time band at the 5m feeder (gold.trip_delay_summary_5m_live, mig 0030):
COUNT(*) FILTER (WHERE delay_seconds >= -60 AND delay_seconds < 300)::integer
    AS on_time_observation_count

-- WEEKLY rollup (UPSERT_ROUTE_RELIABILITY_WEEKLY; MONTHLY is identical with date_trunc('month',...)):
INSERT INTO gold.route_reliability_weekly (... on_time_observation_count ...)
SELECT
    rd.provider_id,
    date_trunc('week', timezone(dp.timezone, rd.period_start_utc))::date,
    rd.route_id,
    SUM(rd.observation_count)::integer,
    SUM(rd.delay_observation_count)::integer,
    -- A NULL in any contributing hour means pre-fix history is unknowable.
    CASE WHEN COUNT(*) = COUNT(rd.on_time_observation_count)
        THEN SUM(rd.on_time_observation_count)::integer
    END,
    ...
FROM gold.route_delay_hourly AS rd
INNER JOIN gold.dim_provider AS dp ON dp.provider_id = rd.provider_id
WHERE rd.provider_id = :provider_id
GROUP BY 1, 2, 3
ON CONFLICT (provider_id, week_start_local, route_id) DO UPDATE SET ...

-- publisher reduction (snapshots/builders/_helpers.py _otp_pct):
def _otp_pct(on_time, known):
    if on_time is None or not known: return None
    known_obs = float(known)
    if known_obs <= 0: return None
    return round(100.0 * float(on_time) / known_obs)`,
		notReally: {
			fr: "Un usager lira « Ligne 80 : 88 % à l'heure » comme « 88 % des trajets de la 80 sont arrivés à l'horaire (ponctualité officielle) ». Ce n'est pas ça : c'est la part des RELEVÉS d'écart à l'horaire tombés dans une fenêtre -1 min/+5 min prédite — pondérée par observations, de qualité proxy, sans donnée d'arrivée certifiée et sans dénominateur de trajets effectués. Une ligne peut afficher une ponctualité élevée tout en sautant des arrêts ou en effectuant peu de trajets.",
			en: 'A citizen will read “Route 80: 88% on-time” as “88% of route 80’s trips arrived on schedule (official punctuality).” It is NOT that: it is the share of live schedule-deviation READINGS that fell in a -1min/+5min predicted window — observation-weighted, proxy-grade, with no certified arrival data and no trip-completion denominator. A route could show high OTP while skipping stops or running few trips, because OTP says nothing about trips run or cancelled.',
		},
		caveats: {
			fr: [
				"PROXY, pas une ponctualité certifiée : bâti sur l'écart à l'horaire prédit du GTFS-RT (delay_seconds), pas sur des journaux d'arrivée certifiés ni sur de l'AVL. C'est « la déviation prédite dans la fenêtre à l'heure », pas « les portes ont ouvert à l'heure ».",
				"BANDE À L'HEURE ASYMÉTRIQUE : à l'heure = delay dans [-60 s, +300 s) — de 1 min en avance à moins de 5 min en retard. ≥ 300 s (5 min de retard) est « grave » et exclu du numérateur; ≤ -60 s aussi.",
				'DÉNOMINATEUR = OBSERVATIONS À RETARD CONNU, PAS DES TRAJETS : delay_observation_count compte des relevés de mise à jour, donc la ponctualité est pondérée par observations. Une ligne sondée plus souvent domine son propre chiffre.',
				"NULL EST HONNÊTE, PAS ZÉRO : otp_pct est null (l'UI montre « aucune donnée ») quand delay_observation_count = 0, OU quand un seau a un on_time inconnu. L'historique pré-correctif à on_time NULL propage NULL plutôt qu'un pourcentage faussement bas.",
				'PERCENTILES SEULEMENT AU GRAIN JOUR : les rangées semaine/mois portent otp_pct + avg_delay_min + severe_pct mais p50/p90 = None. avg_delay_min ici est la MOYENNE pondérée par observations (jadis mal étiquetée « médiane »), pas un percentile.',
				"FUITE DE SENTINELLE : __unrouted__ peut être publié comme fichier de ligne (l'index n'exclut pas la sentinelle de l'émission par ligne) — les clients ne doivent jamais l'afficher comme une vraie ligne.",
				"CALENDRIER LOCAL / HEURE AVANCÉE : les seaux jour/semaine/mois utilisent l'heure locale (America/Toronto); les jours de transition ont 23 h/25 h, mais comme la ponctualité est un ratio, cela ne décale que le mélange d'observations.",
				"SIGNAUX STM MORTS NON UTILISÉS : occupancy_percentage, congestion_level, le champ delay natif GTFS et les trajets ADDED ne sont jamais lus. Le métro n'a pas de temps réel STM — donc pas de ponctualité.",
			],
			en: [
				'PROXY, NOT CERTIFIED OTP: built from GTFS-RT predicted schedule-deviation (delay_seconds), not certified arrival/departure logs and no AVL. It is “predicted-deviation in the on-time window”, not “doors opened on time”.',
				'ON-TIME BAND IS ASYMMETRIC: on-time = delay in [-60s, +300s) — up to 1 min early through under 5 min late. ≥ 300s (5 min late) is “severe” and excluded from the numerator; ≤ -60s (more than 1 min early) is also outside the band.',
				'DENOMINATOR IS KNOWN-DELAY OBSERVATIONS, NOT TRIPS: delay_observation_count counts trip-update readings, so OTP is observation-weighted, not trip-weighted. A route polled more often dominates its own number.',
				'NULL IS HONEST, NOT ZERO: otp_pct is null (UI shows “no data”) when delay_observation_count = 0, OR when any contributing bucket has an unknown on_time count. Pre-fix history with NULL on_time propagates to NULL OTP rather than a falsely-low percentage.',
				'PERCENTILES ONLY AT DAY GRAIN: week/month rows carry otp_pct + avg_delay_min + severe_pct but p50_min/p90_min = None. avg_delay_min here is the observation-weighted MEAN (formerly mislabeled “median”), not a percentile.',
				'SENTINEL LEAKS INTO PER-ROUTE FILES: __unrouted__ can be published as a route file (the index does not exclude the sentinel from per-route emission) — clients must not render it as a real route.',
				'LOCAL-CALENDAR / DST: week/month/day buckets use local time (America/Toronto). DST days have 23h/25h, but since OTP is a ratio this only shifts the observation mix, not the band math.',
				'DEAD STM SIGNALS NOT INVOLVED: occupancy_percentage, congestion_level, GTFS native delay, and ADDED trips are never read. Metro has no STM realtime, so metro routes have no OTP.',
			],
		},
	},
	{
		key: 'avgDelay',
		anchor: 'avg-delay',
		cluster: 'punctuality',
		family: 2,
		confidence: 'proxy',
		name: { fr: 'Retard moyen', en: 'Average delay' },
		sciName: 'avg_delay_min',
		oneLiner: {
			fr: "La lateur MOYENNE sur tous les relevés d'écart à l'horaire — une moyenne (tirée vers le haut par quelques très gros retards), pas une médiane, et un proxy du flux sans vérité GPS.",
			en: 'The MEAN lateness across every schedule-deviation reading — an average (pulled up by a few very-late readings), not a median, and a feed proxy with no GPS truth.',
		},
		definition: {
			fr: "Pour une ligne, à quel point elle a roulé hors horaire. Le chiffre vedette (avg_delay_min) est la lateur MOYENNE sur chaque relevé d'écart à l'horaire collecté pour la période — on les additionne, on divise par leur nombre. Un nombre positif = en retard, négatif = en avance. Ces chiffres viennent directement de l'écart prédit du flux temps réel — ils décrivent comment les prédictions ont suivi l'horaire, pas un dossier de ponctualité certifié, et il n'y a aucune vérité GPS/AVL derrière.",
			en: 'For one bus/tram route, how far off schedule it ran. The headline number (avg_delay_min) is the AVERAGE lateness across every schedule-deviation reading we collected for that route in the period — add them all up, divide by how many there were. A positive number means late, negative means early. These come straight from the realtime feed’s predicted schedule deviation — they describe how predictions tracked vs the timetable, not a certified on-time record, and there is no GPS/AVL truth behind them.',
		},
		math: {
			fr: 'avg_delay_min (tous grains) : moyenne pondérée par observations du retard plafonné, puis secondes→minutes. Par heure, le feeder 5m donne avg_delay_seconds_capped = AVG(delay_seconds) FILTER(|delay|≤3600); le rollup re-pondère par (delay_observation_count − outlier_count) : avg_delay_seconds = ROUND( SUM(avg_capped × (obs−outlier)) / SUM(obs−outlier), 2 ); valeur publiée = round(avg_delay_seconds / 60, 1). |delay_seconds| ≤ 3600 imposé partout (garde anti-fantôme). None (jamais 0) quand le dénominateur est vide.',
			en: 'avg_delay_min (all grains): observation-weighted mean of capped delay, then seconds→minutes. Per hour the 5m feeder gives avg_delay_seconds_capped = AVG(delay_seconds) FILTER(|delay|≤3600); rollup re-weights by (delay_observation_count − outlier_count): avg_delay_seconds = ROUND( SUM(avg_capped × (obs−outlier)) / SUM(obs−outlier), 2 ); published value = round(avg_delay_seconds / 60, 1). |delay_seconds| ≤ 3600 enforced in every path (ghost guard). None (never 0) when the denominator is empty.',
		},
		sql: `-- avg_delay_min (all grains) — observation-weighted MEAN; gold.public_route_reliability_daily view:
ROUND( SUM(rd.avg_delay_seconds * NULLIF(rd.delay_observation_count, 0))
       / NULLIF(SUM(rd.delay_observation_count), 0), 2 ) AS avg_delay_seconds
FROM gold.route_delay_hourly AS rd ... GROUP BY provider_id, route_id, provider_local_date;
-- builder: avg_delay_min = round(avg_delay_seconds/60, 1); week/month carry the mean alone.
-- per-hour 5m feeder cap: AVG(delay_seconds) FILTER (WHERE ABS(delay_seconds) <= 3600)`,
		notReally: {
			fr: "Un usager lira avg_delay_min comme « le trajet typique a roulé X minutes en retard » ou comme une note officielle. C'est ni l'un ni l'autre : c'est la MOYENNE (gonflée par quelques relevés très en retard, donc elle surestime le trajet typique), un proxy de prédiction du flux sans vérité GPS ni certification, et une moyenne sur des observations (mises à jour), pas des trajets. Le vrai « trajet typique » est p50_min (grain jour seulement); le « pire des cas » est p90_min.",
			en: 'A citizen is most likely to read avg_delay_min as “the typical trip ran X minutes late” or as an official on-time score. It is neither: it is the MEAN (skewed upward by a few very-late readings, so it overstates the typical trip), it is a feed-prediction proxy with no GPS truth and no certification, and it is averaged over observations (stop-time updates) not trips. The honest “typical trip” number is p50_min (day grain only); the “how bad it gets” number is p90_min.',
		},
		caveats: {
			fr: [
				"PROXY, pas une ponctualité certifiée : chaque valeur dérive de l'écart à l'horaire prédit du GTFS-RT (delay_seconds). Aucune vérité AVL/GPS derrière.",
				'avg_delay_min est une MOYENNE pondérée par observations, PAS une médiane. Elle fut jadis (à tort) étiquetée « médiane »; ce cadrage est corrigé et ne doit jamais revenir. La vraie médiane est p50_min, au grain jour seulement.',
				"DÉNOMINATEUR de la moyenne = delay_observation_count (relevés à retard connu), re-pondéré heure→jour→semaine→mois, moins les outliers. Un compte d'observations, pas de trajets distincts.",
				'GARDE ANTI-FANTÔME : les observations |delay_seconds| > 3600 s (1 h) sont exclues de la moyenne ET des percentiles. Les prédictions périmées/erronées ne font pas exploser la queue.',
				"NULL HONNÊTE, jamais un 0 fabriqué : avg est null quand son dénominateur est vide — l'UI doit afficher « aucune donnée », pas un 0 min trompeur.",
				'HEURE AVANCÉE / jour local : chaque grain replie les horodatages UTC vers la date locale America/Toronto.',
				"SENTINELLES : route_id est COALESCé en __unrouted__ dans le spine horaire; un fichier de fiabilité par ligne est clé par route_id, donc __unrouted__ n'est jamais lié depuis un index public — interne, pas une ligne citoyenne.",
				'SIGNAUX STM MORTS : occupancy_percentage, congestion_level, le champ delay natif GTFS-RT et les trajets ADDED sont ignorés.',
			],
			en: [
				'PROXY, not certified OTP: every value derives from GTFS-RT predicted schedule deviation (delay_seconds). There is NO AVL/GPS ground truth behind it.',
				'avg_delay_min is an observation-weighted MEAN, NOT a median. It was historically (wrongly) labelled “median”; that framing is corrected and must never be reintroduced. The true median is p50_min, available on the DAY grain only.',
				'DENOMINATOR for the mean is delay_observation_count (readings with a known delay), re-weighted hour→day→week→month, minus per-bucket outlier_count. It is an observation (not distinct-trip) count.',
				'GHOST-TRIP GUARD: observations with |delay_seconds| > 3600s (1h) are excluded from BOTH the mean and the percentiles. Stale/garbage predictions don’t blow up the tail.',
				'HONEST-NULL, never fabricated 0: avg/p50/p90 are null when their denominator is empty — the UI must render “no data”, not a misleading 0 min.',
				'DST / local-day bucketing: every grain folds UTC capture timestamps to America/Toronto local date.',
				'SENTINELS: route_id is COALESCE’d to __unrouted__ in the hourly spine; a per-route reliability file is keyed by route_id, so __unrouted__ is never linked from a public index — internal, not a citizen route.',
				'DEAD STM signals never feed this family: occupancy_percentage, congestion_level, the native GTFS-RT delay field, and ADDED trips are ignored.',
			],
		},
	},
	{
		key: 'p50p90',
		anchor: 'p50-p90',
		cluster: 'punctuality',
		family: 2,
		confidence: 'proxy',
		name: { fr: 'Retard typique et pire des cas', en: 'Typical and worst-case delay' },
		sciName: 'p50_min · p90_min',
		oneLiner: {
			fr: "Sur la vue JOUR : p50 = le relevé du milieu (la moitié pire, la moitié mieux); p90 = le relevé d'un mauvais jour (1 relevé sur 10 est pire). p90 capte la queue douloureuse que la moyenne cache.",
			en: 'On the DAY view: p50 = the middle reading (half later, half earlier); p90 = the bad-day reading (only 1 in 10 readings is worse). p90 catches the painful tail the average hides.',
		},
		definition: {
			fr: "Sur la vue JOUR seulement, on montre deux chiffres « ce qu'un trajet typique a ressenti » : p50_min, le relevé du milieu (la moitié des relevés étaient plus tardifs, la moitié plus tôt), et p90_min, le relevé d'un mauvais jour (seul 1 relevé sur 10 était pire). p90 est ce qui capte la queue douloureuse que la moyenne cache. Ce sont de vrais percentiles continus (percentile_cont 0,5 / 0,9) sur les delay_seconds bruts par observation de la journée. Ils viennent de l'écart prédit du flux — pas de vérité GPS/AVL — et n'existent QU'au grain jour : semaine/mois ne portent que la moyenne, car les percentiles ne se composent pas additivement.",
			en: 'On the DAY view only, we show two “what a typical trip felt like” numbers: p50_min, the middle reading (half of all readings were later, half earlier), and p90_min, the bad-day reading (only 1 in 10 readings was worse than this). p90 is what catches the painful tail the average hides. These are true continuous percentiles (percentile_cont 0.5 / 0.9) over that day’s raw per-observation delay_seconds. They come from the feed’s predicted deviation — no GPS/AVL truth — and exist ONLY on the day grain: week/month carry the mean alone because percentiles are not additively composable.',
		},
		math: {
			fr: 'p50_min = round( percentile_cont(0.5) WITHIN GROUP (ORDER BY delay_seconds) / 60, 1 ); p90_min = idem avec 0,9 — calculés une fois par journée locale close, directement sur les rangées de faits brutes (route_delay_percentile_daily), JAMAIS re-dérivés pour semaine/mois (→ None). |delay_seconds| ≤ 3600 imposé. None (jamais 0) quand le dénominateur est vide.',
			en: 'p50_min = round( percentile_cont(0.5) WITHIN GROUP (ORDER BY delay_seconds) / 60, 1 ); p90_min = same with 0.9 — both computed once per closed local day directly over raw fact rows (route_delay_percentile_daily), NOT re-derived for week/month (→ None). |delay_seconds| ≤ 3600 enforced. None (never 0) when the denominator is empty.',
		},
		sql: `-- p50/p90 (DAY grain only) — gold.route_delay_percentile_daily, computed per closed local day over raw facts:
INSERT INTO gold.route_delay_percentile_daily (...)
SELECT f.provider_id, :local_date, f.route_id,
       COUNT(*)::integer,
       ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY f.delay_seconds)::numeric, 2),
       ROUND(percentile_cont(0.9) WITHIN GROUP (ORDER BY f.delay_seconds)::numeric, 2),
       :built_at_utc
FROM gold.fact_trip_delay_snapshot AS f
INNER JOIN gold.dim_provider AS dp ON dp.provider_id = f.provider_id
WHERE f.provider_id = :provider_id
  AND f.route_id IS NOT NULL
  AND f.delay_seconds IS NOT NULL
  AND ABS(f.delay_seconds) <= 3600            -- GHOST_DELAY_ABS_SECONDS
  AND timezone(dp.timezone, f.captured_at_utc)::date = :local_date
GROUP BY f.provider_id, f.route_id;`,
		notReally: {
			fr: "Un usager pourrait croire que p90 prédit son trajet de demain. Non : c'est une statistique rétrospective sur les relevés d'écart PRÉDIT d'une journée close — « 1 relevé sur 10 fut pire que ça » — pas une garantie pour un trajet précis ni une arrivée mesurée. p50 est le vrai « trajet typique » (la médiane), pas la moyenne (avg_delay_min).",
			en: 'A citizen might read p90 as a prediction of tomorrow’s trip. It is not: it is a retrospective statistic over a closed day’s PREDICTED-deviation readings — “1 in 10 readings was worse than this” — not a guarantee for any single trip and not a measured arrival. p50 is the honest “typical trip” (the median), not the mean (avg_delay_min).',
		},
		caveats: {
			fr: [
				'p50_min / p90_min existent UNIQUEMENT au grain jour. Semaine et mois émettent avg_delay_min avec p50=p90=null, car les percentiles ne se composent pas additivement à partir des feeders horaires/5m — ils doivent être calculés une fois par journée locale close sur les faits bruts.',
				"PROXY, pas une ponctualité certifiée : tirés de l'écart à l'horaire prédit du GTFS-RT, sans vérité GPS/AVL.",
				'GARDE ANTI-FANTÔME : les percentiles excluent |delay_seconds| > 3600 s (ABS ≤ 3600), donc les prédictions périmées ne gonflent pas la queue.',
				"NULL HONNÊTE : p50/p90 sont null quand il n'y a aucun fait pour cette journée close — « aucune donnée », jamais 0.",
				"HEURE AVANCÉE / jour local : le rollup de percentiles ne bâtit que les journées locales CLOSES (≥ aujourd'hui_local − lookback). Faits retenus ~14 j, rollup de percentiles 365 j.",
			],
			en: [
				'p50_min / p90_min exist ONLY on the day grain. Week and month emit avg_delay_min with p50=p90=null because percentiles are not additively composable from the hourly/5m feeders — they must be computed once per closed local day over raw facts.',
				'PROXY, not certified OTP: derived from GTFS-RT predicted schedule deviation, no GPS/AVL ground truth.',
				'GHOST-TRIP GUARD: the percentiles exclude |delay_seconds| > 3600s (ABS ≤ 3600), so stale predictions don’t blow up the tail.',
				'HONEST-NULL: p50/p90 are null when there are no facts for that closed day — “no data”, never 0.',
				'DST / local-day bucketing: the percentile rollup only builds CLOSED local days (≥ today_local − lookback). Facts retained ~14d, the percentile rollup 365d.',
			],
		},
	},
	{
		key: 'severe',
		anchor: 'severe',
		cluster: 'punctuality',
		family: 3,
		confidence: 'proxy',
		name: { fr: 'Part des retards graves', en: 'Severe-delay share' },
		sciName: 'severe_pct',
		oneLiner: {
			fr: "La part des relevés d'écart à l'horaire qui dépassaient +5 min de retard — la part de NOS relevés, pas la part des bus, trajets ou usagers en retard.",
			en: 'The share of schedule-deviation readings that ran more than 5 min late — the share of OUR readings, not the share of buses, trips, or riders that were late.',
		},
		definition: {
			fr: "De toutes les fois où l'on a pu mesurer l'écart à l'horaire d'une ligne, c'est le pourcentage qui roulait gravement en retard — plus de 5 minutes derrière. Donc 8 % signifie qu'environ 8 relevés sur 100 collectés pour cette ligne étaient à plus de 5 minutes de retard. Ce n'est PAS la part des bus, trajets ou usagers en retard, et ce n'est pas mesuré contre un horaire complet — c'est la part de nos relevés réels (chaque relevé = une arrivée/un départ prédit du flux GTFS-RT) ayant franchi la ligne du retard grave. Les relevés à plus d'une heure d'écart sont d'abord jetés comme fantômes, et « grave » plafonne à +60 minutes.",
			en: 'Out of all the times we could measure how far behind (or ahead of) schedule a route’s trips were, this is the percentage that were running severely late — more than 5 minutes behind schedule. So if a route shows 8%, it means about 8 out of every 100 schedule-deviation readings we collected for that route were more than 5 minutes late. It is NOT the share of buses, trips, or riders that were late, and it is not measured against a complete timetable — it is the share of our actual readings (each reading is one predicted arrival/departure from the live GTFS-RT feed) that crossed the severe-late line. Readings off by more than an hour are thrown out first as feed ghosts, and “severe” caps at +60 minutes.',
		},
		math: {
			fr: 'severe_pct = round( 100 × severe / delay_observation_count , 1 ), et None (pas 0) quand delay_observation_count est 0 ou NULL. severe = COUNT(observations WHERE delay_seconds > 300 AND ABS(delay_seconds) ≤ 3600). Les grains supérieurs composent additivement en sommant le compte severe ET le compte à retard connu, puis divisent une seule fois au moment de la publication — jamais en moyennant les pourcentages quotidiens.',
			en: 'severe_pct = round( 100 × severe / delay_observation_count , 1 ), and None (not 0) when delay_observation_count is 0 or NULL. severe = COUNT(observations WHERE delay_seconds > 300 AND ABS(delay_seconds) ≤ 3600). Higher grains compose additively by summing both the severe count and the known-delay count, then dividing once at publish time — never by averaging the per-day percentages.',
		},
		sql: `-- 5m base (gold/rollups.py UPSERT_TRIP_DELAY_SUMMARY_5M):
COUNT(delay_seconds)::integer                              AS delay_observation_count,
COUNT(*) FILTER (
    WHERE delay_seconds > 300            -- SEVERE_DELAY_SECONDS
      AND ABS(delay_seconds) <= 3600     -- GHOST_DELAY_ABS_SECONDS
)::integer                                                 AS severe_delay_observation_count,

-- daily public view (migration 0030 public_route_reliability_daily):
SUM(rd.severe_delay_count)::integer    AS severe_delay_observation_count,
SUM(rd.delay_observation_count)::integer AS delay_observation_count

-- publish step (snapshots/builders/_helpers.py _severe_pct):
def _severe_pct(observation_count, severe):
    if not observation_count: return None
    obs = float(observation_count)
    if obs <= 0: return None
    return round(100.0 * float(severe or 0) / obs, 1)`,
		notReally: {
			fr: "Un usager lira 8 % comme « 8 % des bus (ou trajets) de cette ligne ont roulé gravement en retard » — ce n'est pas ça. C'est 8 % des RELEVÉS de prédiction collectés, pondérés par observations; un seul trajet chroniquement en retard, prédit des dizaines de fois, gonfle la part, et cela ne dit rien du nombre de véhicules, trajets ou usagers distincts touchés.",
			en: 'A citizen reads 8% as “8% of this route’s buses (or trips) ran severely late” — it is not. It is 8% of the prediction READINGS we collected, observation-weighted; a single chronically-late trip predicted dozens of times inflates the share, and it says nothing about how many distinct vehicles, trips, or riders were affected.',
		},
		caveats: {
			fr: [
				"PROXY, pas une ponctualité certifiée : chaque observation est un écart à l'horaire prédit du GTFS-RT, pas une arrivée AVL. « Grave » = le flux a prédit > 5 min de retard, pas une arrivée tardive vérifiée.",
				"DÉNOMINATEUR = delay_observation_count (observations à retard connu), PAS le compte de trajets, de véhicules ni observation_count total. Utiliser observation_count sous-estimerait la part (c'était la correction d'honnêteté 3/3 du grain jour-de-semaine).",
				'GARDE FANTÔME : les relevés ABS(delay_seconds) > 3600 s (1 h) sont entièrement exclus du numérateur et du dénominateur. severe est borné à > 300 s ET ≤ 3600 s.',
				'severe est strictement EN RETARD (delay_seconds > 300). Le « grave en avance » est impossible par construction.',
				"NULL, pas 0, quand delay_observation_count est 0 — « aucune donnée mesurable » n'est jamais rendu comme « zéro retard grave ».",
				'severe_pct EST additif : semaine/mois/quart/type-de-jour somment les comptes bruts puis divisent une seule fois. Les pourcentages par période ne sont jamais moyennés.',
				"SENTINELLES : __unrouted__ (route_id NULL) n'apparaît jamais sur un artefact public par ligne.",
				'SIGNAUX STM MORTS non impliqués : severe dérive uniquement de delay_seconds.',
			],
			en: [
				'PROXY, not certified OTP: every observation is a GTFS-RT predicted schedule deviation, not an AVL/door-sensor arrival. “Severe” = the feed predicted >5 min late, not a verified late arrival.',
				'DENOMINATOR is delay_observation_count (observations with a known delay), NOT the trip count, vehicle count, or total observation_count. Using observation_count would understate the share (this was honesty-fix 3/3 for the day-of-week grain).',
				'GHOST guard: readings with ABS(delay_seconds) > 3600s (1 hour) are excluded entirely from both numerator and denominator. severe is bounded to >300s AND ≤3600s.',
				'severe is strictly LATE (delay_seconds > 300). Severe-early is impossible by construction; early/on-time never enter the numerator.',
				'NULL, not 0, when delay_observation_count is 0 — “no measurable data” is never rendered as “zero severe delays”.',
				'severe_pct IS additively composable: week/month/shift/day-type sum the raw counts then divide once. Per-period percentages are never averaged.',
				'SENTINELS: __unrouted__ (route_id IS NULL) never appears on a public per-route artifact.',
				'DEAD STM signals are NOT involved: severe is derived only from delay_seconds.',
			],
		},
	},
	{
		key: 'weakStops',
		anchor: 'weak-stops',
		cluster: 'punctuality',
		family: 11,
		confidence: 'proxy',
		name: { fr: 'Arrêts les plus en retard', en: 'Weak stops' },
		sciName: 'weak_stops',
		oneLiner: {
			fr: "Les 5 arrêts d'une ligne où les véhicules tendent à être le plus en retard en moyenne — une moyenne sur tout l'historique des prédictions, pas un décompte d'arrivées réelles.",
			en: 'The 5 stops on a line where vehicles tend to run latest on average — a mean over all recorded predictions, not a count of actual arrivals.',
		},
		definition: {
			fr: "Pour une seule ligne, c'est la liste des 5 arrêts où les véhicules tendent à rouler le plus en retard, en moyenne, contre leur horaire. Chaque arrêt montre un chiffre : la lateur moyenne en minutes vue à cet arrêt sur cette ligne, en comptant chaque prédiction jamais enregistrée. Un chiffre plus grand = les bus de cette ligne arrivent habituellement plus tard là qu'ailleurs. C'est une figure « en moyenne » bâtie sur les prédictions d'arrivée/départ en direct, pas un journal compté d'arrivées réelles, et c'est classé par plus forte moyenne d'abord.",
			en: 'For a single bus or metro line, this is the list of the 5 stops where vehicles tend to run the latest, on average, against their scheduled time. Each stop shows one number: the average lateness in minutes seen at that stop on that line, counting every prediction the transit feed has ever recorded for it. A bigger number means buses on that line usually show up later there than at other stops. It is an “on average” figure built from the live arrival/departure predictions the agency broadcasts, not a hand-counted log of actual arrivals, and it is ranked highest-average-delay first.',
		},
		math: {
			fr: 'avg_delay_min = round( [ SUM(stop_delay_weekly.avg_delay_seconds × observation_count) / SUM(observation_count) ] / 60 , 1 ), calculé par arrêt dans la ligne sur toutes les rangées hebdomadaires, puis classé DESC et tronqué à 5; les rangées à zéro observation ou somme pondérée NULL sont écartées.',
			en: 'avg_delay_min = round( [ SUM(stop_delay_weekly.avg_delay_seconds × observation_count) / SUM(observation_count) ] / 60 , 1 ), computed per stop within the route over all weekly rows, then ranked DESC and truncated to 5; rows with zero observations or a NULL weighted sum are dropped.',
		},
		sql: `-- Aggregation feeding weak_stops (historic.py _ROUTE_WEAK_STOPS_SQL):
SELECT stop_id,
       SUM(observation_count)                     AS obs,
       SUM(avg_delay_seconds * observation_count) AS weighted_delay_sec,
       SUM(severe_delay_count)                    AS severe
FROM gold.stop_delay_weekly
WHERE provider_id = :provider_id AND route_id = :route_id
GROUP BY stop_id
-- Python: avg_sec = weighted_delay_sec / obs  (None when obs falsy / weighted None)
--         sort desc by avg_sec; top 5; avg_delay_min = round(avg_sec/60.0, 1)`,
		notReally: {
			fr: "Un usager pourrait lire avg_delay_min comme « combien de minutes mon bus sera en retard à cet arrêt » ou comme un pourcentage de trajets en retard. Ni l'un ni l'autre : c'est la MOYENNE de lateur prédite à long terme à cet arrêt sur cette ligne sur toutes les prédictions (une moyenne, facilement biaisée par une minorité de prédictions très tardives), pas une garantie pour un trajet, pas un pourcentage à l'heure, pas une arrivée mesurée.",
			en: 'A citizen may read avg_delay_min as “how many minutes my bus will be late at this stop” or as a percentage of trips that are late. It is neither: it is the long-run AVERAGE predicted lateness at that stop on that line across all recorded predictions (a mean, easily skewed by a minority of very-late predictions), not a guarantee for any single trip, not an on-time percentage, and not a measured arrival.',
		},
		caveats: {
			fr: [
				"PROXY, pas une ponctualité certifiée : avg_delay_min dérive de l'écart à l'horaire PRÉDIT des mises à jour GTFS-RT. Aucun AVL / aucune arrivée physique mesurée.",
				"C'est une MOYENNE, pas une médiane : moyenne arithmétique pondérée par observations. weak_stops ne porte AUCUN p50/p90. Quelques prédictions extrêmes peuvent tirer la moyenne vers le haut.",
				"Dénominateur pondéré par observations : chaque moyenne d'arrêt pondère chaque heure/semaine par son observation_count. observation_count n'est PAS des trajets distincts.",
				'Filtre fantôme : toute prédiction |delay_seconds| > 3600 s (1 h) est écartée à la source horaire, donc les vrais retards > 1 h sont aussi exclus.',
				"Severe (> 300 s) remonte dans le feeder mais n'est PAS exposé dans WeakStop — c'est un classement de retard moyen seulement.",
				"Sentinelles : __unrouted__ ne peut jamais correspondre à une vraie ligne; stop_id vient du delay_stop_id non-null, donc __unknown_stop__ n'apparaît jamais. Propre par construction.",
				'Accumulation : agrège TOUTES les rangées hebdomadaires retenues (pas de fenêtre glissante sur la lecture), donc la moyenne mêle anciennes et récentes semaines.',
				'SIGNAUX STM MORTS non utilisés : seul delay_seconds (déviation prédite) alimente ce métrique.',
			],
			en: [
				'PROXY, not certified OTP: avg_delay_min derives from GTFS-RT trip-update PREDICTED schedule deviation. There is NO AVL / no measured physical arrival.',
				'It is a MEAN, not a median: observation-weighted arithmetic mean. weak_stops carries NO p50/p90. A few extreme predictions can pull the mean up.',
				'Observation-weighted denominator: each stop’s mean weights every hour/week by its observation_count. observation_count is NOT distinct trips.',
				'Ghost filter: any prediction with |delay_seconds| > 3600s (1h) is dropped at the hourly source, so genuine >1h delays are also excluded.',
				'Severe (>300s) flows up the feeder but is NOT surfaced in WeakStop — weak_stops is a mean-delay ranking only.',
				'Sentinel handling: __unrouted__ can never match a real route_id; stop_id comes from non-null delay_stop_id so __unknown_stop__ never appears. Sentinel-clean by construction.',
				'Accrual: aggregates ALL retained weekly rows (no trailing-window cap on the read), so a route’s mean blends old and recent weeks.',
				'DEAD STM signals are not used: only delay_seconds (predicted deviation) feeds this metric.',
			],
		},
	},
	// ── 02 Wait regularity ──────────────────────────────────────────────────
	{
		key: 'regularityCov',
		anchor: 'regularity',
		cluster: 'waitRegularity',
		family: 4,
		confidence: 'proxy',
		name: { fr: 'Régularité des intervalles (CV)', en: 'Headway regularity (CoV)' },
		sciName: 'headway_cov · bunched_pct',
		oneLiner: {
			fr: "Si les véhicules sont régulièrement espacés ou en accordéon. Le CV est un score d'irrégularité (plus haut = plus erratique); « collés » est la part d'intervalles si courts qu'ils signalent deux véhicules quasi ensemble.",
			en: 'Whether vehicles are evenly spaced or bunched. CoV is an irregularity score (higher = more erratic); “bunched” is the share of gaps so short they signal two vehicles arriving nearly together.',
		},
		definition: {
			fr: "À quel point les bus/trains d'une ligne sont réellement espacés. On observe quand chaque trajet apparaît « en direct » pour la première fois dans le flux, puis on mesure l'écart entre un trajet et le suivant sur la même ligne, fenêtre horaire et journée de service. De ces écarts on tire la régularité : « CV » est un score d'uniformité de 0 et plus (plus haut = plus erratique) et « collés » est la part d'écarts si courts qu'ils signalent deux véhicules arrivant presque ensemble (bus en accordéon). C'est une image de constance, pas une garantie qu'un trajet précis a roulé à l'heure.",
			en: 'How evenly the buses/trains on a route are actually spaced. We watch when each trip first shows up “live” in the feed, then measure the gap between one trip and the next on the same route, time-of-day window, and service day. From those gaps we report regularity — whether gaps are even or erratic: “CoV” is a 0-and-up evenness score (higher = more erratic) and “bunched” is the share of gaps so short they signal two vehicles arriving nearly together (bus-bunching). It is a picture of consistency, not a guarantee that any single trip ran on time.',
		},
		math: {
			fr: "Par (route, quart) sur 14 JOURS GLISSANTS : trip_start = MIN(captured_at_utc) par trajet (delay_seconds non-null, |delay| ≤ 3600); gap_min = écart entre trips successifs; filtre de bon sens partagé : gap > 0 ET < 240 min. headway_cov = ROUND(stddev_samp(gap)/avg(gap), 4), seulement si n ≥ 2 ET moyenne > 0 (sinon NULL). bunched_count = COUNT FILTER (gap < 0,5 × médiane du quart); bunched_pct = round(100 × bunched/sample, 1) (None si pas d'échantillon).",
			en: 'Per (route, shift) over a TRAILING 14 DAYS: trip_start = MIN(captured_at_utc) per trip (delay_seconds non-null, |delay| ≤ 3600); gap_min = gap between successive trip-starts; shared sanity filter: gap > 0 AND < 240 min. headway_cov = ROUND(stddev_samp(gap)/avg(gap), 4), only when n ≥ 2 AND mean > 0 (else NULL). bunched_count = COUNT FILTER (gap < 0.5 × shift median gap); bunched_pct = round(100 × bunched/sample, 1) (None when no sample).',
		},
		sql: `-- gold.route_headway_daily build (UPSERT_ROUTE_HEADWAY_DAILY), essential aggregation:
gaps AS (
  SELECT provider_id, route_id, direction_id, service_date, shift,
    EXTRACT(EPOCH FROM (
      trip_start_utc - LAG(trip_start_utc) OVER (
        PARTITION BY provider_id, route_id, direction_id, service_date, shift
        ORDER BY trip_start_utc))) / 60.0 AS gap_min
  FROM shifted),
filtered AS (                       -- single shared sample for median/CoV/bunching
  SELECT provider_id, route_id, shift, gap_min FROM gaps
  WHERE gap_min IS NOT NULL AND gap_min > 0 AND gap_min < 240),
agg AS (
  SELECT provider_id, route_id, shift,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_min) AS med_gap,
    avg(gap_min) AS mean_gap, stddev_samp(gap_min) AS sd_gap, COUNT(*) AS n
  FROM filtered GROUP BY provider_id, route_id, shift)
INSERT INTO gold.route_headway_daily (...)
SELECT a.provider_id, a.route_id, a.shift,
  ROUND(a.med_gap::numeric, 1),            -- observed_headway_min
  a.n::integer,                            -- sample_count
  CASE WHEN a.n >= 2 AND a.mean_gap > 0    -- headway_cov (NULL for <2 gaps)
       THEN ROUND((a.sd_gap / a.mean_gap)::numeric, 4) END,
  COALESCE(b.bunched_count, 0)::integer    -- bunched_count
FROM agg a LEFT JOIN bunch b USING (provider_id, route_id, shift) ...;`,
		notReally: {
			fr: "Un usager lira « collés 18 % » comme une note de ponctualité certifiée pour son arrêt. Ce n'en est pas une : c'est la part d'intervalles erratiquement courts, sur la direction la plus achalandée en semaine des 14 derniers jours, tirée de l'apparition des trajets dans le flux en direct — pas une heure d'arrivée à l'arrêt, pas un décompte de trajets à l'heure, et cela ne dit rien des trajets annulés ou jamais apparus.",
			en: 'A citizen will read “bunched 18%” as a certified, schedule-complete punctuality score for their stop. It is not: it is the share of erratically-short gaps, over the busiest weekday direction in the last 14 days, derived from when trips first appear in the live feed — not an at-stop arrival time, not a per-trip on-time count, and it says nothing about trips that were cancelled or never appeared.',
		},
		caveats: {
			fr: [
				"PROXY, PAS une ponctualité : c'est l'espacement des apparitions de trajets GTFS-RT, jamais une ponctualité certifiée ni basée sur l'AVL/odomètre.",
				"FENÊTRE GLISSANTE de 14 j, pas un historique par période close : les tables gold sont reconstruites à chaque exécution depuis captured_at_utc ≥ now() − 14 jours. AUCUN historique d'intervalles par jour; une ligne calme sur 14 j disparaît.",
				"DÉNOMINATEUR du CV et du collement = le MÊME jeu d'écarts filtré (gap > 0 et < 240 min), un échantillon partagé délibéré.",
				'CV honnête-NULL quand moins de 2 écarts valides (garde n ≥ 2) ou moyenne = 0; bunched_pct est None sans échantillon. Jamais fabriqué à 0.',
				"COLLAPSE direction/type-de-jour : route_headway_daily ne garde QUE la direction la plus achalandée et le service SEMAINE (ISODOW 1-5), donc le CV/collement vedette ne décrit qu'une direction en semaine.",
				'GARDE FANTÔME : seules les rangées delay_seconds non-null et |delay| ≤ 3600 amorcent un trip-start; les écarts sont bornés à > 0 et < 240 min.',
				"MÉDIANE, pas moyenne : observed_headway_min est une médiane. La moyenne n'apparaît que dans le dénominateur du CV.",
				'SIGNAUX STM MORTS non utilisés : occupancy_percentage, congestion_level, delay natif, trajets ADDED.',
			],
			en: [
				'PROXY, NOT OTP: this is GTFS-RT trip-appearance spacing, never certified on-time performance and never AVL/odometer-based.',
				'TRAILING-14d WINDOW, NOT closed-period history: both gold tables are full rebuilds each run from captured_at_utc ≥ now() − 14 days. There is NO per-day headway history; a route quiet in the last 14d simply disappears.',
				'DENOMINATOR for CoV and bunching is the SAME filtered gap set (gap > 0 and gap < 240 min) — a deliberate shared sample so numerator/denominator never drift.',
				'CoV is honest-NULL when fewer than 2 valid gaps (n ≥ 2 guard) or mean = 0; bunched_pct is None when there is no gap sample. Neither is ever fabricated to 0.',
				'DIRECTION/DAY-TYPE COLLAPSE: route_headway_daily keeps only the BUSIEST direction and WEEKDAY service (ISODOW 1–5), so the headline CoV/bunching describe one direction on weekdays only.',
				'GHOST-TRIP GUARD: only fact rows with delay_seconds NOT NULL and |delay_seconds| ≤ 3600 seed a trip-start; gaps are clamped to > 0 and < 240 min.',
				'MEDIAN, NOT MEAN: observed_headway_min is a median. The mean only appears inside CoV’s denominator.',
				'DEAD STM SIGNALS not used: occupancy_percentage, congestion_level, native delay, ADDED trips.',
			],
		},
	},
	{
		key: 'headway',
		anchor: 'headway',
		cluster: 'waitRegularity',
		family: 4,
		confidence: 'proxy',
		name: { fr: 'Intervalle observé et programmé', en: 'Observed and scheduled headway' },
		sciName: 'observed_min · scheduled_min',
		oneLiner: {
			fr: "L'écart typique (médian) que vous attendriez entre deux véhicules (observé) vs l'écart que l'horaire promet (programmé) — mesuré à partir de l'apparition des trajets dans le flux, pas d'une arrivée à l'arrêt.",
			en: 'The typical (median) gap you’d wait between vehicles (observed) vs the gap the timetable promises (scheduled) — measured from trips appearing in the feed, not an at-stop arrival.',
		},
		definition: {
			fr: "Par quart, on rapporte deux des quatre mesures d'intervalle : (1) intervalle observé = l'écart typique (médian) que vous attendriez entre véhicules; (2) intervalle programmé = l'écart typique que l'horaire promet. « Début de trajet » est le premier moment où l'on a vu un trajet rapporter dans le flux en direct avec une déviation calculable — pas un événement de départ à l'arrêt. L'intervalle observé est donc un proxy d'écart entre apparitions de trajets, pas une mesure d'inter-arrivée au niveau de l'arrêt.",
			en: 'Per shift, we report two of the four headway measures: (1) observed headway = the typical (median) gap you’d wait between vehicles; (2) scheduled headway = the typical gap the timetable promises. A “trip start” = the FIRST realtime observation that carried a computable schedule deviation — not an at-stop departure event. Observed headway is therefore an inter-trip-appearance gap proxy, not a stop-level inter-arrival measurement.',
		},
		math: {
			fr: "observed_headway_min = ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_min), 1) sur le jeu d'écarts filtré (gap > 0 et < 240 min). scheduled_min n'est PAS stocké en gold : calculé au moment de la publication = médiane des écarts entre minutes de départ programmées distinctes au premier arrêt (direction la plus achalandée en semaine), regroupées dans le même quart.",
			en: 'observed_headway_min = ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_min), 1) over the filtered gap set (gap > 0 and < 240 min). scheduled_min is NOT stored in gold: computed at PUBLISH time = median gap between distinct timetabled first-stop departure minutes (busiest weekday direction), bucketed into the same shift.',
		},
		sql: `-- observed_headway_min (gold.route_headway_daily; see headway-regularity above for the gaps CTE):
ROUND(a.med_gap::numeric, 1) AS observed_headway_min   -- percentile_cont(0.5) over the shared filtered gaps

-- scheduled_min + excess_wait are PUBLISH-TIME, NOT stored in gold (migration 0035 dropped them):
--   scheduled = median gap of distinct first-stop departure minutes (busiest weekday direction), per shift
--   excess_wait = round(max(0.0, observed - scheduled), 1) if BOTH exist, else None
-- the direction/day-type sibling rows (route_headway_direction_daily) carry observed_min only.`,
		notReally: {
			fr: "« Intervalle observé 12 min » n'est pas « mon bus passe aux 12 minutes à mon arrêt ». C'est l'écart médian entre les moments où les trajets successifs apparaissent d'abord dans le flux, sur la direction la plus achalandée en semaine des 14 derniers jours — pas une inter-arrivée mesurée à l'arrêt, et les trajets annulés ou jamais apparus rétrécissent simplement l'échantillon, ils ne comptent pas comme de longues attentes.",
			en: '“Observed headway 12 min” is not “my bus comes every 12 minutes at my stop.” It is the median gap between when consecutive trips first appear in the feed, over the busiest weekday direction in the last 14 days — not a measured at-stop inter-arrival, and cancelled or never-appeared trips just shrink the sample, they are not counted as long waits.',
		},
		caveats: {
			fr: [
				"PROXY d'apparition dans le flux, pas une inter-arrivée à l'arrêt ni de l'AVL : « intervalle observé » est l'écart médian entre apparitions successives de trajets avec une déviation calculable.",
				"FENÊTRE GLISSANTE de 14 j : reconstruite à chaque exécution; aucun historique d'intervalles par jour.",
				"PROGRAMMÉ & EXCÈS sont AU MOMENT DE LA PUBLICATION, NON STOCKÉS : la migration 0035 a retiré scheduled/excess de gold car l'upsert ne les écrivait jamais. Recalculés depuis l'horaire GTFS.",
				'COLLAPSE direction/jour-type : observed_min vedette ne couvre que la direction la plus achalandée en semaine; week-end et autres directions vivent dans la table sœur (observed_min seulement).',
				'MÉDIANE, pas moyenne, pour observed_min et scheduled_min (percentile_cont 0.5; statistics.median sur les minutes de départ distinctes).',
				'QUARTS en heure LOCALE; le seau « nuit » {23, 0-5} replie les heures post-minuit. Aucun traitement DST explicite au-delà du seau en heure locale.',
				'GARDE FANTÔME : seules les rangées à delay calculable et |delay| ≤ 3600 amorcent un trip-start; écarts bornés > 0 et < 240 min.',
				'SIGNAUX STM MORTS jamais rapportés ici : occupancy_percentage, congestion_level, delay natif, trajets ADDED.',
			],
			en: [
				'FEED-APPEARANCE PROXY, not an at-stop inter-arrival and not AVL: “observed headway” is the median gap between successive trip appearances carrying a computable deviation.',
				'TRAILING-14d WINDOW: rebuilt every run; there is no per-day headway history.',
				'SCHEDULED & EXCESS ARE PUBLISH-TIME, NOT STORED: migration 0035 dropped scheduled/excess from gold because the upsert never wrote them. Recomputed from the GTFS timetable.',
				'DIRECTION/DAY-TYPE COLLAPSE: the headline observed_min covers only the busiest weekday direction; weekend and other directions live in the sibling table (observed_min only).',
				'MEDIAN, NOT MEAN, for observed_min and scheduled_min (percentile_cont 0.5; statistics.median over distinct departure minutes).',
				'SHIFT BUCKETS use LOCAL time; the “night” bucket {23, 0–5} folds post-midnight times. No explicit DST handling beyond local-time bucketing.',
				'GHOST-TRIP GUARD: only rows with a computable delay and |delay| ≤ 3600 seed a trip-start; gaps clamped > 0 and < 240 min.',
				'DEAD STM SIGNALS never reported here: occupancy_percentage, congestion_level, native delay, ADDED trips.',
			],
		},
	},
	{
		key: 'excessWait',
		anchor: 'excess-wait',
		cluster: 'waitRegularity',
		family: 4,
		confidence: 'proxy',
		name: { fr: 'Attente excédentaire', en: 'Excess wait' },
		sciName: 'excess_wait_min',
		oneLiner: {
			fr: "Combien de temps de plus l'écart réel dépasse l'écart promis — jamais montré négatif (le service en avance/supplémentaire est ramené à 0).",
			en: 'How much longer the real gap is than the promised one — never shown negative (early/extra service is clamped to 0).',
		},
		definition: {
			fr: "L'attente excédentaire est combien de temps de plus l'écart réel entre véhicules dépasse l'écart promis par l'horaire. Elle n'est jamais montrée négative : le service en avance ou supplémentaire est ramené à 0. C'est calculé au moment de la publication comme max(0, intervalle observé − intervalle programmé), uniquement quand l'observé ET le programmé existent pour ce quart. C'est l'espacement supplémentaire typique, pas une attente réelle de passager mesurée.",
			en: 'Excess wait is how much longer the real gap between vehicles is than the gap the timetable promises. It is never shown negative: early or extra service is clamped to 0. It is computed at publish time as max(0, observed headway − scheduled headway), only when BOTH observed and scheduled exist for that shift. It is the typical extra spacing, not a measured passenger wait time.',
		},
		math: {
			fr: 'excess_wait_min = round( max(0, observed − scheduled), 1 ) uniquement quand observed ET scheduled existent, sinon None. Le service en avance/supplémentaire est plafonné à 0, jamais publié comme attente négative. Ni observed ni scheduled ne sont une attente de passager — ce sont des écarts entre véhicules.',
			en: 'excess_wait_min = round( max(0, observed − scheduled), 1 ) only when BOTH observed and scheduled exist, else None. Early/extra service is clamped to 0, never published as negative wait. Neither observed nor scheduled is a passenger wait — they are gaps between vehicles.',
		},
		sql: `-- excess_wait is PUBLISH-TIME, NOT stored in gold (migration 0035 dropped the column):
--   excess = round(max(0.0, observed - scheduled), 1) if both else None
-- observed = gold.route_headway_daily.observed_headway_min (median of the shared filtered gaps)
-- scheduled = median gap of distinct first-stop departure minutes (busiest weekday direction), per shift`,
		notReally: {
			fr: "« Attente excédentaire 4 min » n'est pas « mon bus a 4 minutes de retard » ni « j'attends 4 minutes de plus à mon arrêt ». C'est l'espacement supplémentaire typique (médiane observée − médiane programmée) sur la direction la plus achalandée en semaine des 14 derniers jours, tiré des apparitions de trajets dans le flux — pas une attente de passager mesurée.",
			en: 'A citizen will read “excess wait 4 min” as “my bus is 4 minutes late” or “I wait 4 extra minutes at my stop.” It is the typical extra spacing (median observed − median scheduled) over the busiest weekday direction in the last 14 days, derived from trip appearances in the feed — not a measured passenger wait.',
		},
		caveats: {
			fr: [
				"AU MOMENT DE LA PUBLICATION, NON STOCKÉ : la migration 0035 a retiré excess_wait_min de gold. Recalculé au build du snapshot à partir de l'horaire GTFS et de l'intervalle observé.",
				'RAMENÉ À 0 : excess_wait = max(0, observed − scheduled) — le service en avance/supplémentaire est plafonné à 0, jamais une attente négative.',
				'None à moins que observed ET scheduled existent tous deux pour ce quart — jamais fabriqué.',
				"PROXY d'apparition dans le flux, pas une attente de passager mesurée ni une inter-arrivée à l'arrêt.",
				'COLLAPSE direction/semaine : décrit la direction la plus achalandée en semaine seulement, sur 14 jours glissants.',
				'SIGNAUX STM MORTS jamais utilisés ici.',
			],
			en: [
				'PUBLISH-TIME, NOT STORED: migration 0035 dropped excess_wait_min from gold. Recomputed at snapshot build from the GTFS timetable and the observed headway.',
				'CLAMPED TO 0: excess_wait = max(0, observed − scheduled) — early/extra service is clamped to 0, never a negative wait.',
				'None unless BOTH observed and scheduled exist for that shift — never fabricated.',
				'FEED-APPEARANCE PROXY, not a measured passenger wait and not an at-stop inter-arrival.',
				'DIRECTION/WEEKDAY COLLAPSE: describes the busiest weekday direction only, over a trailing 14 days.',
				'DEAD STM SIGNALS never used here.',
			],
		},
	},
	// ── 03 Service delivered ──────────────────────────────────────────────────
	{
		key: 'cancellation',
		anchor: 'cancellation',
		cluster: 'serviceDelivered',
		family: 5,
		confidence: 'proxy',
		name: { fr: "Taux d'annulation", en: 'Cancellation rate' },
		sciName: 'cancellation_rate_pct',
		oneLiner: {
			fr: "Des trajets que le flux temps réel a RAPPORTÉS pour une ligne ce jour-là, la part qu'il a marqués annulés — pas la part de l'horaire complet (les trajets jamais mentionnés ne comptent pas).",
			en: 'Of the trips the realtime feed actually REPORTED for a route that day, the share it flagged canceled — not the share of the full timetable (trips the feed never mentions are not counted).',
		},
		definition: {
			fr: "Des trajets que le flux temps réel a réellement rapportés pour une ligne un jour donné, la part que le flux a marqués annulés. Un « jour-trajet » est une exécution programmée d'une ligne un jour calendaire; si le flux l'a marquée ANNULÉE à un moment de la journée, elle compte comme annulée. Donc « 3,2 % » signifie : sur 100 trajets dont le flux nous a parlé ce jour-là, environ 3 ont été annulés. C'est la part des trajets RAPPORTÉS annulés — pas la part de l'horaire publié complet, car les trajets jamais mentionnés ne sont pas dans le compte.",
			en: 'Of the trips the realtime feed actually reported for a route on a given day, the share that the feed flagged as canceled. A “trip-day” is one scheduled run of a route on one calendar day; if the feed ever marked that run CANCELED at any point that day, it counts as canceled. So “3.2%” means: out of every 100 trips the feed told us about that day, about 3 were called off. It is the share of REPORTED trips that were canceled — not the share of the full published timetable, because trips the feed never mentions are not in the count at all.',
		},
		math: {
			fr: 'Par ligne, par jour local clos : cancellation_rate_pct = ROUND(100,0 × canceled_trip_days / NULLIF(total_trip_days, 0), 2), où total_trip_days = COUNT(distinct (trip_id, start_date)) observés, et canceled_trip_days = COUNT de ceux dont MAX((schedule_relationship == 3)) = 1. NULL (pas 0) quand total_trip_days = 0. Le rollup réseau re-dérive depuis les comptes sommés, PAS une moyenne des taux par ligne.',
			en: 'Per route, per closed provider-local day: cancellation_rate_pct = ROUND(100.0 × canceled_trip_days / NULLIF(total_trip_days, 0), 2), where total_trip_days = COUNT(distinct (trip_id, start_date)) observed, and canceled_trip_days = COUNT of those whose MAX((schedule_relationship == 3)) = 1. NULL (not 0) when total_trip_days = 0. The network rollup re-derives from summed counts, NOT a mean of route rates.',
		},
		sql: `WITH trip_day AS (
    SELECT
        f.provider_id, f.route_id, f.trip_id,
        f.start_date AS service_date,
        MAX((COALESCE(f.trip_schedule_relationship, 0) = 3)::int) AS was_canceled
    FROM gold.fact_trip_delay_snapshot AS f
    INNER JOIN gold.dim_provider AS dp ON dp.provider_id = f.provider_id
    WHERE f.provider_id = :provider_id
      AND f.route_id IS NOT NULL
      AND f.trip_id IS NOT NULL
      AND f.start_date IS NOT NULL
      AND timezone(dp.timezone, f.captured_at_utc)::date = :local_date
    GROUP BY f.provider_id, f.route_id, f.trip_id, f.start_date
)
INSERT INTO gold.route_cancellation_daily (... total_trip_days, canceled_trip_days, cancellation_rate_pct ...)
SELECT
    provider_id, :local_date, route_id,
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE was_canceled = 1)::integer,
    ROUND(100.0 * COUNT(*) FILTER (WHERE was_canceled = 1) / NULLIF(COUNT(*), 0), 2),
    :built_at_utc
FROM trip_day
GROUP BY provider_id, route_id
ON CONFLICT (provider_id, provider_local_date, route_id) DO UPDATE SET ...`,
		notReally: {
			fr: "Un usager confond ça avec « le pourcentage de TOUS les trajets programmés de cette ligne qui ont été annulés ». Ce n'est pas ça. Le dénominateur n'est que les trajets que le flux a rapportés — les trajets discrètement abandonnés sans étiquette ANNULÉ lui sont invisibles, donc le vrai taux d'annulation de l'horaire peut être plus élevé. C'est un proxy rapporté par le flux, pas une figure de complétude de service certifiée.",
			en: 'A citizen is most likely to misread this as “the percentage of all scheduled trips on this route that were canceled.” It is NOT that. The denominator is only the trips the realtime feed reported — trips the feed silently dropped without a CANCELED tag are invisible to it, so the true timetable cancellation rate can be higher. It is a feed-reported proxy, not a certified service-completeness figure.',
		},
		caveats: {
			fr: [
				"PROXY, pas certifié : c'est la part des trajets RAPPORTÉS par le flux GTFS-RT marqués ANNULÉS (schedule_relationship = 3). Pas une statistique STM certifiée. Aucun AVL, aucune réconciliation programmé-vs-opéré.",
				"DÉNOMINATEUR = TRAJETS RAPPORTÉS, PAS L'HORAIRE : total_trip_days ne compte que les jours-trajets que le flux a mentionnés. Un trajet discrètement abandonné n'est PAS compté comme annulé. Le taux de l'horaire publié pourrait être plus élevé.",
				'NULL-comme-non-annulé : le GTFS-RT omet schedule_relationship pour les trajets ordinaires; le silver stocke NULL; le SQL le COALESCE à 0 pour les garder au dénominateur comme non-annulés.',
				"JOUR-TRAJET = (trip_id, start_date) distinct, replié par MAX sur les sondages : un trajet vu plusieurs fois compte UNE fois; annulé s'il fut JAMAIS vu annulé (collant, biais vers l'annulation).",
				'NULL vs 0 : cancellation_rate_pct est NULL (jamais un 0 % fabriqué) quand total_trip_days = 0. Un blackout du flux affiche « aucune donnée », pas 0 % annulé.',
				"SENTINELLES EXCLUES : route_id IS NULL est filtré à la source, donc __unrouted__ n'atteint jamais la surface d'annulation.",
				'SIGNAUX MORTS non utilisés : trajets ADDED, occupancy_percentage, congestion_level, delay natif ne jouent aucun rôle.',
				'TAUX RÉSEAU PONDÉRÉ PAR COMPTE, pas une moyenne des taux par ligne : network_trend re-dérive 100 × SUM(canceled)/SUM(total).',
			],
			en: [
				'PROXY, NOT certified: this is the share of trips the GTFS-RT feed REPORTED that were flagged CANCELED (schedule_relationship=3). It is not an STM-certified statistic. There is no AVL and no scheduled-vs-operated reconciliation.',
				'DENOMINATOR IS REPORTED TRIPS, NOT THE TIMETABLE: total_trip_days counts only trip-days the feed actually mentioned. A trip silently dropped from the feed is NOT counted as canceled. The published-schedule cancellation rate could be higher.',
				'NULL-as-not-canceled: GTFS-RT omits schedule_relationship for ordinary trips; silver stores NULL; the SQL COALESCEs NULL to 0 so those trips stay in the denominator as non-canceled.',
				'TRIP-DAY = distinct (trip_id, start_date), MAX-collapsed across polls: a trip seen in many polls counts ONCE; counted canceled if EVER seen canceled (sticky/monotonic, an over-not-under bias for canceled).',
				'NULL vs 0 honesty: cancellation_rate_pct is NULL (never a fabricated 0%) when total_trip_days = 0. A feed blackout surfaces as no-data, not as 0% canceled.',
				'SENTINELS EXCLUDED: route_id IS NULL is filtered at source, so the internal __unrouted__ sentinel never reaches the cancellation surface.',
				'DEAD SIGNALS NOT USED: ADDED trips, native occupancy_percentage, congestion_level, and native delay play no role; only trip_schedule_relationship=3 drives this metric.',
				'NETWORK RATE IS COUNT-WEIGHTED, not a mean of route rates: network_trend re-derives 100×SUM(canceled)/SUM(total).',
			],
		},
	},
	{
		key: 'skippedStop',
		anchor: 'skipped-stop',
		cluster: 'serviceDelivered',
		family: 8,
		confidence: 'proxy',
		name: { fr: "Taux d'arrêts non desservis", en: 'Skipped-stop rate' },
		sciName: 'skipped_stop_rate_pct',
		oneLiner: {
			fr: "La part des messages de prédiction d'arrêt qui portaient un drapeau « cet arrêt sera sauté » — un drapeau déclaré par le flux, pas un dépassement physique vérifié.",
			en: 'The share of stop-prediction messages that carried a “this stop will be skipped” flag — a feed-declared flag, not a verified physical pass-by.',
		},
		definition: {
			fr: "Pour une ligne un jour clos, c'est la part des prédictions d'arrêt que le flux en direct a envoyées qui étaient marquées « cet arrêt sera sauté ». Autrement dit : sur toutes les mises à jour d'arrêt à venir diffusées ce jour-là, quel pourcentage disait « on ne s'arrête pas ici ». Un chiffre plus élevé = plus d'avis de saut. Mesuré par ligne, par jour local (Montréal) clos, et il n'a commencé à s'accumuler qu'à partir du jour de lancement — aucun historique rétroactif.",
			en: 'For one bus route on one finished calendar day, this is the share of the stop predictions the agency’s live feed sent out that were flagged “this stop will be skipped.” Think of it as: out of all the upcoming-stop updates the route’s vehicles broadcast that day, what percentage said “we’re not stopping here.” A higher number means riders saw more “skip” notices. It is measured per route, per closed local (Montreal) day, and only started accumulating from the day the feature shipped — there is no backfilled history.',
		},
		math: {
			fr: "skipped_stop_rate_pct = ROUND( 100,0 × SUM(skipped_stop_count) / NULLIF(SUM(stop_time_update_count), 0), 2 ), groupé par (provider_id, route_id) sur un jour local. Numérateur = mises à jour d'arrêt marquées SKIPPED (schedule_relationship = 1); dénominateur = TOUTES les mises à jour d'arrêt observées (non filtré sur schedule_relationship; NULL = SCHEDULED et reste au dénominateur). NULL quand zéro mise à jour observée ce jour-là.",
			en: 'skipped_stop_rate_pct = ROUND( 100.0 × SUM(skipped_stop_count) / NULLIF(SUM(stop_time_update_count), 0), 2 ), grouped by (provider_id, route_id) over one provider-local day. Numerator = SKIPPED-flagged stop-time updates (schedule_relationship = 1); denominator = ALL observed stop-time updates (not filtered on schedule_relationship; NULL = SCHEDULED and stays in the denominator). NULL when the route had zero observed updates that day.',
		},
		sql: `-- gold/rollups.py UPSERT_ROUTE_SKIPPED_STOP_DAILY (essential aggregation):
SELECT
    f.provider_id,
    :local_date,
    f.route_id,
    SUM(f.stop_time_update_count)::bigint,
    SUM(f.skipped_stop_count)::bigint,
    ROUND(
        100.0 * SUM(f.skipped_stop_count) / NULLIF(SUM(f.stop_time_update_count), 0),
        2
    ),
    :built_at_utc
FROM gold.fact_trip_delay_snapshot AS f
INNER JOIN gold.dim_provider AS dp ON dp.provider_id = f.provider_id
WHERE f.provider_id = :provider_id
  AND f.route_id IS NOT NULL
  AND timezone(dp.timezone, f.captured_at_utc)::date = :local_date
GROUP BY f.provider_id, f.route_id

-- gold/marts.py fact ETL — where the carried counts originate:
count(*)::integer AS stop_time_update_count,
-- GTFS-RT StopTimeUpdate.ScheduleRelationship SKIPPED = 1 (stop-level,
-- distinct from the trip-level CANCELED = 3); NULL = SCHEDULED.
count(*) FILTER (WHERE stc.schedule_relationship = 1)::integer
    AS skipped_stop_count`,
		notReally: {
			fr: "Un usager lira ça comme « X % des bus de cette ligne ont sauté un arrêt / brûlé mon arrêt aujourd'hui ». Ce n'est pas ça. C'est la part des messages de prédiction d'arrêt en direct portant un drapeau SKIPPED — une prédiction déclarée par le flux, pas un dépassement physique vérifié, et comptée sur des messages de mise à jour (un arrêt achalandé en génère beaucoup), pas sur des usagers, trajets ou montées.",
			en: 'A citizen is most likely to read this as “X% of this route’s buses skipped a stop / blew past my stop today.” It is NOT that. It is the share of the route’s live stop-prediction messages that carried a SKIPPED flag — a feed-declared prediction, not a verified physical pass-by, and counted over stop-update messages (a busy stop generates many updates), not over riders, trips, or boardings.',
		},
		caveats: {
			fr: [
				"PROXY, pas vérifié : c'est le drapeau SKIPPED du GTFS-RT (StopTimeUpdate.ScheduleRelationship = 1) — un saut prédit/déclaré dans le flux, PAS un dépassement confirmé. Aucune vérité AVL.",
				"Le dénominateur est TOUTES les mises à jour d'arrêt observées, y compris à relation NULL (NULL = SCHEDULED et reste au dénominateur). Délibérément non filtré sur schedule_relationship.",
				"RAMP-IN / aucun rétroactif : l'historique s'accumule en AVANT seulement depuis le lancement (migration 0050, 2026-06-18). La table silver de ~738 M de rangées n'a PAS été scannée historiquement; les jours antérieurs sont simplement absents — pas zéro.",
				'NULL : skipped_stop_rate_pct est NULL (garde NULLIF) quand une ligne a zéro mise à jour observée ce jour-là; jamais 0 %. Ne pas imputer 0.',
				"Append-only : un jour déjà filigrané n'est jamais recalculé, donc le taux d'un jour passé est gelé.",
				'Grain jour local (tz Montréal); les jours de transition DST ont 23 h/25 h mais restent un seul seau de date locale; les jours partiels au lancement ont des dénominateurs minces.',
				"DISTINCT des annulations de trajet : SKIPPED = 1 est au niveau de l'arrêt; CANCELED = 3 (niveau trajet) est le taux d'annulation séparé. Ne pas confondre.",
				'SIGNAUX STM MORTS non utilisés : occupancy_percentage, congestion_level, delay natif, trajets ADDED.',
			],
			en: [
				'PROXY, not verified: this is the agency’s own GTFS-RT SKIPPED flag (StopTimeUpdate.ScheduleRelationship=1) — a predicted/declared skip in the live feed, NOT a confirmed pass-by. There is no AVL ground truth.',
				'Denominator is ALL observed stop-time updates, including those with a NULL relationship (NULL = SCHEDULED and stays in the denominator). Deliberately NOT filtered on schedule_relationship.',
				'RAMP-IN / no backfill: history accrues FORWARD only from launch (migration 0050, 2026-06-18). The ~738M-row silver table was NOT scanned historically; earlier days are simply absent — not zero.',
				'NULL handling: skipped_stop_rate_pct is NULL (NULLIF guard) when a route had zero observed updates that day; never 0%. Do not impute 0.',
				'Append-only: a day already watermarked is never recomputed, so the rate for a past day is frozen as built.',
				'Day grain is provider-local (Montreal tz); DST transition days have 23h/25h but are still a single local date bucket; partial first/last days at launch have thin denominators.',
				'Distinct from trip-level cancellations: SKIPPED=1 is stop-level; CANCELED=3 (trip-level) is the separate cancellation_rate metric. Do not conflate.',
				'DEAD STM signals are NOT used: occupancy_percentage, congestion_level, native delay, ADDED trips.',
			],
		},
	},
	{
		key: 'serviceSpan',
		anchor: 'service-span',
		cluster: 'serviceDelivered',
		family: 7,
		confidence: 'proxy',
		name: {
			fr: 'Amplitude de service et ponctualité du premier/dernier',
			en: 'Service span and first/last-trip punctuality',
		},
		sciName: 'service_span_min · first/last_trip_delay_min',
		oneLiner: {
			fr: "Quand le premier et le dernier trajet OBSERVÉS d'une ligne ont démarré ce jour-là, et l'écart entre eux — basé sur l'apparition dans le flux, pas l'horaire imprimé; c'est un plancher des heures réelles d'opération.",
			en: 'When the route’s first and last OBSERVED trips started that day, and the gap between them — based on feed appearance, not the printed timetable; it is a floor on real operating hours.',
		},
		definition: {
			fr: "Pour chaque ligne chaque jour fini, on montre quand son premier trajet observé a démarré, quand le dernier a démarré, et combien de minutes les séparent (l'« amplitude de service » — environ combien de temps la ligne roule ce jour-là). On montre aussi le retard/l'avance du tout premier et du tout dernier trajet, en minutes, contre leur horaire. « Début de trajet » est le premier moment où l'on a réellement vu un trajet rapporter dans le flux en direct ce jour-là — pas son départ imprimé à l'horaire. Un retard positif = en retard, négatif = en avance. Chaque jour se tient seul; aucune moyenne entre jours.",
			en: 'For each route on each finished day, this shows when the route’s first observed trip started, when its last one started, and how many minutes apart those two are (the “service span” — roughly how long the route runs that day). It also shows how late or early the very first and very last trips of the day were, in minutes, versus their schedule. “Trip start” is the first moment we actually saw a trip reporting in the live feed that day — not its printed timetable departure. A positive delay means late; a negative one means early. Each day stands on its own; there is no average across days.',
		},
		math: {
			fr: 'Par (provider_id, route_id, jour local) : trip_start(trip) = MIN(captured_at_utc) sur les observations du trajet. first = trip au trip_start le plus tôt; last = au plus tard. service_span_min = ROUND( EXTRACT(EPOCH FROM (MAX(trip_start) − MIN(trip_start))) / 60,0 ) en minutes entières. first/last_trip_delay_min = le delay_seconds de la PREMIÈRE observation de ce trajet, en round(sec/60, 1). Aucun dénominateur/ratio — des horodatages extrémaux et des comptes.',
			en: 'Per (provider_id, route_id, local day): trip_start(trip) = MIN(captured_at_utc) over that trip’s observations. first = trip with earliest trip_start; last = latest. service_span_min = ROUND( EXTRACT(EPOCH FROM (MAX(trip_start) − MIN(trip_start))) / 60.0 ) as integer minutes. first/last_trip_delay_min = the FIRST observation’s delay_seconds of that trip, as round(sec/60, 1). No denominator/ratio — extremal timestamps and counts.',
		},
		sql: `WITH trip_starts AS (
    SELECT f.provider_id, f.route_id, f.trip_id,
           MIN(f.captured_at_utc) AS trip_start_utc,
           (ARRAY_AGG(f.delay_seconds ORDER BY f.captured_at_utc, f.entity_index))[1] AS first_obs_delay
    FROM gold.fact_trip_delay_snapshot AS f
    INNER JOIN gold.dim_provider AS dp ON dp.provider_id = f.provider_id
    WHERE f.provider_id = :provider_id AND f.route_id IS NOT NULL AND f.trip_id IS NOT NULL
      AND timezone(dp.timezone, f.captured_at_utc)::date = :local_date
    GROUP BY f.provider_id, f.route_id, f.trip_id
),
ranked AS (
    SELECT provider_id, route_id, trip_start_utc, first_obs_delay,
           ROW_NUMBER() OVER (PARTITION BY provider_id, route_id ORDER BY trip_start_utc, first_obs_delay) AS rn_first,
           ROW_NUMBER() OVER (PARTITION BY provider_id, route_id ORDER BY trip_start_utc DESC, first_obs_delay) AS rn_last
    FROM trip_starts
)
SELECT provider_id, :local_date, route_id,
       MIN(trip_start_utc), MAX(trip_start_utc),
       ROUND(EXTRACT(EPOCH FROM (MAX(trip_start_utc) - MIN(trip_start_utc))) / 60.0)::integer,
       MAX(first_obs_delay) FILTER (WHERE rn_first = 1),
       MAX(first_obs_delay) FILTER (WHERE rn_last = 1),
       COUNT(*)::integer, :built_at_utc
FROM ranked
GROUP BY provider_id, route_id`,
		notReally: {
			fr: "Ce n'est PAS le premier et le dernier départ programmés/à l'horaire de la ligne (par ex. « la 165 roule de 05 h 00 à 01 h 30 selon l'horaire »). C'est quand le flux en direct a montré pour la première et la dernière fois un trajet, donc une capture manquée tôt le matin ou tard le soir fait paraître la ligne démarrer plus tard ou finir plus tôt qu'en réalité — l'amplitude est un plancher des heures d'opération réelles, pas la fenêtre de service officielle.",
			en: 'It is NOT the route’s scheduled/timetabled first and last departure (e.g., it does not tell you “the 165 runs 05:00–01:30 per the timetable”). It is when the live feed first and last showed a trip, so a missed early-morning or late-night capture makes the route look like it started later or ended earlier than it really does — the span is a floor on real operating hours, not the official service window.',
		},
		caveats: {
			fr: [
				"PROXY, PAS L'HORAIRE : « premier/dernier trajet » = premier/dernier trajet OBSERVÉ dans le flux GTFS-RT ce jour-là (MIN(captured_at_utc) par trajet) — pas le départ programmé du GTFS statique. Une capture tardive ou une panne aux bords du jour tronque l'amplitude.",
				"LE RETARD EST L'ÉCART PRÉDIT, pas une ponctualité certifiée, sans AVL : first/last_trip_delay_min est l'écart prédit GTFS-RT à la première observation du trajet, en minutes. C'est le retard PREMIER-OBSERVÉ, pas au terminus réel.",
				"AUCUN DÉNOMINATEUR / AUCUN TAUX : des horodatages extrémaux, une différence de deux horodatages et un compte. Avec un seul trajet observé, l'amplitude est 0; NULL uniquement quand aucun trajet n'est observé.",
				'BORNE DE JOUR SÛRE EN DST : jour local découpé par timezone(dp.timezone, captured_at_utc)::date; la différence EPOCH est calculée sur des instants UTC, donc non distordue par le décalage DST.',
				"APPEND-ONLY, RAMP-IN, AUCUN RÉTROACTIF : une rangée par jour local clos, bâtie le lendemain de sa clôture. L'historique s'accumule en avant seulement depuis le lancement (2026-06-18); élagué à ~365 jours.",
				"HYGIÈNE SENTINELLE : les rangées exigent route_id IS NOT NULL et trip_id IS NOT NULL, donc __unrouted__ / __unknown_stop__ n'entrent jamais.",
				"DÉTERMINISME DE BRIS D'ÉGALITÉ : à trip_start égal, le trajet au plus petit retard premier-observé est choisi.",
				"SIGNAUX STM MORTS INTOUCHÉS : cette famille n'utilise que captured_at_utc et delay_seconds.",
			],
			en: [
				'PROXY, NOT TIMETABLE: “first/last trip” = first/last trip we OBSERVED in the GTFS-RT feed that day (MIN(captured_at_utc) per trip) — not the scheduled departure from GTFS static. A late-starting capture or an outage at the edges silently truncates the span.',
				'DELAY IS PREDICTED SCHEDULE DEVIATION, NOT CERTIFIED OTP and has NO AVL: first/last_trip_delay_min is the GTFS-RT predicted deviation on that trip’s first observation, in minutes. It is the first-OBSERVED delay, not the delay at the actual terminus.',
				'NO DENOMINATOR / NO RATE: extremal timestamps, a difference of two timestamps, and a count. With a single observed trip the span is 0; it is NULL only when no trips were observed.',
				'DST-SAFE DAY BOUNDARY: the local day is cut with timezone(dp.timezone, captured_at_utc)::date; the EPOCH difference is computed on UTC instants so it is not distorted by the DST shift.',
				'APPEND-ONLY, RAMP-IN, NO BACKFILL: one row per closed local day, built the day after it closes. History accrues forward only from launch (2026-06-18); pruned to ~365 days.',
				'SENTINEL HYGIENE: rows require route_id IS NOT NULL and trip_id IS NOT NULL, so the __unrouted__ / __unknown_stop__ sentinels never enter.',
				'TIE-BREAK DETERMINISM: when two trips share the same start instant, the one with the smaller first-observed delay is chosen.',
				'DEAD STM SIGNALS UNTOUCHED: this family uses only captured_at_utc and delay_seconds.',
			],
		},
	},
	// ── 04 Crowding ────────────────────────────────────────────────────────────
	{
		key: 'occupancy',
		anchor: 'occupancy',
		cluster: 'crowding',
		family: 6,
		confidence: 'proxy',
		name: { fr: 'Achalandage (parts par palier)', en: 'Occupancy mix (crowding)' },
		sciName: 'occupancy_mix',
		oneLiner: {
			fr: "La part des relevés de véhicules dans chacun des cinq paliers d'achalandage (vide, plusieurs places, peu de places, debout, plein) — la part des bus-moments rapportés, PAS « % plein » ni « % d'usagers debout ».",
			en: 'The share of vehicle reports in each of five crowding levels (empty, many seats, few seats, standing, full) — the share of reported bus-moments, NOT “% full” or “% of riders standing.”',
		},
		definition: {
			fr: "À quel point les bus sont pleins, exprimé comme la part des relevés de véhicules tombés dans chacun des cinq paliers : vide, plusieurs places libres, peu de places libres, debout, plein. C'est bâti uniquement sur le « niveau » d'achalandage que les véhicules diffusent en direct (une catégorie comme « debout »), pas sur un décompte de têtes ni un pourcentage-plein. Donc « debout = 0,32 » signifie « 32 % des relevés de véhicules ayant rapporté un niveau disaient debout » — PAS « 32 % plein » et PAS « 32 % des usagers debout ». Les niveaux sont rapportés par relevé, donc les lignes achalandées (plus de véhicules, plus de relevés) contribuent davantage.",
			en: 'How full the buses are, expressed as the share of vehicle reports that fell into each of five crowding levels: empty, many seats free, few seats free, standing room only, and full. It is built only from the crowding “level” that vehicles broadcast over the live feed (a category like “standing-room-only”), not from any head-count or percentage-full number. So a value like “standing = 0.32” means “32% of the vehicle pings that reported a crowding level said standing-room-only” — it is NOT “32% full” and NOT “32% of riders were standing.” Levels are reported per vehicle ping, so busy routes contribute more pings.',
		},
		math: {
			fr: "Pour chaque palier b : share_b = count(relevés en palier b) / observation_count, où observation_count = count(relevés avec occupancy_status ∈ {0,1,2,3,4,5}). Appartenance : empty={0}, many_seats={1}, few_seats={2}, standing={3,4}, full={5}; les statuts {6,7,8} et NULL sont écartés. Les cinq parts somment à ~1,0. Règle honnête-None : si observation_count = 0, le mélange entier est null (pas un objet tout-à-zéro), car un mélange tout-à-zéro est indiscernable d'une vraie flotte toute vide.",
			en: 'For each band b: share_b = count(pings in band b) / observation_count, where observation_count = count(pings with occupancy_status ∈ {0,1,2,3,4,5}). Membership: empty={0}, many_seats={1}, few_seats={2}, standing={3,4}, full={5}; statuses {6,7,8} and NULL are dropped. The five shares sum to ~1.0. Honest-None rule: if observation_count = 0 the entire mix is null (not an all-zero object), because an all-zero mix is indistinguishable from a genuine all-empty fleet.',
		},
		sql: `-- gold/rollups.py UPSERT_ROUTE_OCCUPANCY_BAND_DAILY (the defining daily reduction)
INSERT INTO gold.route_occupancy_band_daily (
    provider_id, provider_local_date, route_id,
    observation_count, empty_count, many_seats_count,
    few_seats_count, standing_count, full_count, built_at_utc
)
SELECT
    f.provider_id,
    :local_date,
    COALESCE(f.route_id, '__unrouted__'),
    COUNT(*) FILTER (WHERE f.occupancy_status IN (0, 1, 2, 3, 4, 5))::integer,  -- observation_count
    COUNT(*) FILTER (WHERE f.occupancy_status = 0)::integer,        -- empty
    COUNT(*) FILTER (WHERE f.occupancy_status = 1)::integer,        -- many_seats
    COUNT(*) FILTER (WHERE f.occupancy_status = 2)::integer,        -- few_seats
    COUNT(*) FILTER (WHERE f.occupancy_status IN (3, 4))::integer,  -- standing (CRUSHED folds in)
    COUNT(*) FILTER (WHERE f.occupancy_status = 5)::integer,        -- full
    :built_at_utc
FROM gold.fact_vehicle_snapshot AS f
INNER JOIN gold.dim_provider AS dp ON dp.provider_id = f.provider_id
WHERE f.provider_id = :provider_id
  AND timezone(dp.timezone, f.captured_at_utc)::date = :local_date
GROUP BY f.provider_id, COALESCE(f.route_id, '__unrouted__')
ON CONFLICT (provider_id, provider_local_date, route_id) DO UPDATE SET ... ;

-- shares + honest-None: historic.py _occupancy_mix_from_bands
counts = {band: int(row[band] or 0) for band in _OCCUPANCY_BANDS}
total = sum(counts.values())
if not total: return None        # honest-None, never an all-zero mix`,
		notReally: {
			fr: "Ce n'est PAS « à quel point le bus est plein en pourcentage » ni « quelle fraction des usagers était debout ». « debout = 0,32 » signifie que 32 % des relevés de véhicules portant un niveau étaient marqués debout — la part des bus-moments rapportés à ce niveau, un mélange de catégories pondéré par observations, pas un facteur de charge, pas un décompte de têtes, pas une statistique par trajet ou par usager. Les heures de bus vides la nuit peuvent dominer la part « vide » même sur une ligne bondée à l'heure de pointe.",
			en: 'It is NOT “how full the bus is in percent” and NOT “what fraction of riders were standing.” A reading of standing=0.32 means 32% of the vehicle reports that carried a crowding level were tagged standing-room-only — the share of reported bus-moments at that level, an observation-weighted category mix, not a load factor, not a headcount, and not a per-trip or per-rider statistic. Empty bus-hours at night can dominate the “empty” share even on a route that is packed at rush hour.',
		},
		caveats: {
			fr: [
				'PROXY, pas un facteur de charge : les paliers sont des catégories GTFS-RT OccupancyStatus auto-rapportées; AUCUN pourcentage-plein numérique. occupancy_percentage est un signal STM MORT, jamais lu; congestion_level et delay natif aussi morts et exclus.',
				'DÉNOMINATEUR = RELEVÉS portant un palier, pas véhicules/trajets/usagers. Pondéré par observations : un véhicule qui rapporte plus souvent contribue plus.',
				"Les codes 3 (STANDING_ROOM_ONLY) et 4 (CRUSHED) sont REPLIÉS en un seul palier « debout », donc la « charge écrasante » n'est pas distinguable du debout ordinaire.",
				'Les codes 6/7/8 (NOT_ACCEPTING / NO_DATA / NOT_BOARDABLE) et occupancy_status NULL sont exclus du numérateur ET du dénominateur.',
				'Honnête-None : sans aucun relevé portant un palier, le mélange entier est null (slice-9.1.1y), jamais un objet tout-à-zéro. Les consommateurs doivent afficher « aucune donnée », pas 0 %.',
				'Borne de jour locale (DST-correcte). Sentinelles : les véhicules sans route_id roulent en __unrouted__; la fenêtre 30 j par ligne filtre une vraie route_id.',
				'Couverture dépendante du flux : occupancy_status ~99,84 % peuplé (pas 100 %), append-only sans rétroactif au-delà de la fenêtre de faits retenue.',
				'Live vs historique sont des populations différentes; le métro est structurellement absent du temps réel.',
			],
			en: [
				'PROXY, not a load factor: bands are GTFS-RT OccupancyStatus categories that vehicles self-report; there is NO numeric percent-full. occupancy_percentage is a DEAD STM signal and is never read; congestion_level and native delay are likewise dead and excluded.',
				'DENOMINATOR is band-bearing PINGS, not vehicles/trips/riders. Observation-weighted: a vehicle that reports more snapshots contributes more.',
				'Codes 3 (STANDING_ROOM_ONLY) and 4 (CRUSHED) are FOLDED into a single “standing” band, so crush load is not distinguishable from ordinary standing.',
				'Codes 6/7/8 (NOT_ACCEPTING / NO_DATA / NOT_BOARDABLE) and NULL occupancy_status are excluded from BOTH numerator and denominator.',
				'Honest-None: with zero band-bearing pings the entire mix is null (slice-9.1.1y), never an all-zero object. Consumers must render “no data”, not 0%.',
				'Day boundary is provider-local (DST-correct). Sentinels: vehicles with no route_id roll into __unrouted__; the per-route 30d window filters to a real route_id.',
				'Coverage is feed-dependent: occupancy_status is ~99.84% populated (not 100%), append-only with no backfill beyond the retained fact window.',
				'Live vs historic are different populations; metro is structurally absent from realtime, so this is effectively a bus(+surface)-crowding picture.',
			],
		},
	},
	// ── 05 Time-of-day habits ──────────────────────────────────────────────────
	{
		key: 'habits',
		anchor: 'habits',
		cluster: 'habits',
		family: 12,
		confidence: 'proxy',
		name: { fr: 'Carte des problèmes récurrents (7×24)', en: 'Repeat-problem heatmap (7×24)' },
		sciName: 'habits.matrix · repeat_problem_relative',
		oneLiner: {
			fr: 'Une grille 7 jours × 24 heures : chaque cellule indique à quel point la ligne tend à être problématique dans ce créneau, RELATIVEMENT à son propre pire créneau (1,0 = pire); null = jamais observée. Pas comparable entre lignes.',
			en: 'A 7-day × 24-hour grid: each cell shades how problematic the route tends to be in that slot, RELATIVE to its own worst slot (1.0 = worst); null = never observed. Not comparable between routes.',
		},
		definition: {
			fr: "Une grille de 7 rangées (jour de semaine, lundi=1 … dimanche=7, heure de Montréal) par 24 colonnes (heure 0-23, locale) pour une ligne : chaque cellule teinte à quel point cette ligne tend à être fiablement mauvaise dans ce créneau jour-et-heure, comparé à son PROPRE pire créneau. 1,0 = « le créneau le plus chroniquement problématique de cette ligne »; 0,0 = « observé mais constamment calme »; une cellule vide/null = jamais observée (pas de service ou pas de donnée). C'est RELATIF à chaque ligne — un 1,0 sur une bonne ligne n'est PAS aussi grave qu'un 1,0 sur une ligne chroniquement en retard.",
			en: 'A 7-rows-by-24-columns grid for one route: each row is a day of the week (Monday=1 … Sunday=7, local Montréal time), each column is an hour (0–23, local time). Every cell shades how reliably bad that route tends to be in that day-and-hour slot, compared to that same route’s own worst slot. A value of 1.0 means “this is this route’s most chronically problematic hour”; 0.0 means “observed but consistently calm”; an empty/null cell means the route was never observed running in that slot. It is RELATIVE to each route — a 1.0 on a generally good route is NOT as bad as a 1.0 on a chronically late route.',
		},
		math: {
			fr: 'Par cellule : raw_score = severe_delay_count × 10 + max(avg_delay_seconds, 0) / 60, arrondi à 4 décimales et PLAFONNÉ à 9999.9999 (garde de débordement de stockage, pas une vraie magnitude). Cellules regroupées par jour-de-semaine et heure LOCAUX. Cellule publiée = raw_score / route_max, où route_max = max raw_score sur les cellules observées de la ligne. Si route_max = 0 → 0,0; sinon le pire → 1,0. Cellules non observées → null; cellule observée à score NULL → null (jamais 0,0).',
			en: 'Per cell: raw_score = severe_delay_count × 10 + max(avg_delay_seconds, 0) / 60, rounded to 4 decimals and CAPPED at 9999.9999 (a storage-overflow guard, not a real magnitude). Cells bucketed by LOCAL day-of-week and hour. Published cell = raw_score / route_max, where route_max = max raw_score over the route’s observed cells. If route_max = 0 → 0.0; else the worst → 1.0. Unobserved cells → null; an observed cell with a NULL raw score → null (never 0.0).',
		},
		sql: `-- UPSERT_ROUTE_HABIT_SCORE (gold/rollups.py): re-bucket hourly mart into LOCAL (dow,hour) and compute the raw repeat-problem score
WITH habit AS (
    SELECT
        rd.provider_id, rd.route_id,
        EXTRACT(ISODOW FROM timezone(dp.timezone, rd.period_start_utc))::integer AS day_of_week_iso,
        EXTRACT(HOUR  FROM timezone(dp.timezone, rd.period_start_utc))::integer AS hour_of_day_local,
        SUM(rd.observation_count)::integer AS observation_count,
        ROUND(SUM(rd.avg_delay_seconds * NULLIF(rd.observation_count, 0))
              / NULLIF(SUM(rd.observation_count), 0), 2) AS avg_delay_seconds,
        SUM(rd.severe_delay_count)::integer AS severe_delay_count
    FROM gold.route_delay_hourly AS rd
    INNER JOIN gold.dim_provider AS dp ON dp.provider_id = rd.provider_id
    WHERE rd.provider_id = :provider_id
    GROUP BY 1, 2, 3, 4
)
INSERT INTO gold.route_habit_score (..., repeat_problem_score, built_at_utc)
SELECT ...,
    LEAST(
        ROUND( (severe_delay_count::numeric * 10
                + GREATEST(COALESCE(avg_delay_seconds, 0), 0) / 60), 4),
        9999.9999),               -- overflow guard, not a real magnitude
    :built_at_utc
FROM habit
ON CONFLICT (provider_id, route_id, day_of_week_iso, hour_of_day_local) DO UPDATE SET ...;

-- Per-route [0,1] normalization at publish time (_helpers.py _build_habits_matrix):
-- observed = [v for v in cells if v is not None]; route_max = max(observed) or 0.0
-- cell = None if v is None else (round(v / route_max, 4) if route_max > 0 else 0.0)`,
		notReally: {
			fr: "Un usager confond un 1,0 (ou une cellule foncée) avec « cette ligne sera ~X minutes en retard à cette heure » ou « c'est la pire ligne du réseau à cette heure ». NI L'UN NI L'AUTRE. Cela dit seulement « par rapport à l'historique de cette seule ligne, ce jour-et-heure est où elle est la plus chroniquement problématique ». La cellule ne porte aucune minute, aucune probabilité pour un trajet précis, aucun classement entre lignes; un 1,0 sur une ligne fiable peut être plus doux en absolu qu'un 0,3 sur une ligne chroniquement en retard.",
			en: 'A citizen is most likely to misread a 1.0 (or a dark cell) as “this route will be ~X minutes late at this hour” or “this is the worst route in the network at this hour.” It is NEITHER. It only says “relative to this one route’s own history, this day-and-hour is where it is most chronically problematic.” The cell carries no minutes, no probability for a specific trip, and no cross-route ranking; a 1.0 on a reliable route can be milder in absolute terms than a 0.3 on a chronically late route.',
		},
		caveats: {
			fr: [
				"PROXY, pas une ponctualité certifiée : bâti entièrement sur l'écart à l'horaire prédit du GTFS-RT, pas l'AVL/les arrivées réelles. « Grave » = retard prédit > 300 s.",
				"NORMALISATION RELATIVE par ligne : chaque cellule est divisée par le PIRE créneau de CETTE ligne, donc un 1,0 ici n'est PAS comparable à un 1,0 d'une autre ligne. La magnitude absolue (minutes) est délibérément écartée.",
				"Composition du score brute opaque : repeat_problem_score = severe_count×10 + mean_delay_min. La pondération ×10 fait dominer les événements graves récurrents; le terme de retard moyen est une MOYENNE pondérée par observations (corrigée de l'ancien mauvais étiquetage « médiane »).",
				'La valeur 9999.9999 est une GARDE de débordement Numeric(8,4), pas une vraie magnitude. Une cellule au plafond est simplement le max de la ligne et se normalise à exactement 1,0.',
				'Discipline du null : un créneau non observé est null = « pas de service / pas de donnée »; un créneau observé à score NULL est AUSSI gardé null, JAMAIS forcé à un faux 0,0 calme. Un vrai créneau calme observé est un vrai 0,0.',
				"DST / heure locale : dow et heure viennent de l'heure locale America/Montreal. L'heure de saut printanier accumule zéro observation; l'heure répétée d'automne double-compte. Artefacts attendus deux fois l'an.",
				"Récurrence bornée par fenêtre : le feeder est un rebuild de fenêtre ouverte (~14 jours glissants), donc la carte reflète les habitudes RÉCENTES, pas tout l'historique. Les cellules clairsemées peuvent virer vers 1,0 sur un seul mauvais événement.",
				"La surface d'arrêt réutilise la MÊME forme mais avec un libellé d'échelle DISTINCT 'severe_relative'. Ne pas confondre : la famille de ligne est scale='repeat_problem_relative'. Une légende partagée doit clé sur le champ scale.",
			],
			en: [
				'PROXY, not certified OTP: built entirely on GTFS-RT predicted schedule-deviation, not AVL/actual arrivals. “Severe” = predicted delay > 300s.',
				'RELATIVE per-route normalization: every cell is divided by THAT route’s own worst cell, so a 1.0 here is NOT comparable to a 1.0 on another route. Absolute magnitude (minutes) is deliberately discarded.',
				'Raw score composition is opaque: repeat_problem_score = severe_count×10 + mean_delay_min. The ×10 weighting means recurring severe events dominate; the mean-delay term is an observation-weighted MEAN (corrected from the old mislabel “median”).',
				'The 9999.9999 value is a Numeric(8,4) overflow GUARD, not a real magnitude. An at-cap cell is simply the route’s max and normalizes to exactly 1.0.',
				'Null discipline: an unobserved slot is null = “no service / no data”; an observed slot with a NULL raw score is ALSO kept null, NEVER coerced to a false observed-calm 0.0. A genuinely calm observed slot is a real 0.0.',
				'DST / local-time bucketing: dow and hour come from America/Montreal local time. The spring-forward gap hour accrues zero observations; the fall-back repeated hour double-counts. Expected artifacts twice a year.',
				'Window-bounded recurrence: the feeder is an open-window rebuild (~trailing 14 days), so the heatmap reflects RECENT habits, not all-time. Sparse cells can swing toward 1.0 on a single bad event.',
				'The stop surface reuses the SAME shape but with a DISTINCT scale label “severe_relative”. Do not conflate: the route family is scale=“repeat_problem_relative”. A shared legend must key off the scale field.',
			],
		},
	},
	{
		key: 'seasonality',
		anchor: 'seasonality',
		cluster: 'habits',
		family: 9,
		confidence: 'proxy',
		name: { fr: 'Saisonnalité hebdomadaire', en: 'Weekday seasonality' },
		sciName: 'day_of_week.severe_pct',
		oneLiner: {
			fr: 'Regroupe les relevés par jour de la semaine (lun-dim, heure de Montréal) et montre par jour le retard moyen et la part de retards graves — bâti sur ~10 jours glissants, donc un motif court terme, pas une saison annuelle.',
			en: 'Groups readings by weekday (Mon–Sun, Montréal time) and shows, per weekday, the average lateness and severe-delay share — built on ~10 trailing days, so a short-term pattern, not a year-long season.',
		},
		definition: {
			fr: "Pour une ligne, ceci regroupe chaque relevé d'écart à l'horaire par le jour de la semaine où il s'est produit (lundi à dimanche, heure locale de Montréal) et montre, pour chaque jour : la lateur moyenne en minutes, et la part des relevés « gravement en retard » (plus de 5 minutes derrière). Ça répond à « cette ligne est-elle fiablement pire le vendredi que le mardi ? » C'est bâti uniquement sur la fenêtre glissante récente que garde le pipeline (environ les 10 derniers jours), donc un motif hebdomadaire court terme, pas un historique saisonnier d'un an.",
			en: 'For one route, this groups every schedule-deviation reading the feed gave us by which day of the week it happened on (Monday through Sunday, in Montréal local time) and shows, for each weekday: the average lateness in minutes, and the share of readings that were “severely late” (more than 5 minutes behind). It answers “is this route reliably worse on, say, Fridays than on Tuesdays?” It is built only from the recent trailing window of data the pipeline keeps (about the last 10 days), so it is a short-term weekday pattern, not a year-long seasonal history.',
		},
		math: {
			fr: 'Par ligne r et jour ISO d (1=lun..7=dim) : delay_obs = SUM(delay_observation_count) [retard connu]; severe_cnt = SUM(severe_delay_count) [delay > 300 s et |delay| ≤ 3600]; avg_delay_sec = SUM(avg_delay_seconds × delay_observation_count) / SUM(delay_observation_count) [MOYENNE pondérée par observations]. Publié : avg_delay_min = round(avg_delay_sec / 60, 1); severe_pct = round(100 × severe_cnt / delay_obs, 1) [dénominateur = delay_observation_count, PAS observation_count; None si delay_obs ≤ 0].',
			en: 'Per route r and ISO weekday d (1=Mon..7=Sun): delay_obs = SUM(delay_observation_count) [known delays]; severe_cnt = SUM(severe_delay_count) [delay > 300s and |delay| ≤ 3600]; avg_delay_sec = SUM(avg_delay_seconds × delay_observation_count) / SUM(delay_observation_count) [observation-weighted MEAN]. Published: avg_delay_min = round(avg_delay_sec / 60, 1); severe_pct = round(100 × severe_cnt / delay_obs, 1) [denominator = delay_observation_count, NOT observation_count; None if delay_obs ≤ 0].',
		},
		sql: `-- gold/rollups.py: UPSERT_ROUTE_DELAY_DAY_OF_WEEK (the defining aggregation)
INSERT INTO gold.route_delay_day_of_week (
    provider_id, day_of_week_iso, route_id, trip_count,
    observation_count, delay_observation_count, avg_delay_seconds,
    severe_delay_count, built_at_utc)
SELECT
    rd.provider_id,
    EXTRACT(ISODOW FROM timezone(dp.timezone, rd.period_start_utc))::integer,
    rd.route_id,
    SUM(rd.trip_count)::integer,                       -- hourly-distinct-trip sum: upper-bound proxy
    SUM(rd.observation_count)::integer,
    SUM(rd.delay_observation_count)::integer,          -- severe_pct denominator (known-delay rows)
    ROUND( SUM(rd.avg_delay_seconds * NULLIF(rd.delay_observation_count, 0))
           / NULLIF(SUM(rd.delay_observation_count), 0), 2 ),   -- observation-weighted MEAN
    SUM(rd.severe_delay_count)::integer,
    :built_at_utc
FROM gold.route_delay_hourly AS rd
INNER JOIN gold.dim_provider AS dp ON dp.provider_id = rd.provider_id
WHERE rd.provider_id = :provider_id
GROUP BY 1, 2, 3
ON CONFLICT (provider_id, day_of_week_iso, route_id) DO UPDATE SET ...;`,
		notReally: {
			fr: "Pas une affirmation que « cette ligne est toujours pire le vendredi » ni une note de ponctualité certifiée par jour. C'est une lateur moyenne pondérée court terme (~10 jours glissants) et une PART de retards graves par jour de semaine local, à partir des déviations prédites — avec de petits échantillons inégaux par jour. Un severe_pct élevé un jour peut reposer sur très peu de relevés; à lire avec observation_count, sans traiter avg_delay_min comme une médiane.",
			en: 'Not a statement that “this route is always worse on Fridays” or a certified day-of-week on-time score. It is a short-term (trailing ~10-day) weighted-average lateness and severe-late SHARE per local weekday, from predicted feed deviations — with small, uneven per-weekday samples. A high severe_pct on one weekday can rest on very few delay readings; read it together with observation_count, and do not treat avg_delay_min as a median.',
		},
		caveats: {
			fr: [
				"PROXY, pas une ponctualité certifiée : bâti sur l'écart à l'horaire prédit du GTFS-RT, pas l'AVL ni une métrique STM certifiée.",
				"DÉNOMINATEUR de severe_pct (correction d'honnêteté 3/3, migration 0051) : delay_observation_count = SUM(COUNT(delay_seconds)) — rangées à retard CONNU — PAS observation_count. severe_pct retourne None (pas 0) quand delay_obs ≤ 0.",
				"avg_delay_min est une MOYENNE pondérée par observations (jadis mal étiquetée « médiane »), signée (négatif = en avance). AUCUN p50/p90 à ce grain — les percentiles n'existent qu'au grain JOUR de l'arrêt.",
				'SEUIL grave = delay_seconds > 300 (5 min); les relevés |delay| > 3600 (1 h) sont fantômes et exclus en amont.',
				'FENÊTRE GLISSANTE, pas une vraie saisonnalité : route_delay_hourly est un historique fenêtré (seulement ~10 jours glissants par défaut) et route_delay_day_of_week est reconstruit à chaque exécution. Chaque seau de jour reflète ~1-2 occurrences de ce jour — motif court terme, pas un long historique saisonnier.',
				'DST / attribution du jour : day_of_week_iso calculé en heure locale America/Montreal, donc les relevés post-minuit et de transition DST tombent sur le bon jour calendaire local.',
				'trip_count est INTENTIONNELLEMENT OMIS du modèle public (la valeur gold est une somme horaire-distincte gonflée, pas des trajets distincts).',
				'SENTINELLES : __unrouted__ existe dans le mart mais ne doit jamais être surfacé comme une vraie ligne. SIGNAUX STM MORTS jamais utilisés.',
			],
			en: [
				'PROXY, not certified OTP: built from GTFS-RT predicted schedule-deviation, not AVL and not an STM-certified on-time metric.',
				'severe_pct DENOMINATOR (honesty-fix 3/3, migration 0051): delay_observation_count = SUM(COUNT(delay_seconds)) — rows with a KNOWN delay — NOT observation_count. severe_pct returns None (not 0) when delay_obs ≤ 0.',
				'avg_delay_min is an observation-weighted MEAN (was previously mislabeled “median”), signed (negative = running early). There is NO p50/p90 at this weekday grain — percentiles exist only at the stop DAY grain.',
				'SEVERE threshold = delay_seconds > 300 (5 min); readings with |delay| > 3600 (1 h) are treated as ghost/outlier and excluded upstream.',
				'ROLLING WINDOW, not true seasonality: route_delay_hourly is windowed-history (only the trailing ~10 days by default) and route_delay_day_of_week is rebuilt each run. Each weekday bucket reflects ~1-2 occurrences of that weekday — short-term pattern, NOT a long seasonal history.',
				'DST / weekday attribution: day_of_week_iso is computed in America/Montreal local time, so cross-midnight and DST-shift readings land on the correct local calendar weekday.',
				'trip_count is INTENTIONALLY OMITTED from the public model (the gold value is an inflated hourly-distinct sum, not distinct trips).',
				'SENTINELS: __unrouted__ exists in the mart but must never be surfaced as a real route. DEAD STM signals never used.',
			],
		},
	},
] as const;

/** Quick lookup by metric key (build-time stable; the array is the source order). */
export const METRICS_BY_KEY: Readonly<Record<MetricKey, MetricEntry>> = Object.fromEntries(
	METRICS.map((m) => [m.key, m]),
) as Record<MetricKey, MetricEntry>;

/** The metric ids in surface order — for the ToC + the parity test's coverage set. */
export const METRIC_KEYS: readonly MetricKey[] = METRICS.map((m) => m.key);

/** Localized name for a metric key (FR canonical / EN mirror). */
export function metricName(key: MetricKey, locale: Locale): string {
	return METRICS_BY_KEY[key].name[locale];
}

/**
 * The (i)-affordance payload for a metric label on the reliability surface: the
 * one-line tip + a localized deep link to the explainer at that metric's anchor.
 * `localizeHref` strips/re-adds the locale prefix; the `#anchor` is appended by
 * us (localizeHref treats the hash as caller-owned), so EN → `/metrics#otp` and
 * FR → `/fr/metrics#otp`.
 */
export function metricInfoFor(
	key: MetricKey,
	locale: Locale,
): { tip: string; href: string; anchor: string } {
	const entry = METRICS_BY_KEY[key];
	return {
		tip: entry.oneLiner[locale],
		href: `${localizeHref('/metrics', locale)}#${entry.anchor}`,
		anchor: entry.anchor,
	};
}
