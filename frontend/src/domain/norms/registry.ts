import { Z2_NORM_RULES } from './rules-z2.js';
import { Z1_NORM_RULES } from './rules-z1.js';
import { Z3_NORM_RULES } from './rules-z3.js';
import { Z4_NORM_RULES } from './rules-z4.js';
import type { NormRule } from './types.js';
export const NORM_RULES: readonly NormRule[] = Object.freeze([...Z2_NORM_RULES,...Z1_NORM_RULES,...Z3_NORM_RULES,...Z4_NORM_RULES]);
