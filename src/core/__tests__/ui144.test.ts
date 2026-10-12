/** 1.4.4 (QA V143-11): the city suggestion after a pincode lookup in Edit profile (core/citySuggest.ts). */
import { citySuggestion } from '../citySuggest';
import en from '../../i18n/locales/en';
import hi from '../../i18n/locales/hi';

describe('V143-11: pincode lookup → city', () => {
  const mumbai = { district: 'Mumbai', city: null };
  it("Tester's case: 110001 → 400001 with the city still on the old lookup name 'New Delhi' → filled with Mumbai", () => {
    expect(citySuggestion('New Delhi', mumbai, ['New Delhi', null])).toEqual({ action: 'fill', name: 'Mumbai' });
    expect(citySuggestion('new delhi ', mumbai, ['New Delhi'])).toEqual({ action: 'fill', name: 'Mumbai' });
  });
  it('an empty city is filled; a lookup city is preferred to the district', () => {
    expect(citySuggestion('', mumbai, [])).toEqual({ action: 'fill', name: 'Mumbai' });
    expect(citySuggestion('', { district: 'Mumbai Suburban', city: 'Andheri' }, [])).toEqual({ action: 'fill', name: 'Andheri' });
  });
  it('a city the user typed is never replaced silently: ask ("Use Mumbai?")', () => {
    expect(citySuggestion('Thane West', mumbai, ['New Delhi'])).toEqual({ action: 'ask', name: 'Mumbai' });
  });
  it('nothing to do when it already matches or the lookup has no name', () => {
    expect(citySuggestion('mumbai', mumbai, [])).toEqual({ action: 'none' });
    expect(citySuggestion('Pune', { district: '', city: null }, [])).toEqual({ action: 'none' });
    expect(citySuggestion('Pune', null, [])).toEqual({ action: 'none' });
  });
  it('the inline question exists in English and Hindi', () => {
    for (const L of [en, hi] as unknown as { profileForm: Record<string, string> }[]) {
      expect(L.profileForm.cityUse).toContain('{{city}}');
      expect(L.profileForm.cityUseYes).toBeTruthy();
      expect(L.profileForm.cityUseKeep).toContain('{{city}}');
    }
    expect(hi.profileForm.cityUse).toMatch(/[\u0900-\u097F]/);
  });
});
