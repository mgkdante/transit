import type { LocaleFree, Persisted, Widen } from './index.js';

export declare function persisted<T extends LocaleFree>(key: string, initial: T): Persisted<Widen<T>>;
