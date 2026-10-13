import { describe, it, expect } from 'vitest';
import { shouldShowUpdateBanner } from '../useServiceWorkerUpdate';

describe('shouldShowUpdateBanner', () => {
  it('is true when a worker is waiting and the page already has a controller', () => {
    expect(shouldShowUpdateBanner(true, true)).toBe(true);
  });

  it('is false for the very first install (no controller yet)', () => {
    expect(shouldShowUpdateBanner(true, false)).toBe(false);
  });

  it('is false when there is no waiting worker', () => {
    expect(shouldShowUpdateBanner(false, true)).toBe(false);
  });

  it('is false when neither condition holds', () => {
    expect(shouldShowUpdateBanner(false, false)).toBe(false);
  });
});
