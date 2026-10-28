// Vite's `?inline` query returns the file as a base64 data URL.
declare module '*.ttf?inline' {
	const dataUrl: string;
	export default dataUrl;
}
