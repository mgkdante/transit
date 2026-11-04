declare global {
	namespace App {
		interface Locals {
			locale?: 'en' | 'fr';
			v1Cache?: Map<string, unknown>;
		}
	}
}

export {};
