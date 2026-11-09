import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const read = (file) => readFileSync(new URL(file, import.meta.url));
// STM serves the listed feeds; OC Transpo serves a manifest, provenance and a passing pipeline gate.
// Every unlisted v1 path is a 404.
const files = Object.fromEntries(
	[
		['/v1/providers.json', 'providers.json'],
		['/v1/stm/manifest.json', 'manifest.json'],
		['/v1/stm/provenance.json', 'provenance.json'],
		['/v1/stm/static/stops/S1.json', 'stop.json'],
		['/v1/stm/static/stops_index.json', 'stops-index.json'],
		['/v1/stm/static/routes_index.json', 'routes-index.json'],
		['/v1/stm/live/stop_departures.json', 'departures.json'],
		['/v1/stm/live/alerts.json', 'alerts.json'],
		['/v1/stm/live/trips.json', 'trips.json'],
		['/v1/stm/historic/stop_reliability/S1.json', 'stop-reliability.json'],
		['/v1/stm/historic/history/index.json', 'history-index.json'],
		['/v1/octranspo/provenance.json', 'provenance.json'],
		['/v1/octranspo/status/data_health.json', 'data-health.json'],
	].map(([path, file]) => [path, read(`./${file}`)]),
);
const ottawa = JSON.parse(files['/v1/providers.json']).providers.find(
	({ id }) => id === 'octranspo',
);
files['/v1/octranspo/manifest.json'] = JSON.stringify({
	...JSON.parse(files['/v1/stm/manifest.json']),
	provider: ottawa.id,
	display_name: ottawa.labels.en.operator,
	bbox: ottawa.fit_bounds,
});
// The b9 bundle's line, its stop and their reliability back the line page.
const { files: b9 } = JSON.parse(read('../scripts/__fixtures__/b9/rich.json'));
for (const [key, body] of Object.entries(b9)) {
	if (/^(static\/(routes|stops)|historic\/(route|stop)_reliability)\//.test(key))
		files[`/v1/stm/${key}`] ??= JSON.stringify(body);
}

createServer((request, response) => {
	// No Date header: the app anchors its clock to it, which would undo page.clock.
	response.sendDate = false;
	const body = files[request.url];
	response.writeHead(body ? 200 : 404, {
		'content-type': 'application/json',
		'access-control-allow-origin': process.env.TRANSIT_E2E_ORIGIN ?? 'http://127.0.0.1:4317',
	});
	response.end(body ?? '{}');
}).listen(Number(process.env.TRANSIT_E2E_DATA_PORT ?? 4318), '127.0.0.1');

// Opt-in layout variants leave the original fixtures unchanged for other specs.
const layoutFiles = { ...files };
for (const [key, body] of Object.entries(b9)) {
	if (!['providers.json', 'manifest.json'].includes(key))
		layoutFiles[`/v1/stm/${key}`] = JSON.stringify(body);
}
const layoutManifest = JSON.parse(JSON.stringify(b9['manifest.json']));
layoutManifest.bbox = JSON.parse(files['/v1/stm/manifest.json']).bbox;
layoutManifest.files.live.ttl_s = 60;
layoutFiles['/v1/stm/manifest.json'] = JSON.stringify(layoutManifest);
// Preserve the fixture's actual lookup ids and trip/stop content.
for (const key of [
	'static/routes_index.json',
	'static/stops_index.json',
	'static/stops/S1.json',
	'live/trips.json',
	'live/stop_departures.json',
	'live/alerts.json',
])
	layoutFiles[`/v1/stm/${key}`] = files[`/v1/stm/${key}`];
const generated = JSON.parse(files['/v1/stm/live/trips.json']).generated_utc;
layoutFiles['/v1/stm/historic/receipts/2026-08-29.json'] = JSON.stringify({
	generated_utc: generated,
	date: '2026-08-29',
	otp_pct: 82,
	avg_delay_min: 3.4,
	severe_pct: 11,
	affected_routes: 12,
	affected_stops: 340,
	alerts: 5,
	vehicles: 37,
	rider_impact_score: 7.2,
	worst_route: { id: '24', name: 'Sherbrooke', otp_delta_pts: -8 },
	worst_stop: { id: 'S1', name: 'Fixture stop', avg_delay_min: 6.1 },
});
layoutFiles['/v1/stm/live/vehicles.json'] = JSON.stringify({
	generated_utc: generated,
	vehicles: [
		{
			id: 'layout-bus',
			lat: 45.51,
			lon: -73.59,
			route: '24',
			trip: 'T1',
			status: 'on_time',
			updated_utc: generated,
			reported_utc: generated,
			speed_kmh: 40,
			bearing: 90,
			occupancy: 'many_seats',
			delay_min: 0,
			next_stop: 'S1',
		},
	],
});
const route24 = JSON.parse(layoutFiles['/v1/stm/static/routes/24.json']);
route24.directions[0].shape = {
	type: 'LineString',
	coordinates: [
		[-73.61, 45.51],
		[-73.55, 45.51],
	],
};
layoutFiles['/v1/stm/static/routes/24.json'] = JSON.stringify(route24);
for (const state of ['fresh', 'stale', 'missing'])
	for (const [path, body] of Object.entries(layoutFiles)) {
		const parsed = JSON.parse(body);
		const normalize = (value) => {
			if (!value || typeof value !== 'object') return;
			for (const [key, item] of Object.entries(value)) {
				if (key === 'generated_utc') value[key] = generated;
				else normalize(item);
			}
		};
		normalize(parsed);
		if (state === 'missing' && path.includes('/historic/receipts/') && parsed.date)
			for (const key of ['affected_routes', 'affected_stops', 'alerts', 'otp_pct', 'avg_delay_min'])
				parsed[key] = null;
		if (state === 'missing' && path.endsWith('/live/vehicles.json'))
			for (const vehicle of parsed.vehicles)
				for (const key of ['occupancy', 'delay_min', 'speed_kmh', 'next_stop']) vehicle[key] = null;
		if (state === 'missing' && path.endsWith('/live/network.json'))
			for (const key of [
				'on_time_pct',
				'delay_p50_min',
				'delay_p90_min',
				'coverage_pct',
				'occupancy_mix',
			])
				parsed[key] = null;
		files[`/__layout/${state}${path}`] = JSON.stringify(parsed);
	}
