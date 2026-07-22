/**
 * A closed, inclusive span of local calendar dates (America/Montréal service
 * days), each expressed as an ISO `YYYY-MM-DD` string with `from <= to`. This is
 * the one window shape shared by retained history and the filter facade: a
 * range is present only when both bounds are set, and a single-day selection
 * uses the same date for both bounds. Half-picked or malformed spans normalize
 * to honest absence before they reach history loaders or shared URLs.
 */
export interface DateWindow {
	/** Inclusive span start, `<= to`. */
	readonly from: string;
	/** Inclusive span end, `>= from`. */
	readonly to: string;
}
