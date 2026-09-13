import { serviceComparisonCopy } from '$lib/v1/serviceComparison';
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
	/** Notion family number (1..21), a provenance trace back to the science doc. */
	readonly family: number;
	/** Feed-derived estimate ('proxy') vs point-in-time census ('medium'). */
	readonly confidence: Confidence;
	/** Display name (FR canonical, EN mirror). */
	readonly name: BilingualText;
	/** The metric's science-doc name (mono, language-neutral identifier label). */
	readonly sciName: string;
	/** ONE-LINE plain explanation, the (i) hover tip. */
	readonly oneLiner: BilingualText;
	/** Full plain-language definition (ported from the Notion lead paragraph). */
	readonly definition: BilingualText;
	/** The math, plain + formula (ported from the Notion "Formula:" line). */
	readonly math: BilingualText;
	/** Representative SQL and publication arithmetic, shared by both locales. */
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
			fr: 'La part des prédictions à retard connu entre une minute d’avance et moins de cinq minutes de retard.',
			en: 'The share of known-delay predictions between one minute early and less than five minutes late.',
		},
		definition: {
			fr: 'Pour la sélection et la période affichées, ce pourcentage compte les relevés de retard prédit dans la bande à l’heure, de −60 secondes inclusivement à 300 secondes exclusivement. Chaque relevé à retard connu compte comme une observation; plusieurs relevés peuvent concerner le même voyage. Une valeur de 90 % signifie neuf observations sur dix dans cette bande. Les retards inconnus sont exclus du dénominateur. Cette mesure décrit les prédictions GTFS-RT, sans certifier les arrivées réelles ni compter les voyages ponctuels.',
			en: 'For the displayed selection and period, this percentage counts predicted-delay readings in the on-time band, from −60 seconds inclusive to 300 seconds exclusive. Each known-delay reading is one observation; multiple readings can describe the same trip. A value of 90% means nine observations in ten fall within that band. Unknown delays are excluded from the denominator. This measures GTFS-RT predictions, without certifying actual arrivals or counting punctual trips.',
		},
		math: {
			fr: 'Ponctualité = 100 × nombre de relevés dans [−60, 300) / nombre de relevés à retard connu. Les comptes des groupes sont additionnés avant la division. Le pourcentage entier est arrondi avec les demis s’éloignant de zéro : 1 relevé sur 40 donne 3 %. Un numérateur inconnu ou un dénominateur nul donne une valeur indisponible.',
			en: 'On-time percentage = 100 × readings in [−60, 300) / readings with a known delay. Counts are pooled before division. The whole percentage rounds ties away from zero: 1 reading in 40 gives 3%. An unknown numerator or empty denominator gives an unavailable value.',
		},
		sql: `-- Route population; omit the route filter for a network receipt.
SELECT
    SUM(on_time_observation_count) AS on_time,
    SUM(delay_observation_count) AS known
FROM gold.route_delay_spine
WHERE provider_id = :provider_id AND route_id = :route_id
  AND provider_local_date BETWEEN :win_start AND :win_end;

# Equivalent publication rounding (gold.reader.rates.otp_pct):
from decimal import Decimal, ROUND_HALF_UP

def otp_pct(on_time, known):
    if on_time is None or not known or known <= 0:
        return None
    pct = 100.0 * float(on_time) / float(known)
    return int(Decimal(str(pct)).quantize(Decimal('1'), rounding=ROUND_HALF_UP))`,
		notReally: {
			fr: 'Ce pourcentage décrit des prédictions observées. Il ne compte ni les voyages arrivés à l’heure ni les voyageurs concernés. Une ligne peu desservie ou qui saute des arrêts peut tout de même afficher une forte ponctualité.',
			en: 'This percentage describes observed predictions. It counts neither trips that arrived on time nor affected passengers. A route with infrequent service or skipped stops can still have a high on-time percentage.',
		},
		caveats: {
			fr: [
				'−60 secondes est inclus; 300 secondes est exclu. Exactement cinq minutes de retard est aussi exclu du numérateur des retards graves, qui exige plus de 300 secondes. Ces deux parts ne se complètent donc pas à 100 %.',
				'Pour les lignes et les bilans quotidiens, le dénominateur conserve tous les retards connus, même au-delà de ±3 600 secondes. Le retard moyen et les statistiques par arrêt utilisent une plage admissible différente.',
				'Les mises à jour répétées d’un voyage comptent séparément. Cette pondération par observations ne représente pas le nombre de voyageurs.',
				'Une cellule sans retard connu n’ajoute aucune observation au total. Un dénominateur entièrement vide donne une valeur indisponible, jamais une ponctualité de zéro.',
				'Les périodes utilisent les dates locales du fournisseur. Les journées de 23 ou 25 heures peuvent changer le mélange d’observations; les seuils restent les mêmes.',
				'La couleur d’un véhicule sur la carte suit des bandes de retard distinctes. Elle ne remplace pas ce pourcentage calculé sur plusieurs observations.',
			],
			en: [
				'−60 seconds is included; 300 seconds is excluded. Exactly five minutes late is also excluded from the severe-delay numerator, which requires more than 300 seconds. These two shares therefore do not add up to 100%.',
				'For routes and daily receipts, the denominator retains all known delays, including those beyond ±3,600 seconds. Average delay and stop statistics use a different accepted range.',
				'Repeated updates for one trip count separately. This observation weighting does not represent passenger numbers.',
				'A cell without known delays contributes no observations to the total. An entirely empty denominator gives an unavailable value, never an on-time percentage of zero.',
				'Periods use the provider’s local dates. Days of 23 or 25 hours can change the observation mix; the thresholds stay the same.',
				'A vehicle’s map color follows separate delay bands. It does not replace this percentage across multiple observations.',
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
			fr: 'L’écart moyen prédit par rapport à l’horaire, en minutes : positif pour un retard, négatif pour une avance.',
			en: 'Average predicted deviation from the timetable, in minutes: positive for late, negative for early.',
		},
		definition: {
			fr: 'La somme des écarts prévus utilisables divisée par le nombre d’observations. Les valeurs manquantes et celles qui dépassent une heure en avance ou en retard sont exclues. Chaque observation compte, y compris les mises à jour répétées d’un même trajet.',
			en: 'The sum of usable predicted deviations divided by their observation count. Missing values and deviations more than one hour early or late are excluded. Each observation counts, including repeated updates for the same trip.',
		},
		math: {
			fr: 'Moyenne = somme des delay_seconds connus dans [−3600, 3600] / nombre de ces observations. Les sommes et les comptes se cumulent sans arrondir les moyennes intermédiaires. Le résultat est converti en minutes, puis arrondi à une décimale, les demis s’éloignant de zéro. Aucun dénominateur utilisable, ou une heure contributrice inconnue dans le résumé quotidien, donne une valeur indisponible.',
			en: 'Mean = sum of known delay_seconds within [−3600, 3600] / count of those observations. Sums and counts are pooled without rounding intermediate means. The result is converted to minutes, then rounded to one decimal place with ties away from zero. An empty usable denominator, or an unknown contributing hour in the daily summary, gives an unavailable value.',
		},
		sql: `SELECT
    rd.provider_id,
    rd.route_id,
    (rd.period_start_utc AT TIME ZONE dp.timezone)::date AS local_date,
    CASE WHEN BOOL_AND(
        rd.usable_delay_observation_count IS NOT NULL
        AND (rd.usable_delay_observation_count = 0
             OR rd.usable_delay_sum_seconds IS NOT NULL)
    ) THEN SUM(rd.usable_delay_sum_seconds)::numeric
           / NULLIF(SUM(rd.usable_delay_observation_count), 0)
    END AS avg_delay_seconds
FROM gold.route_delay_hourly AS rd
JOIN gold.dim_provider AS dp ON dp.provider_id = rd.provider_id
GROUP BY rd.provider_id, rd.route_id, local_date;`,
		notReally: {
			fr: 'Cette moyenne décrit les prédictions observées. Elle ne mesure pas les arrivées réelles ni la durée d’un trajet. La médiane p50 décrit le milieu de la distribution des observations; un trajet signalé plus souvent pèse davantage dans les deux mesures.',
			en: 'This mean describes observed predictions. It does not measure actual arrivals or journey duration. The p50 median describes the middle of the observation distribution; a trip reported more often carries more weight in both measures.',
		},
		caveats: {
			fr: [
				'La moyenne est sensible aux valeurs extrêmes qui restent dans la plage admissible.',
				'Les résumés quotidiens suivent la date locale de capture et peuvent inclure une journée en cours. Les fenêtres plus longues utilisent les dates de leurs résumés conservés; leurs horloges diffèrent encore près de minuit.',
				'Une ancienne moyenne arrondie ne suffit pas à retrouver une somme exacte. Si une heure contributrice ne peut pas être reconstituée, la moyenne du jour reste indisponible.',
				'Le classement de la pire ligne est indisponible si la comparaison quotidienne contient une ligne admissible dont la moyenne est inconnue.',
				'Une valeur indisponible est distincte de zéro. L’absence de prédiction ne prouve pas le respect de l’horaire.',
				'La ponctualité utilise son propre dénominateur de retards connus, y compris ceux exclus de cette moyenne.',
			],
			en: [
				'The mean is sensitive to extreme values that remain within the accepted range.',
				'Daily summaries use the local capture date and can include the current partial day. Longer windows use retained summary dates; their reporting clocks still differ near midnight.',
				'An old rounded mean cannot recover an exact sum. If a contributing hour cannot be reconstructed, the daily mean remains unavailable.',
				'The worst-route ranking is unavailable when the daily comparison includes an eligible route with an unknown mean.',
				'Unavailable differs from zero. A missing prediction does not prove on-time service.',
				'On-time percentage uses its own known-delay denominator, including delays excluded from this mean.',
			],
		},
	},
	{
		key: 'p50p90',
		anchor: 'p50-p90',
		cluster: 'punctuality',
		family: 2,
		confidence: 'proxy',
		name: { fr: 'Retard médian et 90e percentile', en: 'Median and 90th-percentile delay' },
		sciName: 'p50_min · p90_min',
		oneLiner: {
			fr: 'La médiane situe le centre des retards prédits rapportés; le 90e percentile décrit leur partie haute. Il ne représente pas le retard maximal.',
			en: 'The median describes the centre of reported predicted delays; the 90th percentile describes their upper range. It is not the maximum delay.',
		},
		definition: {
			fr: 'Les valeurs quotidiennes sont des percentiles continus des prédictions au retard connu et compris entre −3 600 et +3 600 secondes, pour une même date locale de capture. Chaque observation compte; un même trajet peut contribuer plusieurs fois. Le calcul interpole entre les valeurs triées. Avec des égalités ou de petits échantillons, exactement 10 % des observations ne sont pas forcément supérieures au p90. Les estimations sur des fenêtres plus longues utilisent les histogrammes regroupés lorsqu’ils sont disponibles; une moyenne de percentiles quotidiens ne reconstitue pas le percentile de la fenêtre.',
			en: 'Daily values are continuous percentiles of known predicted delays between −3,600 and +3,600 seconds on one provider-local capture date. Each observation counts; one trip can contribute repeatedly. The calculation interpolates between sorted values. With ties or small samples, exactly 10% of observations need not exceed p90. Longer-window estimates use pooled histograms where available; averaging daily percentiles cannot reconstruct a window percentile.',
		},
		math: {
			fr: 'Pour n observations triées d[0]…d[n−1] et p = 0,5 ou 0,9 : h=(n−1)p, i=floor(h), f=h−i; Qp=d[i]+f·(d[min(i+1,n−1)]−d[i]). Le résumé quotidien stocke Qp à 0,01 seconde; l’affichage convertit en minutes. Les percentiles d’histogramme interpolent dans des classes et restent des estimations. Aucun échantillon admissible signifie une valeur absente.',
			en: 'For n sorted observations d[0]…d[n−1] and p = 0.5 or 0.9: h=(n−1)p, i=floor(h), f=h−i; Qp=d[i]+f·(d[min(i+1,n−1)]−d[i]). The daily summary stores Qp to 0.01 seconds; display converts to minutes. Histogram percentiles interpolate within bins and remain estimates. No eligible sample means an unavailable value.',
		},
		sql: `-- p50/p90 (DAY grain only), gold.route_delay_percentile_daily, computed per closed local day over raw facts:
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
			fr: 'Ces quantiles décrivent les prédictions collectées. Ils ne mesurent pas ce qu’un trajet ou un voyageur a vécu, ne prédisent pas un trajet particulier et ne constituent pas une garantie de retard maximal. Le p90 et la médiane doivent appartenir à la même population et à la même fenêtre pour être comparés.',
			en: 'These quantiles describe collected predictions. They do not measure an individual trip or passenger experience, predict a particular journey, or guarantee a maximum delay. A p90 and median must belong to the same population and window to be compared.',
		},
		caveats: {
			fr: [
				'Distinguer les percentiles quotidiens sur les observations, les estimations d’histogramme sur une fenêtre et les percentiles en direct des retards moyens par trajet.',
				'Les observations répétées ne sont pas des trajets ni des voyageurs indépendants. La fréquence des rapports influence leur poids.',
				'Le filtre |retard| ≤ 3 600 s définit la population; il ne certifie pas la justesse des prédictions restantes.',
				'Une valeur absente n’est pas zéro. La date, la couverture et la provenance indiquent le contexte; la politique de conservation est configurable.',
			],
			en: [
				'Distinguish daily observation percentiles, windowed histogram estimates, and live percentiles of current trip-average delays.',
				'Repeated reports are not independent trips or passengers. Reporting frequency affects their weight.',
				'The |delay| ≤ 3,600 s filter defines the population; it does not certify the accuracy of the remaining predictions.',
				'Unavailable is not zero. Date, coverage and provenance supply context; retention policy is configurable.',
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
			fr: 'La part des prédictions à plus de cinq minutes et au plus une heure de retard, parmi les observations de la vue affichée.',
			en: 'The share of predictions more than five minutes and at most one hour late, among the displayed view’s observations.',
		},
		definition: {
			fr: 'Un retard grave dépasse 300 secondes sans dépasser 3 600 secondes. Pour une ligne ou un bilan quotidien, le dénominateur comprend tous les relevés à retard connu, même ceux hors de la plage ±3 600 secondes. Pour les statistiques par arrêt, seuls les relevés dans cette plage comptent. Les classements des points chauds et des récidivistes utilisent aussi cette plage. Ces pourcentages décrivent des prédictions, pas des arrivées mesurées ni une part des voyageurs.',
			en: 'A severe delay exceeds 300 seconds and is no more than 3,600 seconds. For a route or daily receipt, the denominator includes every known-delay reading, including those outside ±3,600 seconds. Stop statistics count only readings within that range. Hotspot and repeat-offender rankings also use that range. These percentages describe predictions, not measured arrivals or a share of passengers.',
		},
		math: {
			fr: 'Part des retards graves = 100 × nombre de relevés dans (300, 3600] / nombre de relevés admissibles pour la vue. Les comptes sont additionnés avant la division; le résultat est arrondi à une décimale avec les demis s’éloignant de zéro. Exemple : avec des retards de 600 et 7 200 secondes, la part d’une ligne est 50 %, mais celle d’un arrêt est 100 %, car son dénominateur exclut le second relevé. Un dénominateur vide donne une valeur indisponible.',
			en: 'Severe-delay share = 100 × readings in (300, 3600] / readings eligible for the view. Counts are pooled before division; the result rounds to one decimal place with ties away from zero. For example, delays of 600 and 7,200 seconds give a route share of 50%, but a stop share of 100%, because its denominator excludes the second reading. An empty denominator gives an unavailable value.',
		},
		sql: `-- Route population: outliers remain in the denominator.
COUNT(delay_seconds) AS known,
COUNT(*) FILTER (
    WHERE delay_seconds > 300 AND delay_seconds <= 3600
) AS severe

-- Stop population: apply this filter before counting or summing.
WHERE delay_seconds IS NOT NULL AND ABS(delay_seconds) <= 3600

# Equivalent publication rounding (gold.reader.rates.severe_pct):
from decimal import Decimal, ROUND_HALF_UP

def severe_pct(observations, severe):
    if not observations or observations <= 0:
        return None
    pct = 100.0 * float(severe or 0) / float(observations)
    return float(Decimal(str(pct)).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP))`,
		notReally: {
			fr: 'Un taux de 8 % ne signifie pas que 8 % des voyages ou des autobus étaient gravement en retard. Un même voyage peut produire plusieurs relevés. Cette mesure ne compte pas les voyageurs touchés et ne vérifie pas les arrivées physiques.',
			en: 'An 8% share does not mean 8% of trips or buses were severely late. One trip can produce many readings. This measure does not count affected passengers or verify physical arrivals.',
		},
		caveats: {
			fr: [
				'300 secondes est exclu du numérateur; 3 600 secondes est inclus. Au-delà d’une heure, un relevé reste dans le dénominateur d’une ligne mais ne compte jamais comme retard grave.',
				'Les retards inconnus sont exclus. Pour les arrêts et les classements, les relevés hors de ±3 600 secondes sont aussi exclus du dénominateur; comparer ces populations demande donc de la prudence.',
				'Les comptes bruts se composent entre périodes; les pourcentages quotidiens ne sont pas moyennés.',
				'Zéro signifie aucun retard grave parmi les observations admissibles. Une valeur indisponible signifie que leur dénominateur est vide.',
				'La fréquence de signalement influence le résultat : plusieurs prédictions d’un même voyage comptent séparément.',
			],
			en: [
				'300 seconds is excluded from the numerator; 3,600 seconds is included. Beyond one hour, a reading remains in a route’s denominator but never counts as severe.',
				'Unknown delays are excluded. Stops and rankings also exclude readings outside ±3,600 seconds from their denominator, so comparisons across these populations require care.',
				'Raw counts combine across periods; daily percentages are not averaged.',
				'Zero means no severe delays among the eligible observations. An unavailable value means their denominator is empty.',
				'Reporting frequency influences the result: multiple predictions for one trip count separately.',
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
			fr: 'Les arrêts d’une ligne où les prédictions de retard sont les moins favorables, selon la période affichée.',
			en: 'Stops on a line with less favorable delay predictions, for the displayed period.',
		},
		definition: {
			fr: 'Dans la vue par période, le classement utilise la borne inférieure de Wilson de la part sans retard grave : une borne plus basse place l’arrêt plus haut. Les barres montrent la part des retards graves, pas le score de classement. Seuls les arrêts ayant au moins 30 observations admissibles sont retenus, avec au plus 15 arrêts par période. Si cette vue est indisponible, le résumé classe les arrêts par retard moyen sur les 30 dates locales se terminant au dernier jour clos disponible. Les deux calculs excluent les retards inconnus ou hors de [−3 600, 3 600] secondes.',
			en: 'In the period view, ranking uses the lower Wilson bound of the non-severe share: a lower bound places the stop higher. Bars show severe-delay share, not the ranking score. Only stops with at least 30 eligible observations qualify, with at most 15 stops per period. If this view is unavailable, the summary ranks stops by mean delay over the 30 local dates ending on the latest available closed day. Both calculations exclude unknown delays and values outside [−3,600, 3,600] seconds.',
		},
		math: {
			fr: 'Par période, n est le nombre de relevés admissibles et k = n − nombre de retards graves. La borne inférieure de Wilson pour k/n, avec z = 1,96, est classée en ordre croissant; les égalités sont départagées par retard moyen décroissant, puis identifiant d’arrêt. Le résumé utilise plutôt la moyenne non arrondie, somme des retards / n, puis l’identifiant. Les minutes publiées sont arrondies à une décimale avec les demis s’éloignant de zéro. Les comptes sont regroupés avant tout ratio.',
			en: 'For each period, n is the eligible reading count and k = n − severe-delay count. The lower Wilson bound for k/n, with z = 1.96, sorts ascending; ties break by mean delay descending, then stop ID. The summary instead uses the unrounded mean, sum of delays / n, then stop ID. Published minutes round to one decimal place with ties away from zero. Counts are pooled before any ratio.',
		},
		sql: `-- Summary window: latest closed stop-delay date minus 29 days through that date.
