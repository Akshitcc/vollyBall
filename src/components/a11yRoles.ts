/**
 * 1.4.1 (QA V140-11): pressable cards and links are role "button". react-native-web treats role "link" as a
 * native element and leaves Enter/Space to the browser, which only clicks a real <a href> – so Enter and Space
 * did nothing on match cards. Used by ui.tsx Card / section links; checked by components/__tests__/keyboard141.test.tsx.
 */
export const PRESSABLE_CARD_ROLE = 'button' as const;
