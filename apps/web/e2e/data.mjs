import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

// The provider catalog is the only data the header needs; every other v1 path is a 404.
const providers = readFileSync(new URL('./providers.json', import.meta.url));

createServer((request, response) => {
	const found = request.url === '/v1/providers.json';
	response.writeHead(found ? 200 : 404, { 'content-type': 'application/json' });
	response.end(found ? providers : '{}');
}).listen(4318, '127.0.0.1');
