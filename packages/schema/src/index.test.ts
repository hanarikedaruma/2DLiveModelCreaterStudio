import { describe, expect, it } from 'vitest';
import * as schema from './index';

describe('@app/schema の公開', () => {
  it('設計書の関数と定数を出している', () => {
    for (const name of [
      'newId',
      'validateProject',
      'migrate',
      'loadProjectJson',
      'createEmptyProject',
      'ensureStandardParameters',
      'depthParallaxOffset',
    ] as const) {
      expect(schema[name], name).toBeTypeOf('function');
    }
    expect(schema.SCHEMA_VERSION).toBe(2); // I-026 で 2 にした
    expect(schema.PARALLAX_RATIO).toBe(0.08);
    expect(schema.STANDARD_PARAMETERS).toHaveLength(26);
  });
});
