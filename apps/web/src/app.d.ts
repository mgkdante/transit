declare global {
	namespace App {
		interface Locals {
			locale?: 'en' | 'fr';
			v1Cache?: Map<string, unknown>;
			approximateLocation?: import('#lib/v1/requestLocation').ApproximateLocation | null;
		}
	}
}

export {};
