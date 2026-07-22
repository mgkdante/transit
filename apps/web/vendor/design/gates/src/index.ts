// @yesid/gates — brand gates as pure, parameterized engines.
// Provenance: tokens-only (styleRegressions) + contrast floors (colorMixFloors,
// contrastPairs Engine B math) from yesid.dev @ 2bdb611d; no-raw-brand-hex
// (brandHex) + dataviz doctrine (datavizDoctrine) + the dotted-path token
// accessor from transit; tvOnlyInUi MINTED here. Detection internals are
// byte-equivalent to the source gates for their default configs.

export { walk, walkFiltered } from './engines/walk.js';
export { blankComments, numbered } from './engines/comments.js';
export {
	styleRegressionViolations,
	type ForbiddenPattern,
	type StyleRegressionConfig,
	type ForbiddenHit,
} from './engines/styleRegressions.js';
export {
	brandHexViolations,
	buildBrandHexPattern,
	type BrandHexConfig,
	type BrandHexResult,
} from './engines/brandHex.js';
export {
	datavizViolations,
	buildFillPatterns,
	DEFAULT_AFFORDANCE_TOKENS,
	DEFAULT_ALLOW_MARKERS,
	type DatavizDoctrineConfig,
} from './engines/datavizDoctrine.js';
export {
	leaf,
	makeHexAccessor,
	luminance,
	ratio,
	runContrastPairs,
	runIdentities,
	type Mode,
	type ContrastPair,
	type PairResult,
	type TokenIdentity,
} from './engines/contrastPairs.js';
export {
	colorMixViolations,
	buildColorMixPatterns,
	DEFAULT_COLOR_MIX_CONFIG,
	type ColorMixFloorConfig,
} from './engines/colorMixFloors.js';
export {
	tvOnlyInUiViolations,
	type TvOnlyInUiConfig,
	type TvGateResult,
} from './engines/tvOnlyInUi.js';
export {
	sitemapCoverage,
	ogCoverage,
	type CoverageDiffInput,
	type CoverageDiff,
	type OgCoverageInput,
	type OgCoverage,
} from './engines/seoCoverage.js';
