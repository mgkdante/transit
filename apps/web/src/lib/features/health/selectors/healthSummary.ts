import { intl, type Locale } from '#lib/i18n/copy.ts';
import { formatRelativeSeconds } from '#lib/utils/time.ts';
import type { DataHealthGate } from '#lib/v1/schemas/index.ts';
import { liveStamp, stampDate, stampText, type RecordStamp } from '#lib/v1/stamp.ts';
import { copy } from '../health.copy';

export interface HealthSummaryFacts {
	/** The live vehicles feed once it has loaded or failed; null while nothing is known yet. */
	readonly live: { readonly ageSeconds: number | null; readonly isStale: boolean } | null;
	readonly record: RecordStamp;
	/** The record's last quality check (data health's rollup lane); null when not published. */
	readonly gate: DataHealthGate | null;
	readonly gaps: readonly string[];
}

/** The three plain lines that open data health: what is current, what the record covers, what to doubt. */
export function healthSummary(facts: HealthSummaryFacts, locale: Locale, timeZone?: string) {
	const t = copy[locale].summary;
	const { live, record, gate, gaps } = facts;
	const date = (key: string | null) => (key ? stampDate(key.slice(0, 10), locale, timeZone) : null);
	const [through, published, next] = [record.dataThrough, record.publishedOn, record.nextUpdateUtc];
	const covered =
		through && published
			? t.record(date(through)!, date(published)!)
			: stampText(record, locale, timeZone);
	const warnings = gate?.verdict === 'warn' ? (gate.warnings ?? 0) : 0;
	// Reassure only on a passed check and current live data; an unknown is never "nothing known".
	const reassured = gate?.verdict === 'pass' && live?.ageSeconds != null && !live.isStale;
	const names = gaps.map((gap) => copy[locale].gaps.names[gap] ?? gap.replace(/_/g, ' '));
	const doubt = [
		warnings > 0 ? t.warning(intl.number(locale).format(warnings), warnings) : reassured && t.clear,
		names.length > 0 && t.gaps(names.join(', ')),
	].filter(Boolean);
	return {
		live: !live
			? null
			: live.ageSeconds == null
				? stampText(liveStamp({ ageSeconds: null }), locale, timeZone)
				: (live.isStale ? t.behind : t.current)(formatRelativeSeconds(live.ageSeconds, locale)),
		record: covered ? [covered, next && t.next(date(next)!)].filter(Boolean).join(' ') : null,
		doubt: doubt.length > 0 ? doubt.join(' ') : null,
	};
}
