import { describe, expect, it } from 'vitest';
import * as mod from './index';

describe('@app/tracking', () => {
  it('読み込める', () => {
    expect(mod).toBeTypeOf('object');
  });
});
