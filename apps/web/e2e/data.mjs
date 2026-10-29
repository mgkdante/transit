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
		'access-control-allow-origin': 'http://127.0.0.1:4317',
	});
	response.end(body ?? '{}');
}).listen(4318, '127.0.0.1');
