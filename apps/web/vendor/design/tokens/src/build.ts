import { generateDesignMd } from './generators/design-md.ts';
import type { DesignMdOptions } from './generators/design-md.ts';
import { generateMotionTs } from './generators/motion-ts.ts';
import { generateThemeBlock } from './generators/theme-block.ts';
import { generateTokensCss } from './generators/tokens-css.ts';
import type { TokenTree } from './types.ts';

const generators = {
  designMd: generateDesignMd,
  motionTs: generateMotionTs,
  themeBlock: generateThemeBlock,
  tokensCss: generateTokensCss,
} as const;

export type BuildTarget = keyof typeof generators;
export type BuildOutputs = Record<BuildTarget, string>;
export type SelectedBuildOutputs<T extends readonly BuildTarget[]> = Pick<
  BuildOutputs,
  T[number]
>;

export interface BuildRequest {
  tree: TokenTree;
  design?: DesignMdOptions;
}

const allTargets = Object.keys(generators) as BuildTarget[];

export function buildAll<const T extends readonly BuildTarget[]>(
  request: BuildRequest & { targets: T },
): SelectedBuildOutputs<T>;
export function buildAll(request: BuildRequest): BuildOutputs;
export function buildAll({ tree, design, targets = allTargets }: BuildRequest & {
  targets?: readonly BuildTarget[];
}): BuildOutputs | Partial<BuildOutputs> {
  return Object.fromEntries(
    targets.map((target) => [
      target,
      target === 'designMd' ? generateDesignMd(tree, design) : generators[target](tree),
    ]),
  ) as BuildOutputs | Partial<BuildOutputs>;
}
