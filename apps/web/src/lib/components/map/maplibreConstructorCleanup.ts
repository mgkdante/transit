import type { Map as MapLibreMap } from 'maplibre-gl';

type MapConstructor = typeof import('maplibre-gl').Map;
type MapOptions = ConstructorParameters<MapConstructor>[0];
type GlCleanup = Pick<WebGLRenderingContext, 'getExtension'>;

export function constructRecoverableMap(
	MapConstructor: MapConstructor,
	options: MapOptions,
	reportCleanupFailure: (error: unknown) => void,
): MapLibreMap {
	let constructing = true;
	class RecoverableMap extends MapConstructor {
		override _setupPainter(): void {
			if (!constructing) {
				super._setupPainter();
				return;
			}
			try {
				super._setupPainter();
				return;
			} catch (constructionError) {
				const cleanupErrors: unknown[] = [];
				try {
					// MapLibre's anonymous creation-error listener is once-only but remove()
					// does not unregister it. Consume it while the partial canvas is reachable.
					const EventConstructor = this._canvas.ownerDocument.defaultView?.Event ?? Event;
					this._canvas.dispatchEvent(new EventConstructor('webglcontextcreationerror'));
				} catch (error) {
					cleanupErrors.push(error);
				}
				let gl = { getExtension: () => null } as GlCleanup;
				try {
					const configured = this._canvasContextAttributes.contextType;
					const context = configured
						? this._canvas.getContext(configured)
						: (this._canvas.getContext('webgl2') ?? this._canvas.getContext('webgl'));
					if (context && 'getExtension' in context) gl = context as GlCleanup;
				} catch (error) {
					cleanupErrors.push(error);
				}

				// remove() needs these two fields before the base constructor initializes
				// them. Supplying the recovered GL lets it lose the actual context after it
				// deletes this exact map's private ImageRequest throttle callback.
				this.painter = {
					destroy: () => {},
					context: { gl },
				} as unknown as MapLibreMap['painter'];
				this.handlers = { destroy: () => {} } as unknown as MapLibreMap['handlers'];

				try {
					super.remove();
				} catch (error) {
					cleanupErrors.push(error);
				}
				if (cleanupErrors.length > 0) {
					reportCleanupFailure(
						new AggregateError(
							[constructionError, ...cleanupErrors],
							'MapLibre constructor rollback failed',
						),
					);
				}
				throw constructionError;
			}
		}
	}

	try {
		return new RecoverableMap(options);
	} finally {
		constructing = false;
	}
}