SELECT stop_id,
       SUM(observation_count) AS observations,
       SUM(sum_delay_seconds) AS total_delay_seconds,
       SUM(severe_delay_count) AS severe
FROM gold.stop_delay_spine
WHERE provider_id = :provider_id AND route_id = :route_id
  AND provider_local_date BETWEEN :win_start AND :win_end
GROUP BY stop_id;

# Period view: require observations >= 30.
# Sort by (wilson_lo(observations - severe, observations), -avg_delay_min, stop_id).
# Retain at most 15; bars show 100 * severe / observations.
# Wilson bounds use gold.reader.rates.wilson_lo/hi with z=1.96.

# Summary fallback: ignore empty groups.
mean_seconds = total_delay_seconds / observations
# Sort by (-mean_seconds, stop_id); the default publication cap is 100.
# Published minutes use gold.reader.rates.avg_delay_min (ties away from zero).`,
		notReally: {
			fr: 'Ce classement ne prédit pas votre prochain voyage et ne mesure pas les arrivées réelles. Une borne de Wilson basse peut aussi traduire un petit échantillon; elle ne prouve pas qu’un arrêt est systématiquement le pire.',
			en: 'This ranking does not predict your next trip or measure actual arrivals. A low Wilson bound can also reflect a small sample; it does not prove a stop is consistently the worst.',
		},
		caveats: {
			fr: [
				'La moyenne est pondérée par observations, pas par voyages ou voyageurs. Un voyage signalé plus souvent pèse davantage.',
				'La fenêtre de 30 dates peut contenir des jours sans données. Elle se termine au dernier jour disponible, qui peut être ancien si le flux est interrompu.',
				'Les retards hors de ±3 600 secondes sont exclus, même lorsqu’ils correspondent à un incident réel.',
				'Un arrêt sans observation admissible est absent du classement. Une liste courte n’est pas complétée artificiellement.',
				'Les prédictions répétées ne sont pas des essais indépendants. Les bornes de Wilson décrivent le calcul utilisé; leur couverture réelle de 95 % n’a pas été validée.',
			],
			en: [
				'The mean is weighted by observations, not trips or passengers. A trip reported more often carries more weight.',
				'The 30-date window can contain days without data. It ends on the latest available day, which may be old if reporting has stopped.',
				'Delays outside ±3,600 seconds are excluded, even when they reflect a real incident.',
				'A stop without eligible observations is absent from the ranking. Short lists are not padded.',
				'Repeated predictions are not independent trials. Wilson bounds describe the calculation used; their real-world 95% coverage has not been validated.',
			],
		},
	},
	{
		key: 'regularityCov',
		anchor: 'regularity',
		cluster: 'waitRegularity',
		family: 4,
		confidence: 'proxy',
		name: { fr: 'Régularité des intervalles (CV)', en: 'Headway regularity (CoV)' },
		sciName: 'headway_cov · bunched_pct',
		oneLiner: {
			fr: 'La variabilité des intervalles entre apparitions de trajets dans le flux. Le CV augmente avec l’irrégularité; la part d’apparitions rapprochées estime les écarts inférieurs à la moitié de la médiane.',
			en: 'Variation in the gaps between trips appearing in the feed. CoV rises with irregularity; the closely spaced share estimates gaps below half the median.',
		},
		definition: {
			fr: 'Ces mesures décrivent les premières captures admissibles de trajets, pas des arrivées mesurées à un arrêt. Le CV divise l’écart-type des intervalles par leur moyenne. La part d’apparitions rapprochées mesure les écarts inférieurs à la moitié de la médiane. Les vues par jour, semaine et mois regroupent les statistiques quotidiennes conservées; elles couvrent la direction comptant le plus de trajets de semaine dans chaque fenêtre.',
			en: 'These measures describe the first eligible feed captures of trips, not measured stop arrivals. CoV divides the sample standard deviation of gaps by their mean. The closely spaced share measures gaps below half the median. Day, week and month views pool retained daily statistics; they cover the direction with the most observed weekday trips in each window.',
		},
		math: {
			fr: 'Pour les fenêtres de 1, 7 et 30 jours : n = nombre d’écarts, S = somme des écarts en minutes, Q = somme de leurs carrés. CV = sqrt(max((Q − S²/n)/(n−1), 0)) / (S/n), arrondi à 4 décimales; valeur indisponible si n < 2 ou S ≤ 0. Cette formule utilise les moments conservés, pas l’histogramme. La part rapprochée est estimée dans l’histogramme regroupé sous T = 0,5 × médiane publiée, avec répartition uniforme dans le seau coupé par T, puis arrondie à une décimale.',
			en: 'For the 1-, 7- and 30-day windows: n is the gap count, S the sum of gap minutes, and Q the sum of squared gap minutes. CoV = sqrt(max((Q − S²/n)/(n−1), 0)) / (S/n), rounded to 4 decimals; unavailable if n < 2 or S ≤ 0. This uses the retained moments, not the histogram. The closely spaced share estimates pooled histogram mass below T = 0.5 × published median, assuming uniform values inside the bin crossed by T, then rounds to one decimal place.',
		},
		sql: `# Pool daily count and moments over the selected direction, shift and window.
mean = sum_gap / n if n else None
variance = max((sum_gap_sq - sum_gap**2 / n) / (n - 1), 0) if n >= 2 else None
cov = round_half_away(math.sqrt(variance) / mean, 4) if variance is not None and mean > 0 else None

# Bunching is re-estimated from pooled bins, never summed from daily bunched counts.
bunched = bunched_pct(pooled_gap_histogram, gap_edges, published_median)
bunched_pct_value = round_half_away(bunched, 1) if bunched is not None else None`,
		notReally: {
			fr: 'Une part rapprochée de 18 % ne signifie pas que 18 % des bus arrivent collés à votre arrêt. Les captures manquantes et les interruptions du flux peuvent modifier les écarts. Ni le CV ni cette part ne mesure la ponctualité, les passagers touchés ou les trajets annulés.',
			en: 'A closely spaced share of 18% does not mean 18% of buses arrive together at your stop. Missed captures and feed interruptions can change the gaps. Neither CoV nor this share measures on-time performance, affected passengers or cancelled trips.',
		},
		caveats: {
			fr: [
				'Les écarts proviennent de trajets avec retard prédit connu dans [−3 600, 3 600] secondes; seuls les écarts strictement dans (0, 240) minutes sont admissibles, dans une même direction, journée de service et période horaire.',
				'Les fenêtres se terminent au dernier jour clos disponible de la série et regroupent les données admissibles de semaine. La direction la plus représentée peut changer entre fenêtres.',
				'Le CV est recomposé à partir des moments; la médiane et la part rapprochée sont des estimations issues des histogrammes. Le même nombre d’écarts sert de dénominateur.',
				'Le résumé sans fenêtre reste une série distincte sur la fenêtre de conservation configurée des faits bruts, de 14 jours par défaut : médiane continue, écart-type d’échantillon et décompte direct des écarts inférieurs à la demi-médiane.',
				'CV = 0 décrit des écarts constants. CV indisponible signifie moins de deux écarts ou une moyenne non positive; la part rapprochée est indisponible sans écarts.',
			],
			en: [
				'Gaps come from trips with known predicted delays within [−3,600, 3,600] seconds; only gaps strictly within (0,240) minutes qualify, within one direction, service day and shift.',
				'Windows end on the series’ newest available closed day and pool eligible weekday data. The busiest observed direction can change between windows.',
				'CoV is reconstructed from moments; the median and closely spaced share are histogram estimates. The same gap count supplies their denominator.',
				'The non-windowed summary uses the configured raw-fact retention window, 14 days by default, with a continuous median, sample standard deviation and direct count of gaps below half the median.',
				'CoV = 0 describes constant gaps. Unavailable CoV means fewer than two gaps or a nonpositive mean; the closely spaced share is unavailable without gaps.',
			],
		},
	},
	{
		key: 'headway',
		anchor: 'headway',
		cluster: 'waitRegularity',
		family: 4,
		confidence: 'proxy',
		name: { fr: 'Intervalle dans le flux et prévu', en: 'Feed-appearance and scheduled headway' },
		sciName: 'observed_min · scheduled_min',
		oneLiner: {
			fr: 'L’intervalle médian entre les premières apparitions de trajets dans le flux, comparé aux départs prévus au premier arrêt. Il ne mesure pas votre attente à un arrêt.',
			en: 'The median gap between trips first appearing in the feed, compared with scheduled first-stop departures. It does not measure your wait at a stop.',
		},
		definition: {
			fr: 'On retient la première capture admissible de chaque trajet et journée de service : retard prédit connu et compris entre −3 600 et 3 600 secondes. Les écarts entre apparitions successives restent dans la même ligne, direction, journée de service et période horaire; seuls les écarts strictement positifs et inférieurs à 240 minutes sont retenus. Les vues par jour, semaine et mois estiment une médiane à partir des histogrammes quotidiens regroupés. Le repère prévu vient du GTFS actuel, sur une journée de semaine représentative.',
			en: 'Each trip and service day contributes its first eligible capture: a known predicted delay within −3,600 to 3,600 seconds. Gaps between successive appearances stay within the same route, direction, service day and shift; only gaps strictly above zero and below 240 minutes remain. The day, week and month views estimate a median from pooled daily histograms. The scheduled reference comes from the current GTFS timetable on a representative weekday.',
		},
		math: {
			fr: 'Vue par fenêtre : observed_min = médiane estimée par interpolation du cumul des histogrammes d’écarts, arrondie à une décimale. Les fenêtres de 1, 7 et 30 jours se terminent au dernier jour clos de cette série et ne contiennent que les écarts admissibles de semaine. La direction retenue maximise le nombre de trajets observés dans chaque fenêtre. Le résumé sans fenêtre utilise la médiane continue sur la fenêtre de conservation configurée des faits bruts, de 14 jours par défaut. scheduled_min = médiane des écarts entre minutes de départ distinctes au premier arrêt, par période, dans la direction avec le plus de départs du GTFS actuel.',
			en: 'Windowed view: observed_min is estimated by interpolating the pooled gap-histogram CDF and rounding to one decimal place. The 1-, 7- and 30-day windows end on this series’ newest closed day and include only eligible weekday gaps. The selected direction has the most observed trips in each window. The non-windowed summary uses a continuous median over the configured raw-fact retention window, 14 days by default. scheduled_min is the median gap between distinct first-stop departure minutes, per shift, in the direction with the most departures in the current timetable.',
		},
		sql: `# Windowed observations: pool histogram counts, then estimate one median.
observed_min = round_half_away(cdf_percentile(pooled_gap_histogram, 0.5, gap_edges), 1)

# Current scheduled reference: distinct first-stop departure minutes within one shift.
minutes = sorted(set(departure_minutes))
gaps = [right - left for left, right in zip(minutes, minutes[1:])]
scheduled_min = round_half_away(statistics.median(gaps), 1) if gaps else None`,
		notReally: {
			fr: 'Un intervalle de 12 minutes ne promet pas un bus toutes les 12 minutes à votre arrêt. Les apparitions dans le flux ne sont pas des départs ou arrivées mesurés. Des trajets absents, des captures manquantes ou une interruption du flux peuvent changer ces écarts. La différence entre les repères ne mesure pas l’attente excédentaire des usagers.',
			en: 'A 12-minute gap does not promise a bus every 12 minutes at your stop. Feed appearances are not measured departures or arrivals. Missing trips, missed captures or an interrupted feed can change these gaps. The difference between the two markers does not measure passengers’ excess wait.',
		},
		caveats: {
			fr: [
				'Les histogrammes quotidiens sont conservés et regroupés; les médianes de fenêtres sont des estimations, pas des moyennes de médianes quotidiennes.',
				'Les fenêtres principale et précédente peuvent retenir des directions différentes. Les écarts affichés décrivent les échantillons et ne prouvent pas une évolution pour les mêmes trajets.',
				'Le repère prévu utilise l’horaire actuel et sa propre direction la plus fournie; il ne reconstitue pas l’horaire de chaque journée historique.',
				'Les fenêtres regroupent les jours de capture admissibles de semaine et excluent le service de fin de semaine. Les résumés par direction et fin de semaine, quand présents, sont des séries distinctes.',
				'Sans écarts admissibles, la médiane est indisponible. L’absence de données reste distincte d’un intervalle observé de zéro.',
			],
			en: [
				'Daily histograms are retained and pooled; window medians are estimates, not averages of daily medians.',
				'Current and previous windows can select different directions. Displayed changes describe the samples and do not establish a change for the same trips.',
				'The scheduled reference uses the current timetable and its own busiest direction; it does not reconstruct the timetable for each historical day.',
				'Windowed data pool eligible weekday capture dates and exclude weekend service. Direction and weekend summaries, when present, are separate series.',
				'Without eligible gaps, the median is unavailable. Missing data remains distinct from an observed zero-minute gap.',
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
			fr: "Estimation d'attente excédentaire fondée sur les apparitions de trajets et des arrivées uniformes des usagers, ramenée à zéro au minimum.",
			en: 'Modeled extra wait from trip appearances, assuming uniform rider arrivals and clamped to zero.',
		},
		definition: {
			fr: "Pour une période de la fenêtre choisie, le modèle calcule AWT = somme(écart²) / (2·somme(écart)), puis retranche la moitié de l'intervalle prévu. Il suppose des arrivées uniformes pendant les écarts observés; aucune fréquentation réelle n'est utilisée. La carte résumée donne le même poids à chaque période rapportée. Cette moyenne de périodes n'est pas une attente calculée sur tous les écarts de la journée. Les anciennes lignes sans moments conservent le proxy max(0, médiane observée − médiane prévue).",
			en: 'For each shift in the selected window, the model calculates AWT = sum(gap²) / (2·sum(gap)), then subtracts half the scheduled gap. It assumes uniform rider arrivals over the observed gaps; actual passenger counts are not used. The summary card gives each reporting shift equal weight. That shift mean is not a wait pooled from all gaps across the day. Older rows without gap moments retain the proxy max(0, observed median − scheduled median).',
		},
		math: {
			fr: "Par période : excess_wait_min = round(max(0, somme(écart²)/(2·somme(écart)) − prévu/2), 1). Résumé : somme des valeurs publiées non nulles / nombre de périodes qui en portent. Deux périodes d'excès 0 et 7,5 min donnent 3,75 min, affiché 3,8 min, quels que soient leurs nombres d'observations. L'absence de valeur reste inconnue.",
			en: 'Per shift: excess_wait_min = round(max(0, sum(gap²)/(2·sum(gap)) − scheduled/2), 1). Summary: sum of non-null published values / number of reporting shifts. Shift values of 0 and 7.5 min average to 3.75 min, displayed as 3.8 min, regardless of observation counts. Missing values remain unknown.',
		},
		sql: `-- Windowed per-shift model, calculated during publication:
-- awt = sum_gap_sq_min / (2 * sum_gap_min)
-- excess = round(max(0.0, awt - scheduled / 2.0), 1)
-- Older scalar rows without moments: max(0.0, observed - scheduled)
-- scheduled = median gap of distinct first-stop departure minutes per shift`,
		notReally: {
			fr: "Ce modèle utilise les premières apparitions de trajets dans le flux. Il ne mesure ni les arrivées aux arrêts ni l'attente réelle des usagers. Un zéro signifie seulement que l'estimation ne dépasse pas la référence choisie; il ne prouve pas que le service a été assuré.",
			en: 'This model uses first trip appearances in the feed. It does not measure stop arrivals or actual passenger waits. Zero only means the estimate did not exceed the selected reference; it does not prove that scheduled service ran.',
		},
		caveats: {
			fr: [
				'Chaque fenêtre utilise la direction qui compte le plus de trajets observés. Cette direction et les trajets représentés peuvent changer entre les fenêtres.',
				"Les trajets jamais apparus n'ajoutent pas de longue attente au modèle. Le choix des premiers témoins, la fréquence des rapports et les bornes d'écart influencent l'échantillon.",
				"La moyenne résumée donne le même poids à chaque période disponible. Ni cette moyenne ni une pondération par le seul nombre d'écarts ne reconstituent une attente journalière groupée : il faudrait les sommes d'écarts et de leurs carrés.",
				"Les lignes sans moments utilisent un excès d'intervalle médian, distinct du modèle d'attente. Valeur absente si l'intervalle prévu ou les données nécessaires manquent.",
			],
			en: [
				'Each window uses the direction with the most observed trips. That direction and the represented trips can change between windows.',
				'Trips that never appear do not add a long wait to the model. First-witness selection, reporting frequency and gap bounds affect the sample.',
				'The summary gives every available shift equal weight. Neither that average nor weighting by gap counts alone reconstructs a pooled daily wait: that requires gap sums and squared-gap sums.',
				'Rows without gap moments use median-gap excess, a different quantity from modeled wait. Missing schedule or required observations leave the value unknown.',
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
			fr: "Des trajets que le flux temps réel a RAPPORTÉS pour une ligne ce jour-là, la part qu'il a marqués annulés, pas la part de l'horaire complet (les trajets jamais mentionnés ne comptent pas).",
			en: 'Of the trips the realtime feed actually REPORTED for a route that day, the share it flagged canceled, not the share of the full timetable (trips the feed never mentions are not counted).',
		},
		definition: {
			fr: "Des trajets que le flux temps réel a réellement rapportés pour une ligne un jour donné, la part que le flux a marqués annulés. Un « jour-trajet » regroupe les observations ayant le même identifiant de trajet et la même date de service; s’il est signalé annulé au moins une fois, il compte comme annulé. Donc « 3,2 % » signifie : sur 100 trajets dont le flux nous a parlé ce jour-là, environ 3 ont été annulés. C'est la part des trajets RAPPORTÉS annulés, pas la part de l'horaire publié complet, car les trajets jamais mentionnés ne sont pas dans le compte.",
			en: 'Of the trips the realtime feed actually reported for a route on a given day, the share that the feed flagged as canceled. A “trip-day” groups observations with the same trip ID and service date; if the feed ever marked that run CANCELED at any point that day, it counts as canceled. So “3.2%” means: out of every 100 trips the feed told us about that day, about 3 were called off. It is the share of REPORTED trips that were canceled, not the share of the full published timetable, because trips the feed never mentions are not in the count at all.',
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
			fr: "Un usager confond ça avec « le pourcentage de TOUS les trajets programmés de cette ligne qui ont été annulés ». Ce n'est pas ça. Le dénominateur n'est que les trajets que le flux a rapportés, les trajets discrètement abandonnés sans étiquette ANNULÉ lui sont invisibles, donc le vrai taux d'annulation de l'horaire peut être plus élevé. C'est un proxy rapporté par le flux, pas une figure de complétude de service certifiée.",
			en: 'A citizen is most likely to misread this as “the percentage of all scheduled trips on this route that were canceled.” It is NOT that. The denominator is only the trips the realtime feed reported, trips the feed silently dropped without a CANCELED tag are invisible to it, so the true timetable cancellation rate can be higher. It is a feed-reported proxy, not a certified service-completeness figure.',
		},
		caveats: {
			fr: [
				serviceComparisonCopy.fr.explanation,
				"PROXY, pas certifié : c'est la part des trajets RAPPORTÉS par le flux GTFS-RT marqués ANNULÉS (schedule_relationship = 3). Pas une statistique certifiée par l'agence. Aucun AVL, aucune réconciliation programmé-vs-opéré.",
				"DÉNOMINATEUR = TRAJETS RAPPORTÉS, PAS L'HORAIRE : total_trip_days ne compte que les jours-trajets que le flux a mentionnés. Un trajet discrètement abandonné n'est PAS compté comme annulé. Le taux de l'horaire publié pourrait être plus élevé.",
				'NULL-comme-non-annulé : le GTFS-RT omet schedule_relationship pour les trajets ordinaires; le silver stocke NULL; le SQL le COALESCE à 0 pour les garder au dénominateur comme non-annulés.',
				"JOUR-TRAJET = (trip_id, start_date) distinct, replié par MAX sur les sondages : un trajet vu plusieurs fois compte UNE fois; annulé s'il fut JAMAIS vu annulé (collant, biais vers l'annulation).",
				'NULL vs 0 : cancellation_rate_pct est NULL (jamais un 0 % fabriqué) quand total_trip_days = 0. Un blackout du flux affiche « aucune donnée », pas 0 % annulé.',
				"SENTINELLES EXCLUES : route_id IS NULL est filtré à la source, donc __unrouted__ n'atteint jamais la surface d'annulation.",
				'SIGNAUX MORTS non utilisés : trajets ADDED, occupancy_percentage, congestion_level, delay natif ne jouent aucun rôle.',
				'TAUX RÉSEAU PONDÉRÉ PAR COMPTE, pas une moyenne des taux par ligne : network_trend re-dérive 100 × SUM(canceled)/SUM(total).',
			],
			en: [
				serviceComparisonCopy.en.explanation,
				'PROXY, NOT certified: this is the share of trips the GTFS-RT feed REPORTED that were flagged CANCELED (schedule_relationship=3). It is not an agency-certified statistic. There is no AVL and no scheduled-vs-operated reconciliation.',
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
			fr: "La part des messages de prédiction d'arrêt qui portaient un drapeau « cet arrêt sera sauté », un drapeau déclaré par le flux, pas un dépassement physique vérifié.",
			en: 'The share of stop-prediction messages that carried a “this stop will be skipped” flag, a feed-declared flag, not a verified physical pass-by.',
		},
		definition: {
			fr: "Pour une ligne un jour clos, c'est la part des prédictions d'arrêt que le flux en direct a envoyées qui étaient marquées « cet arrêt sera sauté ». Autrement dit : sur toutes les mises à jour d'arrêt à venir diffusées ce jour-là, quel pourcentage disait « on ne s'arrête pas ici ». Un chiffre plus élevé = plus d'avis de saut. Mesuré par ligne, par jour local clos, et il n'a commencé à s'accumuler qu'à partir du jour de lancement, aucun historique rétroactif.",
			en: 'For one bus route on one finished calendar day, this is the share of the stop predictions the agency’s live feed sent out that were flagged “this stop will be skipped.” Think of it as: out of all the upcoming-stop updates the route’s vehicles broadcast that day, what percentage said “we’re not stopping here.” A higher number means riders saw more “skip” notices. It is measured per route, per closed local day, and only started accumulating from the day the feature shipped, there is no backfilled history.',
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

-- gold/marts.py fact ETL, where the carried counts originate:
count(*)::integer AS stop_time_update_count,
-- GTFS-RT StopTimeUpdate.ScheduleRelationship SKIPPED = 1 (stop-level,
-- distinct from the trip-level CANCELED = 3); NULL = SCHEDULED.
count(*) FILTER (WHERE stc.schedule_relationship = 1)::integer
    AS skipped_stop_count`,
		notReally: {
			fr: "Un usager lira ça comme « X % des bus de cette ligne ont sauté un arrêt / brûlé mon arrêt aujourd'hui ». Ce n'est pas ça. C'est la part des messages de prédiction d'arrêt en direct portant un drapeau SKIPPED, une prédiction déclarée par le flux, pas un dépassement physique vérifié, et comptée sur des messages de mise à jour (un arrêt achalandé en génère beaucoup), pas sur des usagers, trajets ou montées.",
			en: 'A citizen is most likely to read this as “X% of this route’s buses skipped a stop / blew past my stop today.” It is NOT that. It is the share of the route’s live stop-prediction messages that carried a SKIPPED flag, a feed-declared prediction, not a verified physical pass-by, and counted over stop-update messages (a busy stop generates many updates), not over riders, trips, or boardings.',
		},
		caveats: {
			fr: [
				"PROXY, pas vérifié : c'est le drapeau SKIPPED du GTFS-RT (StopTimeUpdate.ScheduleRelationship = 1), un saut prédit/déclaré dans le flux, PAS un dépassement confirmé. Aucune vérité AVL.",
				"Le dénominateur est TOUTES les mises à jour d'arrêt observées, y compris à relation NULL (NULL = SCHEDULED et reste au dénominateur). Délibérément non filtré sur schedule_relationship.",
				"RAMP-IN / aucun rétroactif : l'historique s'accumule en AVANT seulement depuis le lancement (migration 0050, 2026-06-18). La table silver de ~738 M de rangées n'a PAS été scannée historiquement; les jours antérieurs sont simplement absents, pas zéro.",
				'NULL : skipped_stop_rate_pct est NULL (garde NULLIF) quand une ligne a zéro mise à jour observée ce jour-là; jamais 0 %. Ne pas imputer 0.',
				"Append-only : un jour déjà filigrané n'est jamais recalculé, donc le taux d'un jour passé est gelé.",
				'Grain jour local (fuseau du fournisseur); les jours de transition DST ont 23 h/25 h mais restent un seul seau de date locale; les jours partiels au lancement ont des dénominateurs minces.',
				"DISTINCT des annulations de trajet : SKIPPED = 1 est au niveau de l'arrêt; CANCELED = 3 (niveau trajet) est le taux d'annulation séparé. Ne pas confondre.",
				'SIGNAUX MORTS DU FLUX non utilisés : occupancy_percentage, congestion_level, delay natif, trajets ADDED.',
			],
			en: [
				'PROXY, not verified: this is the agency’s own GTFS-RT SKIPPED flag (StopTimeUpdate.ScheduleRelationship=1), a predicted/declared skip in the live feed, NOT a confirmed pass-by. There is no AVL ground truth.',
				'Denominator is ALL observed stop-time updates, including those with a NULL relationship (NULL = SCHEDULED and stays in the denominator). Deliberately NOT filtered on schedule_relationship.',
				'RAMP-IN / no backfill: history accrues FORWARD only from launch (migration 0050, 2026-06-18). The ~738M-row silver table was NOT scanned historically; earlier days are simply absent, not zero.',
				'NULL handling: skipped_stop_rate_pct is NULL (NULLIF guard) when a route had zero observed updates that day; never 0%. Do not impute 0.',
				'Append-only: a day already watermarked is never recomputed, so the rate for a past day is frozen as built.',
				'Day grain is provider-local; DST transition days have 23h/25h but are still a single local date bucket; partial first/last days at launch have thin denominators.',
				'Distinct from trip-level cancellations: SKIPPED=1 is stop-level; CANCELED=3 (trip-level) is the separate cancellation_rate metric. Do not conflate.',
				'DEAD FEED signals are NOT used: occupancy_percentage, congestion_level, native delay, ADDED trips.',
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
			fr: 'Écart entre premières apparitions de trajets',
			en: 'Span of trip first appearances',
		},
		sciName: 'service_span_min · first/last_trip_delay_min',
		oneLiner: {
			fr: 'L’écart entre la plus précoce et la plus tardive des premières captures de trajets d’une ligne pour un jour de service GTFS. Il ne prouve ni des départs réels ni une période de fonctionnement continu.',
			en: 'The gap between the earliest and latest first captured reports of a route’s trips for one GTFS service day. It establishes neither real departures nor continuous operation.',
		},
		definition: {
			fr: 'Pour chaque identifiant de trajet du jour de service D, on conserve sa première capture trouvée dans les jours de capture D et D+1. Les extrémités sont la plus précoce et la plus tardive de ces premières captures. Le compte indique les identifiants de trajet distincts présents dans cette fenêtre. Le retard du premier trajet vient de son premier relevé; celui du dernier trajet vient de son dernier relevé dans la fenêtre. Ce dernier relevé peut être postérieur à l’extrémité droite et n’est pas nécessairement une arrivée au terminus.',
			en: 'For each trip ID with GTFS service date D, we retain its earliest capture found on capture dates D and D+1. The endpoints are the earliest and latest of those first captures. The count is the number of distinct trip IDs present in that window. The first trip’s delay comes from its earliest report; the last trip’s delay comes from its latest report in the window. That latest report can be later than the right endpoint and need not be a terminal arrival.',
		},
		math: {
			fr: 'Regroupement : fournisseur, ligne et start_date GTFS. Pour chaque trip_id, t = min(captured_at_utc) dans D/D+1. Extrémités : min(t) et max(t). service_span_min = round((max(t) − min(t)) / 60 secondes) en minutes entières. Le graphique utilise l’écart exact des instants UTC, y compris les secondes; ses graduations +h indiquent le temps écoulé. Les dates, heures et décalages UTC affichés sont locaux au fournisseur. Les retards signés se convertissent de secondes en minutes, arrondies à une décimale.',
			en: 'Group by provider, route and GTFS start_date. For each trip_id, t = min(captured_at_utc) inside D/D+1. Endpoints are min(t) and max(t). service_span_min = round((max(t) − min(t)) / 60 seconds) in whole minutes. The chart uses the exact UTC elapsed interval, including seconds; its +hour ticks show elapsed time. Displayed dates, clocks and UTC offsets use the provider timezone. Signed delays convert seconds to minutes rounded to one decimal place.',
		},
		sql: `-- service_date = the just-completed GTFS service day = :local_date - 1; read a 2-day
-- INDEXED window {date_key(service_date), date_key(:local_date)} capture dates only; later reports are outside this window.
WITH trip_starts AS (
    SELECT f.provider_id, f.route_id, f.trip_id,
           MIN(f.captured_at_utc) AS trip_start_utc,
           (ARRAY_AGG(f.delay_seconds ORDER BY f.captured_at_utc ASC, f.entity_index ASC))[1]  AS first_obs_delay,
           (ARRAY_AGG(f.delay_seconds ORDER BY f.captured_at_utc DESC, f.entity_index DESC))[1] AS last_obs_delay
    FROM gold.fact_trip_delay_snapshot AS f
    WHERE f.provider_id = :provider_id AND f.route_id IS NOT NULL AND f.trip_id IS NOT NULL
      AND f.snapshot_date_key IN (
          to_char((CAST(:local_date AS date) - 1), 'YYYYMMDD')::integer, :date_key)
      AND f.start_date = (CAST(:local_date AS date) - 1)   -- bucket by GTFS service day, not capture day
    GROUP BY f.provider_id, f.route_id, f.trip_id
),
ranked AS (
    SELECT provider_id, route_id, trip_start_utc, first_obs_delay, last_obs_delay,
           ROW_NUMBER() OVER (PARTITION BY provider_id, route_id ORDER BY trip_start_utc ASC, first_obs_delay ASC) AS rn_first,
           ROW_NUMBER() OVER (PARTITION BY provider_id, route_id ORDER BY trip_start_utc DESC, first_obs_delay ASC) AS rn_last
    FROM trip_starts
)
SELECT provider_id, (CAST(:local_date AS date) - 1), route_id,
       MIN(trip_start_utc), MAX(trip_start_utc),
       ROUND(EXTRACT(EPOCH FROM (MAX(trip_start_utc) - MIN(trip_start_utc))) / 60.0)::integer,
       MAX(first_obs_delay) FILTER (WHERE rn_first = 1),   -- first trip: its first-obs delay
       MAX(last_obs_delay)  FILTER (WHERE rn_last  = 1),   -- last trip: its latest captured-report delay
       COUNT(*)::integer, :built_at_utc
FROM ranked
GROUP BY provider_id, route_id`,
		notReally: {
			fr: 'Ce n’est ni une plage horaire officielle, ni une mesure du temps passé en circulation, ni un plancher garanti des heures d’exploitation. Une absence de captures n’établit pas une absence de service; des rapports tardifs peuvent décaler les extrémités. Les retards décrivent des prévisions reçues, pas des départs ou arrivées mesurés.',
			en: 'This is neither an official timetable, a measure of time spent operating, nor a guaranteed lower bound on operating hours. Missing captures do not establish missing service; delayed reports can shift the endpoints. Delay readings describe received predictions, not measured departures or arrivals.',
		},
		caveats: {
			fr: [
				'La fenêtre est limitée aux dates de capture D et D+1 pour start_date = D. Des rapports plus tardifs ou sans start_date ne sont pas inclus; la couverture d’un trajet de nuit prolongé n’est pas garantie.',
				'Les deux extrémités sont des premières captures de trajets différents ou du même trajet. L’extrémité droite n’est pas le dernier rapport reçu de la journée.',
				'Le dernier retard affiché vient du dernier relevé du dernier trajet identifié, à un instant potentiellement différent de l’extrémité droite; il ne certifie pas le retard à l’arrivée.',
				'Le compte porte sur des identifiants de trajet groupés, pas sur des trajets achevés ni des voyageurs. Un seul identifiant, ou plusieurs premières captures simultanées, donne un écart nul.',
				'Une durée nulle est un point sur le graphique. Une durée positive conserve sa largeur proportionnelle, même si l’annotation arrondie vaut zéro minute. Des retards peuvent être indisponibles alors que les extrémités et le compte sont connus.',
				'Le calcul UTC préserve la durée lors des changements d’heure; les dates et décalages locaux distinguent les jours et les heures répétées. L’axe part de zéro et s’étend au-delà de 24 heures si nécessaire.',
			],
			en: [
				'The window is limited to capture dates D and D+1 with start_date = D. Later reports and reports without start_date are excluded; complete coverage of extended overnight trips is not guaranteed.',
				'Both endpoints are first captures of different trips or the same trip. The right endpoint is not the day’s latest received report.',
				'The final delay reading is the latest report of the last appearing trip, potentially after the right endpoint; it does not establish arrival delay.',
				'The count covers grouped trip IDs, not completed journeys or passengers. One ID, or several simultaneous first captures, gives a zero span.',
				'Zero duration draws a point. Positive durations retain proportional width even if the rounded annotation says zero minutes. Delays can be unavailable while endpoints and counts remain known.',
				'UTC arithmetic preserves elapsed time through clock changes; local dates and offsets distinguish days and repeated hours. The axis starts at zero and extends beyond 24 hours when needed.',
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
			fr: "La part des relevés de véhicules dans chacun des cinq paliers d'achalandage (vide, plusieurs places, peu de places, debout, plein), la part des bus-moments rapportés, PAS « % plein » ni « % d'usagers debout ».",
			en: 'The share of vehicle reports in each of five crowding levels (empty, many seats, few seats, standing, full), the share of reported bus-moments, NOT “% full” or “% of riders standing.”',
		},
		definition: {
			fr: "À quel point les bus sont pleins, exprimé comme la part des relevés de véhicules tombés dans chacun des cinq paliers : vide, plusieurs places libres, peu de places libres, debout, plein. C'est bâti uniquement sur le « niveau » d'achalandage que les véhicules diffusent en direct (une catégorie comme « debout »), pas sur un décompte de têtes ni un pourcentage-plein. Donc « debout = 0,32 » signifie « 32 % des relevés de véhicules ayant rapporté un niveau disaient debout », PAS « 32 % plein » et PAS « 32 % des usagers debout ». Les niveaux sont rapportés par relevé, donc les lignes achalandées (plus de véhicules, plus de relevés) contribuent davantage.",
			en: 'How full the buses are, expressed as the share of vehicle reports that fell into each of five crowding levels: empty, many seats free, few seats free, standing room only, and full. It is built only from the crowding “level” that vehicles broadcast over the live feed (a category like “standing-room-only”), not from any head-count or percentage-full number. So a value like “standing = 0.32” means “32% of the vehicle pings that reported a crowding level said standing-room-only”, it is NOT “32% full” and NOT “32% of riders were standing.” Levels are reported per vehicle ping, so busy routes contribute more pings.',
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
			fr: "Ce n'est PAS « à quel point le bus est plein en pourcentage » ni « quelle fraction des usagers était debout ». « debout = 0,32 » signifie que 32 % des relevés de véhicules portant un niveau étaient marqués debout, la part des bus-moments rapportés à ce niveau, un mélange de catégories pondéré par observations, pas un facteur de charge, pas un décompte de têtes, pas une statistique par trajet ou par usager. Les heures de bus vides la nuit peuvent dominer la part « vide » même sur une ligne bondée à l'heure de pointe.",
			en: 'It is NOT “how full the bus is in percent” and NOT “what fraction of riders were standing.” A reading of standing=0.32 means 32% of the vehicle reports that carried a crowding level were tagged standing-room-only, the share of reported bus-moments at that level, an observation-weighted category mix, not a load factor, not a headcount, and not a per-trip or per-rider statistic. Empty bus-hours at night can dominate the “empty” share even on a route that is packed at rush hour.',
		},
		caveats: {
			fr: [
				'PROXY, pas un facteur de charge : les paliers sont des catégories GTFS-RT OccupancyStatus auto-rapportées; AUCUN pourcentage-plein numérique. occupancy_percentage est un signal MORT du flux, jamais lu; congestion_level et delay natif aussi morts et exclus.',
				'DÉNOMINATEUR = RELEVÉS portant un palier, pas véhicules/trajets/usagers. Pondéré par observations : un véhicule qui rapporte plus souvent contribue plus.',
				"Les codes 3 (STANDING_ROOM_ONLY) et 4 (CRUSHED) sont REPLIÉS en un seul palier « debout », donc la « charge écrasante » n'est pas distinguable du debout ordinaire.",
				'Les codes 6/7/8 (NOT_ACCEPTING / NO_DATA / NOT_BOARDABLE) et occupancy_status NULL sont exclus du numérateur ET du dénominateur.',
				'Honnête-None : sans aucun relevé portant un palier, le mélange entier est null (slice-9.1.1y), jamais un objet tout-à-zéro. Les consommateurs doivent afficher « aucune donnée », pas 0 %.',
				'Borne de jour locale (DST-correcte). Sentinelles : les véhicules sans route_id roulent en __unrouted__; la fenêtre 30 j par ligne filtre une vraie route_id.',
				'Couverture dépendante du flux : occupancy_status ~99,84 % peuplé (pas 100 %), append-only sans rétroactif au-delà de la fenêtre de faits retenue.',
				'Live vs historique sont des populations différentes; les modes sans temps réel dans le flux en sont structurellement absents.',
			],
			en: [
				'PROXY, not a load factor: bands are GTFS-RT OccupancyStatus categories that vehicles self-report; there is NO numeric percent-full. occupancy_percentage is a DEAD feed signal and is never read; congestion_level and native delay are likewise dead and excluded.',
				'DENOMINATOR is band-bearing PINGS, not vehicles/trips/riders. Observation-weighted: a vehicle that reports more snapshots contributes more.',
				'Codes 3 (STANDING_ROOM_ONLY) and 4 (CRUSHED) are FOLDED into a single “standing” band, so crush load is not distinguishable from ordinary standing.',
				'Codes 6/7/8 (NOT_ACCEPTING / NO_DATA / NOT_BOARDABLE) and NULL occupancy_status are excluded from BOTH numerator and denominator.',
				'Honest-None: with zero band-bearing pings the entire mix is null (slice-9.1.1y), never an all-zero object. Consumers must render “no data”, not 0%.',
				'Day boundary is provider-local (DST-correct). Sentinels: vehicles with no route_id roll into __unrouted__; the per-route 30d window filters to a real route_id.',
				'Coverage is feed-dependent: occupancy_status is ~99.84% populated (not 100%), append-only with no backfill beyond the retained fact window.',
				'Live vs historic are different populations; modes with no realtime in the feed are structurally absent, so this is effectively a surface(bus)-crowding picture.',
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
		name: { fr: 'Scores horaires relatifs (7×24)', en: 'Relative hourly scores (7×24)' },
		sciName: 'habits.matrix · repeat_problem_relative · severe_relative',
		oneLiner: {
			fr: 'Un score relatif par jour et heure au sein d’une ligne ou d’un arrêt. 1 désigne son plus grand score fourni, 0 un score fourni nul; une case vide est indisponible. Ce score ne mesure pas une probabilité de retard et ne compare pas les entités.',
			en: 'A relative score for each weekday and hour within one line or stop. 1 is its highest supplied score, 0 a supplied zero score; a blank cell is unavailable. The score measures neither delay probability nor differences between entities.',
		},
		definition: {
			fr: 'Chaque grille utilise un seul maximum pour ses 7 jours et 24 heures. Les scores de ligne combinent un compte de relevés de retard grave et un retard moyen positif. Les scores d’arrêt utilisent seulement le compte de relevés de retard grave. Les quatre couleurs divisent l’échelle relative en [0; 0,25[, [0,25; 0,5[, [0,5; 0,75[ et [0,75; 1]. Le contour et le symbole ◆ marquent toute la dernière bande, y compris les valeurs inférieures au maximum. Une couleur pâle exprime un score relatif faible, sans prouver une faible fréquence de retard.',
			en: 'Each grid uses one maximum across its 7 days and 24 hours. Line scores combine a severe-delay reading count and a positive mean delay. Stop scores use only the severe-delay reading count. The four colors divide the relative scale into [0,0.25), [0.25,0.5), [0.5,0.75) and [0.75,1]. The outline and ◆ mark the entire highest band, including values below the maximum. A pale color expresses a low relative score without establishing a low delay frequency.',
		},
		math: {
			fr: 'Ligne : raw_score = min(round(severe_count × 10 + max(mean_delay_seconds, 0) / 60, 4), 9999.9999). La moyenne regroupe les sommes de retard et les comptes des histogrammes admissibles, en excluant les relevés hors de ±3 600 secondes, puis s’arrondit à 2 décimales. Arrêt : raw_score = somme des relevés de retard grave, sans terme de moyenne ni facteur ×10. Pour chaque entité, score publié = round(raw_score / maximum, 4), où le maximum porte sur toutes ses cellules fournies; si le maximum vaut zéro, les scores fournis restent zéro. Les valeurs indisponibles restent null. Les arrondis déplacent les demis à l’écart de zéro.',
			en: 'Line: raw_score = min(round(severe_count × 10 + max(mean_delay_seconds, 0) / 60, 4), 9999.9999). The mean pools delay sums and eligible histogram counts, excluding readings outside ±3,600 seconds, then rounds to 2 decimals. Stop: raw_score is the summed severe-delay reading count, with no mean term or ×10 factor. For each entity, published score = round(raw_score / maximum, 4), where the maximum spans all supplied cells; if it is zero, supplied scores remain zero. Unavailable values stay null. Rounding moves exact ties away from zero.',
		},
		sql: `-- ROUTE_HABIT_SPINE_SQL (gold/reader/projector.py), reconciled S14 2026-07-02: ONE reader-owned
-- formula (gold/reader/score.py REPEAT_PROBLEM_SCORE_EXPR) over gold.route_delay_spine. The old
-- gold.route_habit_score mart was DROPPED (migration 0076); the scalar 7x24 matrix runs this SQL
-- with an all-time window [1970-01-01 .. spine anchor], the by-grain matrices run the SAME SQL
-- with trailing day/week/month windows.
SELECT
    EXTRACT(ISODOW FROM provider_local_date)::integer AS day_of_week_iso,
    hour_of_day_local,
    SUM(delay_observation_count)::bigint AS known_obs,
    LEAST(
        ROUND(
            SUM(severe_delay_count)::numeric * 10
            + GREATEST(COALESCE(ROUND(
                SUM(sum_delay_seconds)::numeric
                / NULLIF(SUM((SELECT COALESCE(SUM(x), 0) FROM unnest(delay_histogram) AS x)), 0),
                2), 0), 0) / 60,
            4),
        9999.9999) AS repeat_problem_score   -- overflow guard, not a real magnitude
FROM gold.route_delay_spine
WHERE provider_id = :provider_id AND route_id = :route_id
  AND provider_local_date >= :win_start AND provider_local_date <= :win_end
GROUP BY 1, 2

-- Per-route [0,1] normalization at publish time (_helpers.py _build_habits_matrix):
-- observed = [v for v in cells if v is not None]; route_max = max(observed) or 0.0
-- cell = None if v is None else (round_half_away(v / route_max, 4) if route_max > 0 else 0.0)`,
		notReally: {
			fr: 'Un score de 1 ne prédit pas le retard d’un futur trajet et ne désigne pas le pire arrêt ou la pire ligne du réseau. Un score de 0 ne prouve pas que ce créneau est toujours calme; il indique seulement que le score fourni est nul. Une case indisponible ne prouve pas l’absence de service.',
			en: 'A score of 1 does not predict a future trip’s delay or identify the network’s worst stop or line. A score of 0 does not establish that a slot is consistently calm; it only means the supplied score is zero. An unavailable cell does not establish that no service ran.',
		},
		caveats: {
			fr: [
				'Les relevés sont des prédictions GTFS-RT, pas des arrivées mesurées ni des passagers comptés. Les relevés répétés d’un même trajet comptent séparément.',
				'Le volume de service et la fréquence des signalements peuvent augmenter les comptes et les scores. Sans dénominateur d’exposition, ce score n’est pas une fréquence ni une probabilité de retard.',
				'La normalisation est propre à chaque entité et au jeu de cellules fourni. Les mêmes couleurs de deux lignes ou arrêts ne donnent pas un classement de fiabilité.',
				'Le plafond de ligne à 9999.9999 protège le stockage et peut égaliser des scores élevés. La bande ◆ commence à 0,75; elle ne désigne pas seulement les cellules exactement maximales.',
				'Zéro reste distinct de null : zéro est un score fourni nul; null signifie qu’aucun score utilisable n’est fourni, quelle qu’en soit la raison.',
				'Les changements d’heure peuvent modifier la durée couverte par une case locale. L’heure répétée d’automne regroupe les deux occurrences; une heure sautée n’existe pas le jour de la transition.',
				'La carte de ligne affichée utilise son historique disponible conservé; les variantes par fenêtre publiées utilisent la même formule. La carte d’arrêt utilise ses agrégats horaires disponibles, dont la couverture peut différer.',
			],
			en: [
				'Readings are GTFS-RT predictions, not measured arrivals or passenger counts. Repeated readings of one trip count separately.',
				'Service volume and reporting frequency can increase counts and scores. Without an exposure denominator, this score is neither a delay frequency nor a delay probability.',
				'Normalization belongs to each entity and its supplied cells. Identical colors on different lines or stops do not rank their reliability.',
				'The line-score cap of 9999.9999 protects storage and can make high scores equal. The ◆ band starts at 0.75; it does not identify only exact maximum cells.',
				'Zero stays distinct from null: zero is a supplied zero score; null means no usable score was supplied, whatever the reason.',
				'Clock changes can alter a local cell’s elapsed coverage. The repeated autumn hour combines both occurrences; a skipped hour does not occur on its transition day.',
				'The displayed line grid uses its available retained history; published window variants use the same formula. The stop grid uses its available hourly aggregates, whose coverage can differ.',
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
			fr: 'Regroupe les relevés par jour de la semaine (lun-dim, heure locale) et montre par jour le retard moyen et la part de retards graves, sur TOUT l’historique accumulé du spine (rétention 730 jours), donc un motif de long terme, pas les derniers jours.',
			en: 'Groups readings by weekday (Mon–Sun, local time) and shows, per weekday, the average lateness and severe-delay share over the route’s WHOLE accrued spine history (730-day retention), so a long-run pattern, not just the last few days.',
		},
		definition: {
			fr: "Pour une ligne, ceci regroupe chaque relevé d'écart à l'horaire par le jour de la semaine où il s'est produit (lundi à dimanche, heure locale) et montre, pour chaque jour : la lateur moyenne en minutes, et la part des relevés « gravement en retard » (plus de 5 minutes derrière). Ça répond à « cette ligne est-elle fiablement pire le vendredi que le mardi ? » C'est calculé à la lecture depuis gold.route_delay_spine, sur TOUT l'historique accumulé du spine (rétention 730 jours, réconcilié S14 2026-07-02), donc un vrai motif hebdomadaire de long terme, pas un instantané des derniers jours.",
			en: 'For one route, this groups every schedule-deviation reading the feed gave us by which day of the week it happened on (Monday through Sunday, in local time) and shows, for each weekday: the average lateness in minutes, and the share of readings that were “severely late” (more than 5 minutes behind). It answers “is this route reliably worse on, say, Fridays than on Tuesdays?” It is computed at read time from gold.route_delay_spine over the route’s WHOLE accrued spine history (730-day retention, reconciled S14 2026-07-02), so it is a genuine long-run weekday pattern, not a snapshot of the last few days.',
		},
		math: {
			fr: 'Par ligne r et jour ISO d (1=lun..7=dim), sur tout le spine : known_obs = SUM(delay_observation_count) [retard connu]; severe = SUM(severe_delay_count) [delay > 300 s, |delay| ≤ 3600]; in_clamp = SUM des 21 seaux de l’histogramme (compte hors-fantôme). avg_delay_sec = SUM(sum_delay_seconds) / in_clamp [MOYENNE POOLÉE en-clamp, pas une moyenne de moyennes]. Publié (côté Python, arrondi demi-loin-de-zéro) : avg_delay_min = round(avg_delay_sec / 60, 1); severe_pct = round(100 × severe / known_obs, 1) [dénominateur = delay_observation_count, PAS observation_count; None si known_obs ≤ 0].',
			en: 'Per route r and ISO weekday d (1=Mon..7=Sun), over the whole spine: known_obs = SUM(delay_observation_count) [known delays]; severe = SUM(severe_delay_count) [delay > 300s, |delay| ≤ 3600]; in_clamp = SUM of the 21 histogram bins (the ghost-excluded count). avg_delay_sec = SUM(sum_delay_seconds) / in_clamp [POOLED in-clamp MEAN, not a mean of daily means]. Published (Python side, half-away-from-zero rounding): avg_delay_min = round(avg_delay_sec / 60, 1); severe_pct = round(100 × severe / known_obs, 1) [denominator = delay_observation_count, NOT observation_count; None when known_obs ≤ 0].',
		},
		sql: `-- route.spine.dow (gold/reader/projector.py PROJECT_TEMPLATE, dims = ISO weekday),
-- reconciled S14 2026-07-02: read at build time from gold.route_delay_spine over the
-- WHOLE accrual (NO window clause -> 730-day retention), replacing the dropped
-- gold.route_delay_day_of_week fold over gold.route_delay_hourly (migration 0064). The
-- count/share SUMs are byte-identical to the fold; avg_delay_min is the allowed pooled
-- rebaseline. avg_delay_min / severe_pct / observation_count are then derived in Python
-- from these SUMs (hist_and_avg + _severe_pct); the 21 delay_histogram bin SUMs are the
-- in-clamp (ghost-excluded) denominator, condensed here to unnest() for readability.
SELECT
    EXTRACT(ISODOW FROM provider_local_date)::integer AS day_of_week_iso,
    SUM(observation_count)::bigint         AS obs,
    SUM(delay_observation_count)::bigint   AS known_obs,       -- severe_pct denominator
    SUM(severe_delay_count)::bigint        AS severe,
    SUM(sum_delay_seconds)::bigint         AS sum_delay_sec,   -- pooled-avg numerator
    SUM((SELECT COALESCE(SUM(x), 0)
         FROM unnest(delay_histogram) AS x))::bigint AS in_clamp  -- 21-bin SUM = pooled-avg denominator
FROM gold.route_delay_spine
WHERE provider_id = :provider_id AND route_id = :route_id
GROUP BY 1
ORDER BY 1;`,
		notReally: {
			fr: "Pas une affirmation que « cette ligne est toujours pire le vendredi » ni une note de ponctualité certifiée par jour. C'est une lateur moyenne POOLÉE et une PART de retards graves par jour de semaine local, sur tout l'historique du spine, à partir des déviations prédites, avec des échantillons inégaux d'un jour à l'autre. Un severe_pct élevé un jour peut reposer sur peu de relevés en-clamp; à lire avec observation_count, sans traiter avg_delay_min comme une médiane.",
			en: 'Not a statement that “this route is always worse on Fridays” or a certified day-of-week on-time score. It is a POOLED weighted-average lateness and severe-late SHARE per local weekday over the whole spine history, from predicted feed deviations, with uneven per-weekday samples. A high severe_pct on one weekday can rest on few in-clamp readings; read it together with observation_count, and do not treat avg_delay_min as a median.',
		},
		caveats: {
			fr: [
				"PROXY, pas une ponctualité certifiée : bâti sur l'écart à l'horaire prédit du GTFS-RT, pas l'AVL ni une métrique certifiée par l'agence.",
				"DÉNOMINATEUR de severe_pct (correction d'honnêteté 3/3, migration 0051) : delay_observation_count = SUM(COUNT(delay_seconds)), rangées à retard CONNU, PAS observation_count. severe_pct retourne None (pas 0) quand known_obs ≤ 0.",
				"avg_delay_min est une MOYENNE POOLÉE en-clamp = SUM(sum_delay_seconds) / SUM(seaux d'histogramme) (jadis mal étiquetée « médiane »), signée (négatif = en avance). AUCUN p50/p90 à ce grain, les percentiles n'existent qu'au grain JOUR de l'arrêt.",
				'SEUIL grave = delay_seconds > 300 (5 min); les relevés |delay| > 3600 (1 h) sont fantômes et exclus du numérateur ET du dénominateur en-clamp.',
				"FENÊTRE TOUT-HISTORIQUE (réconcilié S14, 2026-07-02) : le jour-de-semaine est lu à la construction depuis gold.route_delay_spine SANS clause de fenêtre, donc sur tout l'accumulé (rétention 730 jours), un vrai motif de long terme. L'ancien fold gold.route_delay_day_of_week fenêtré ~10 jours sur gold.route_delay_hourly a été SUPPRIMÉ (migration 0064).",
				'DST / attribution du jour : day_of_week_iso = EXTRACT(ISODOW FROM provider_local_date), et provider_local_date est déjà en heure locale du fournisseur dans le spine (aucun timezone() ré-appliqué), donc les relevés post-minuit et de transition DST tombent sur le bon jour calendaire local.',
				"observation_count est publié mais trip_count ne l'est PAS (la valeur gold serait une somme horaire-distincte gonflée, pas des trajets distincts).",
				'SENTINELLES : __unrouted__ existe dans le spine mais ne doit jamais être surfacé comme une vraie ligne. SIGNAUX MORTS DU FLUX jamais utilisés.',
			],
			en: [
				'PROXY, not certified OTP: built from GTFS-RT predicted schedule-deviation, not AVL and not an agency-certified on-time metric.',
				'severe_pct DENOMINATOR (honesty-fix 3/3, migration 0051): delay_observation_count = SUM(COUNT(delay_seconds)), rows with a KNOWN delay, NOT observation_count. severe_pct returns None (not 0) when known_obs ≤ 0.',
				'avg_delay_min is a POOLED in-clamp MEAN = SUM(sum_delay_seconds) / SUM(histogram bins) (was previously mislabeled “median”), signed (negative = running early). There is NO p50/p90 at this weekday grain, percentiles exist only at the stop DAY grain.',
				'SEVERE threshold = delay_seconds > 300 (5 min); readings with |delay| > 3600 (1 h) are ghost/outlier and excluded from BOTH the numerator AND the in-clamp denominator.',
				'ALL-HISTORY window (reconciled S14, 2026-07-02): day-of-week is read at build time from gold.route_delay_spine with NO window clause, so over the whole accrual (730-day retention), a genuine long-run pattern. The old ~10-day-windowed gold.route_delay_day_of_week fold over gold.route_delay_hourly was DROPPED (migration 0064).',
				'DST / weekday attribution: day_of_week_iso = EXTRACT(ISODOW FROM provider_local_date), and provider_local_date is already provider-local in the spine (no timezone() re-applied), so cross-midnight and DST-shift readings land on the correct local calendar weekday.',
				'observation_count is published but trip_count is NOT (the gold value would be an inflated hourly-distinct sum, not distinct trips).',
				'SENTINELS: __unrouted__ exists in the spine but must never be surfaced as a real route. DEAD FEED signals never used.',
			],
		},
	},
] as const;

/** Quick lookup by metric key (build-time stable; the array is the source order). */
export const METRICS_BY_KEY: Readonly<Record<MetricKey, MetricEntry>> = Object.fromEntries(
	METRICS.map((m) => [m.key, m]),
) as Record<MetricKey, MetricEntry>;

/** The metric ids in surface order, for the ToC + the parity test's coverage set. */
export const METRIC_KEYS: readonly MetricKey[] = METRICS.map((m) => m.key);

/**
 * Map each /v1 provenance.methodology key to the explainer MetricEntry it best
 * describes, so /metrics can render the live "Pipeline note (current run)" string
 * inside the matching metric's card. ONE methodology key → ONE metric (no
 * fan-out): each key annotates its single most relevant metric (`delay_unit` is
 * about delay-in-minutes/the ghost guard → avg delay; `headway` covers
 * excess-wait too), and keys with no citizen-metric home (`history_freeze`,
 * `service_time_conversion`, `alert_text_en`, `network_no_data`,
 * `alert_breakdown`) are deliberately left out — they render on the /status
 * data-health surface's Pipeline-notes section instead, so no string is lost.
 *
 * Keyed by the PROVENANCE key (the published string's dictionary key); the value
 * is the explainer MetricKey. A provenance key absent here, or absent from the
 * published methodology dict, simply yields no note (the card is unchanged).
 */
export const METHODOLOGY_METRIC_KEY: Readonly<Record<string, MetricKey>> = {
	otp_definition: 'otp',
	delay_unit: 'avgDelay',
	percentiles: 'p50p90',
	headway: 'headway',
	headway_regularity: 'regularityCov',
	service_span: 'serviceSpan',
	skipped_stops: 'skippedStop',
	cancellation: 'cancellation',
	occupancy: 'occupancy',
};

/**
 * Invert METHODOLOGY_METRIC_KEY to a MetricKey → provenance-key lookup, so the
 * explainer can ask "which methodology string, if any, annotates THIS metric?".
 * One metric maps to at most one methodology key by construction.
 */
export const METRIC_METHODOLOGY_KEY: Readonly<Partial<Record<MetricKey, string>>> =
	Object.fromEntries(
		Object.entries(METHODOLOGY_METRIC_KEY).map(([provKey, metricKey]) => [metricKey, provKey]),
	) as Partial<Record<MetricKey, string>>;

/**
 * Resolve the live methodology note for a metric from a published methodology
 * dict (provenance.methodology). Returns the verbatim published string when the
 * metric has a mapped key AND that key holds a non-empty string, else null (→ the
 * card renders no pipeline note). The value is rendered as-is (a published string).
 */
export function methodologyNoteFor(
	key: MetricKey,
	methodology: Record<string, unknown> | null | undefined,
): string | null {
	if (!methodology) return null;
	const provKey = METRIC_METHODOLOGY_KEY[key];
	if (!provKey) return null;
	const value = methodology[provKey];
	return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** Localized name for a metric key (FR canonical / EN mirror). */
export function metricName(key: MetricKey, locale: Locale): string {
	return METRICS_BY_KEY[key].name[locale];
}

// ── Supplemental (i) tips ──────────────────────────────────────────────────────
//
// Some surfaces label numbers that are NOT one of the 14 reliability families that
// drive the /metrics explainer page (live feed coverage,
// observation counts, and the /alerts GTFS-RT dimensions). They still deserve an
// honest one-line (i) tip with a deep link into /metrics, but they do NOT get their
// own explainer section, so they live here rather than in the METRICS array (which
// the explainer page renders 1:1 and the coverage test pins exactly).
//
// Each entry identifies its own population and missing-data rules. Its `anchor`
// links to the existing /metrics section that explains that source or methodology.
export type SupplementalMetricKey =
	| 'liveOtp'
	| 'liveDelayPercentiles'
	| 'stopNotSevere'
	| 'coverage'
	| 'serviceComparison'
	| 'vehicleCount'
	| 'affectedCounts'
	| 'silentTrip'
	| 'alertCause'
	| 'alertEffect'
	| 'alertSeverity'
	| 'alertDuration'
	| 'alertReach';

interface SupplementalMetricEntry {
	/** Deep-link target — an existing /metrics section anchor (no leading '#'). */
	readonly anchor: string;
	/** ONE-LINE plain explanation, the (i) hover tip (FR canonical / EN mirror). */
	readonly oneLiner: BilingualText;
}

export const SUPPLEMENTAL_METRIC_TIPS: Readonly<
	Record<SupplementalMetricKey, SupplementalMetricEntry>
> = {
	serviceComparison: {
		anchor: 'cancellation',
		oneLiner: { en: serviceComparisonCopy.en.tip, fr: serviceComparisonCopy.fr.tip },
	},
	liveOtp: {
		anchor: 'metrics-provenance',
		oneLiner: {
			fr: 'Parmi les véhicules actuels admissibles sur la carte et au statut connu, la part dont le retard prédit moyen du trajet est compris entre −60 s inclus et 300 s exclus. Les statuts inconnus sont exclus du dénominateur.',
			en: 'Among current vehicle rows eligible for the map and with a known status, the share whose trip-average predicted delay is at least −60 s and below 300 s. Unknown statuses are excluded from the denominator.',
		},
	},
	stopNotSevere: {
		anchor: 'severe',
		oneLiner: {
			fr: 'La part des prévisions connues admissibles à cet arrêt dont le retard ne dépasse pas 300 secondes, y compris les avances. Les retards hors de [−3 600, 3 600] secondes sont exclus. Cette part est le complément des retards graves, pas une ponctualité mesurée.',
			en: 'The share of eligible known predictions at this stop no more than 300 seconds late, including early predictions. Delays outside [−3,600, 3,600] seconds are excluded. This is the complement of severe-delay share, not measured on-time performance.',
		},
	},
	liveDelayPercentiles: {
		anchor: 'metrics-provenance',
		oneLiner: {
			fr: 'Médiane et 90e percentile des retards prédits moyens par trajet actuels, chaque agrégat de trajet ayant le même poids, arrondis à la minute. Valeur indisponible sans trajet mesuré; aucune pondération par les usagers.',
			en: 'Median and 90th percentile of current trip-average predicted delays, with equal weight per trip aggregate, rounded to whole minutes. Unavailable without measured trips; no passenger weighting.',
		},
	},
	coverage: {
		anchor: 'metrics-provenance',
		oneLiner: {
			fr: 'La part des véhicules actuels admissibles sur la carte dont le statut de retard est connu. Sans position admissible, la valeur est indisponible. Les véhicules absents du flux ne sont pas au dénominateur.',
			en: 'The share of current vehicle-position rows eligible for the map with a known delay status. Unavailable without eligible positions. Vehicles absent from the feed are outside the denominator.',
		},
	},
	vehicleCount: {
		anchor: 'metrics-provenance',
		oneLiner: {
			fr: 'Le nombre de positions de véhicules actuelles aux coordonnées valides dans la zone configurée, sans dédoublonnage supplémentaire par identifiant de véhicule. Ce décompte ne mesure ni la flotte officielle ni les véhicules distincts sur une journée.',
			en: 'The count of current vehicle-position rows with valid coordinates within configured map bounds, without additional deduplication by vehicle ID. This is neither the official fleet size nor a count of distinct vehicles over a day.',
		},
	},
	affectedCounts: {
		anchor: 'metrics-provenance',
		oneLiner: {
			fr: "Lignes et arrêts distincts ayant au moins une prévision attribuée de retard supérieur à 5 minutes et d'au plus 60 minutes ce jour-là. Les versions d'avis comptent les contenus distincts enregistrés, pas les incidents ni les usagers. Une source absente laisse le décompte de lignes ou d'arrêts inconnu.",
			en: 'Distinct lines and stops with at least one attributed delay prediction greater than 5 and at most 60 minutes that day. Alert versions count distinct recorded message content, not incidents or riders. Missing route or stop data leaves that count unknown.',
		},
	},
	silentTrip: {
		anchor: 'metrics-provenance',
		oneLiner: {
			fr: 'Les trajets prévus en circulation maintenant, hors métro, sans véhicule correspondant dans l’instantané actuel. Un trajet peut avoir émis plus tôt; son absence actuelle ne confirme pas une annulation.',
			en: 'Scheduled non-metro trips running now with no matching vehicle in the current snapshot. A trip may have reported earlier; its current absence does not confirm a cancellation.',
		},
	},
	alertCause: {
		anchor: 'metrics-provenance',
		oneLiner: {
			fr: "La cause déclarée d'une alerte (p. ex. travaux, météo, panne), reprise telle quelle du flux GTFS-RT, pas une enquête ni une vérification indépendante.",
			en: 'The declared cause of an alert (e.g. construction, weather, breakdown), taken as-is from the GTFS-RT feed, not an investigation or independent check.',
		},
	},
	alertEffect: {
		anchor: 'metrics-provenance',
		oneLiner: {
			fr: "L'effet déclaré d'une alerte sur le service (p. ex. détour, retards, arrêt déplacé), repris tel quel du flux, pas un impact mesuré.",
			en: 'The declared effect of an alert on service (e.g. detour, delays, stop moved), taken as-is from the feed, not a measured impact.',
		},
	},
	alertSeverity: {
		anchor: 'metrics-provenance',
		oneLiner: {
			fr: "Le niveau de gravité que l'agence a attaché à l'alerte dans le flux, son propre étiquetage, pas un score calculé par nous.",
			en: 'The severity level the agency attached to the alert in the feed, its own labelling, not a score we computed.',
		},
	},
	alertDuration: {
		anchor: 'metrics-provenance',
		oneLiner: {
			fr: "La durée annoncée d'une alerte d'après ses fenêtres actives du flux, NULL quand la fenêtre est ouverte ou incohérente, jamais un 0 inventé.",
			en: 'An alert’s announced duration from its active windows in the feed, NULL when the window is open-ended or inconsistent, never a fabricated 0.',
		},
	},
	alertReach: {
		anchor: 'metrics-provenance',
		oneLiner: {
			fr: "Le nombre de lignes et d'arrêts qu'une alerte déclare toucher d'après le flux, un décompte d'entités nommées, pas une estimation d'usagers affectés.",
			en: 'How many routes and stops an alert declares it affects per the feed, a count of named entities, not an estimate of affected riders.',
		},
	},
};

/**
 * The (i)-affordance payload for a metric label on a data surface: the one-line
 * tip + a localized deep link to the explainer at that metric's anchor.
 *
 * Resolves BOTH the 14 reliability families (MetricKey, full explainer entry) and
 * the supplemental metrics (SupplementalMetricKey: coverage,
 * vehicle/silent-trip counts, the /alerts dimensions) that carry only a tip +
 * anchor. `localizeHref` strips/re-adds the locale prefix; the `#anchor` is
 * appended by us (localizeHref treats the hash as caller-owned), so EN →
 * `/metrics#otp` and FR → `/fr/metrics#otp`.
 */
export function metricInfoFor(
	key: MetricKey | SupplementalMetricKey,
	locale: Locale,
): { tip: string; href: string; anchor: string } {
	const entry: { oneLiner: BilingualText; anchor: string } =
		key in METRICS_BY_KEY
			? METRICS_BY_KEY[key as MetricKey]
			: SUPPLEMENTAL_METRIC_TIPS[key as SupplementalMetricKey];
	return {
		tip: entry.oneLiner[locale],
		href: `${localizeHref('/metrics', locale)}#${entry.anchor}`,
		anchor: entry.anchor,
	};
}
