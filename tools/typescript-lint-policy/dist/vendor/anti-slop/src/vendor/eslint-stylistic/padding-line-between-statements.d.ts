import type { CreateRule } from '@oxlint/plugins';
import type { RuleOptions } from './padding-line-options.d.ts';
/** Build the vendored padding rule with caller-owned, typed policy options. */
export default function createPaddingLineRule(options: RuleOptions): CreateRule;
