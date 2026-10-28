import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

// The provider catalog, STM's manifest and its provenance; every other v1 path is a 404.
const files = Object.fromEntries(
	[
		['/v1/providers.json', 'providers.json'],
		['/v1/stm/manifest.json', 'manifest.json'],
		['/v1/stm/provenance.json', 'provenance.json'],
		['/v1/stm/static/stops/S1.json', 'stop.json'],
		['/v1/stm/static/stops_index.json', 'stops-index.json'],
		['/v1/stm/live/stop_departures.json', 'departures.json'],
		['/v1/stm/live/alerts.json', 'alerts.json'],
		['/v1/stm/live/trips.json', 'trips.json'],
		['/v1/stm/historic/stop_reliability/S1.json', 'stop-reliability.json'],
		['/v1/stm/historic/history/index.json', 'history-index.json'],
	].map(([path, file]) => [path, readFileSync(new URL(`./${file}`, import.meta.url))]),
);

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
