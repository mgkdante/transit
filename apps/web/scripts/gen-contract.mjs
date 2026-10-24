import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const schemaDir = resolve(dirname(fileURLToPath(import.meta.url)), '../src/lib/v1/schemas');
const keywords = new Set([
	'$defs',
	'$ref',
	'title',
	'description',
	'default',
	'type',
	'properties',
	'required',
	'additionalProperties',
	'items',
	'anyOf',
	'const',
	'enum',
	'minimum',
	'maximum',
	'minLength',
	'pattern',
	'minItems',
	'maxItems',
]);
const webDefaultObjects = new Set([
	'StatusDist',
	'OccupancyMix',
	'DelayBucket',
	'RouteDelayHistogramBin',
]);
const webIsoUtcFields =
	/^(generated|updated|reported|captured|start|end|first_seen|last_seen|last_publish|last_loaded|eta)_utc$/;
const quote = JSON.stringify;

export function generateModule(root) {
	const declarations = new Map();
	const pending = new Set();
	function expression(node, field = '', parent = '') {
		const webHeadwayDirectionId = parent === 'HeadwayPeriod' && field === 'direction_id';
		for (const key of Object.keys(node)) {
			if (!keywords.has(key)) throw new Error(`Unsupported keyword: ${key}`);
		}
		let code;
		if (node.$ref) {
			const match = /^#\/\$defs\/([A-Za-z][A-Za-z0-9]*)$/.exec(node.$ref);
			if (!match || !root.$defs?.[match[1]]) throw new Error(`Unsupported ref: ${node.$ref}`);
			declare(match[1], root.$defs[match[1]]);
			code = `${match[1]}Schema`;
		} else if (node.anyOf) {
			if (node.anyOf.length !== 2 || node.anyOf[1].type !== 'null') {
				throw new Error('Unsupported anyOf (expected value followed by null)');
			}
			// Visit null too, so unsupported keywords cannot hide in that branch.
			expression(node.anyOf[1]);
			code = `${expression(node.anyOf[0], field, parent)}.nullable()`;
		} else if ('const' in node) code = `z.literal(${quote(node.const)})`;
		else if (node.enum) code = `z.enum(${quote(node.enum)})`;
		else {
			switch (node.type) {
				case 'object': {
					if (node.additionalProperties !== undefined) {
						if (node.properties || node.additionalProperties === false) {
							throw new Error('Unsupported additionalProperties');
						}
						code = `z.record(z.string(), ${node.additionalProperties === true ? 'z.unknown()' : expression(node.additionalProperties)})`;
					} else {
						const required = new Set(node.required ?? []);
						code = `z.object({\n${Object.entries(node.properties ?? {})
							.map(([key, value]) => {
								let property = expression(value, key, node.title);
								if (!required.has(key)) {
									property +=
										webDefaultObjects.has(node.title) && typeof value.default === 'number'
											? `.default(${quote(value.default)})`
											: '.optional()';
								}
								return `${quote(key)}: ${property},`;
							})
							.join('\n')}\n})`;
					}
					break;
				}
				case 'array':
					code = `z.array(${expression(node.items)})`;
					break;
				case 'integer':
					code = webHeadwayDirectionId ? 'z.number()' : 'z.number().int()';
					break;
				case 'number':
					code = 'z.number()';
					break;
				case 'string':
					code = webIsoUtcFields.test(field) ? 'isoUtc()' : 'z.string()';
					break;
				case 'boolean':
					code = 'z.boolean()';
					break;
				case 'null':
					code = 'z.null()';
					break;
				case undefined:
					if (Object.keys(node).length === 0) {
						code = 'z.unknown()';
						break;
					}
					throw new Error('Missing type');
				default:
					throw new Error(`Unsupported type: ${node.type}`);
			}
		}
		for (const [key, method] of Object.entries({
			minimum: 'min',
			maximum: 'max',
			minLength: 'min',
			minItems: 'min',
			maxItems: 'max',
		})) {
			if (key in node) code += `.${method}(${quote(node[key])})`;
		}
		if (node.pattern) code += `.regex(new RegExp(${quote(node.pattern)}))`;
		return code;
	}
	function declare(name, node) {
		if (declarations.has(name)) return;
		if (pending.has(name)) throw new Error(`Recursive definition: ${name}`);
		pending.add(name);
		const code = expression(node);
		declarations.set(
			name,
			`export const ${name}Schema = ${code};\nexport type ${name} = z.infer<typeof ${name}Schema>;\n`,
		);
		pending.delete(name);
	}
	for (const [name, node] of Object.entries(root.$defs ?? {})) declare(name, node);
	declare(root.title, root);
	const body = [...declarations.values()].join('\n');
	return `import { z } from 'zod';\n${body.includes('isoUtc()') ? "import { isoUtc } from '../types';\n" : ''}\n${body}`;
}

export function generate(
	inputDir = join(schemaDir, 'json'),
	outputDir = join(schemaDir, 'generated'),
) {
	const modules = readdirSync(inputDir)
		.filter((name) => name.endsWith('.schema.json'))
		.sort()
		.map((name) => {
			const root = JSON.parse(readFileSync(join(inputDir, name), 'utf8'));
			return [name.replace('.schema.json', '.ts'), generateModule(root), root.title];
		});
	mkdirSync(outputDir, { recursive: true });
	for (const [name, content] of modules) writeFileSync(join(outputDir, name), content);
	writeFileSync(
		join(outputDir, 'index.ts'),
		modules
			.map(
				([name, , title]) =>
					`export { ${title}Schema, type ${title} } from './${name.slice(0, -3)}';\n`,
			)
			.join(''),
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) generate();
