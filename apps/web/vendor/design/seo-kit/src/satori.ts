import satori from 'satori';

export type SatoriTree = Parameters<typeof satori>[0];
export type SatoriRenderOptions = Parameters<typeof satori>[1];
export type SvgRasterizer<Bytes extends Uint8Array = Uint8Array> = (
	svg: string,
) => Bytes | Promise<Bytes>;

export async function renderSatoriPng<Bytes extends Uint8Array = Uint8Array>(
	tree: unknown,
	options: SatoriRenderOptions,
	rasterize: SvgRasterizer<Bytes>,
): Promise<Bytes> {
	const svg = await satori(tree as SatoriTree, options);
	return await rasterize(svg);
}
