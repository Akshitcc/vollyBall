/** 1.5.4 (Tester F153-6, a11y): the invitee's Home "Join team" / "Decline" buttons name the team for screen readers. */
import { render } from '@testing-library/react-native';
import fs from 'fs';
import path from 'path';
import React from 'react';
import i18n from '../../i18n';
import { Button } from '../ui';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

describe('F153-6', () => {
  it('EN and HI strings include the team name', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('home.joinTeamA11y', { team: 'Fresh Falcons' })).toBe('Join Fresh Falcons');
    expect(i18n.t('home.declineTeamA11y', { team: 'Fresh Falcons' })).toBe('Decline Fresh Falcons');
    await i18n.changeLanguage('hi');
    expect(i18n.t('home.joinTeamA11y', { team: 'Fresh Falcons' })).toBe('Fresh Falcons में शामिल हों');
    expect(i18n.t('home.declineTeamA11y', { team: 'Fresh Falcons' })).toBe('Fresh Falcons का न्योता ठुकराएँ');
    await i18n.changeLanguage('en');
  });
  it('Button exposes the accessibilityLabel (visible title unchanged); without it the title is read', async () => {
    const r = await render(<><Button title="Join team" accessibilityLabel="Join Fresh Falcons" testID="j" /><Button title="Decline" testID="d" /></>);
    expect(r.getByTestId('j').props.accessibilityLabel).toBe('Join Fresh Falcons');
    expect(r.queryAllByLabelText('Join Fresh Falcons').length).toBeGreaterThan(0);
    expect(r.getByText('Join team')).toBeTruthy();
    expect(r.getByTestId('d').props.accessibilityLabel).toBeUndefined();
  });
  it('Home passes the team-named labels to both invite buttons', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/index.tsx'), 'utf8');
    expect(src).toMatch(/title=\{tr\('home\.joinTeam'\)\} accessibilityLabel=\{tr\('home\.joinTeamA11y', \{ team: t\.name \}\)\}/);
    expect(src).toMatch(/title=\{tr\('common\.decline'\)\} accessibilityLabel=\{tr\('home\.declineTeamA11y', \{ team: t\.name \}\)\}/);
  });
});
