// Static-first public route boundary. MapHero stays a direct dynamic import from
// MapProgressive so the live map graph cannot become an eager barrel dependency.
export { default as MapProgressive } from './MapProgressive.svelte';
