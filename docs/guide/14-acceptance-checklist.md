# 14. Feature-by-feature acceptance checklist

Use this list to accept a build (manual walk on a phone or the web build at 360 px, in **Day and Night** and **EN and
HI**). Each line is a pass / fail check. Automated coverage is noted where a suite proves it.

## A. Sign-in and profile
- [ ] A1 Login accepts a valid 10-digit number and rejects an invalid one with a clear message.
- [ ] A2 **Verify** stays disabled until 6 digits are entered; a wrong code shows an error; resend unlocks after the timer.
- [ ] A3 First sign-in shows the Terms; continuing requires ticking the box.
- [ ] A4 Profile setup requires a name; DOB below `MIN_AGE` is refused.
- [ ] A5 Demo builds show the demo banner; production builds never do (`check:strip`).
- [ ] A6 Sign out returns to Login; the session no longer works on the server.
- [ ] A7 Profile shows stats, recent form, teams, history, memories; private details only to the owner.

## B. Settings
- [ ] B1 Appearance: Auto / Day / Night apply immediately; Auto follows 06:00 / 18:00.
- [ ] B2 The Sunset → Floodlight animation plays once per switch; with the switch off or Reduce Motion it fades.
- [ ] B3 On the scoring screen a theme switch never covers the score (crossfade after the rally).
- [ ] B4 Language EN ↔ HI switches every screen; no truncated Hindi in buttons at 360 px.
- [ ] B5 Wallet shows balance, bonus rule, next bonus, pending / flagged counts and history.

## C. Teams
- [ ] C1 Create a team with name and colour; creator is captain.
- [ ] C2 Add players by number; an invited player can accept or decline.
- [ ] C3 Phone numbers of other players are never displayed.
- [ ] C4 A team needs 6 players to play; at most 12.
- [ ] C5 Unconfirmed results are not counted on the team page ("waiting for the other captain").

## D. New match and live scoring
- [ ] D1 3-step flow Teams → Rules → Start; **Next** explains what is missing.
- [ ] D2 Exact 6 forces picking 6 for larger teams (captain always plays); Custom allows 6 – 12.
- [ ] D3 A player cannot be in both teams.
- [ ] D4 Indoor and Beach presets match the documented rules; editing makes the rules Custom.
- [ ] D5 Tap a player = player + team point; tap a team half = team point only.
- [ ] D6 Sets end at the right score (win by 2); set point / match point labels; deciding set to 15.
- [ ] D7 Side switches prompted at the rule's points; timeouts limited per set; substitutions work.
- [ ] D8 Serve indicator and rotation advance correctly.
- [ ] D9 Offline: rallies are kept and sync in order; status shows Offline / Syncing / Synced.
- [ ] D10 Only the scorer can score; others see "Watch live".
- [ ] D11 The winning rally ends the match; the result screen offers Share and Summary.
- [ ] D12 Viewers see the score update after every rally without refreshing.
- *Automated: scoring, rotation, rules, replay and lifecycle suites (Jest, server, rules).*

## E. Undo
- [ ] E1 Undo removes the last rally (team point and player credit) and shows the new score.
- [ ] E2 "Nothing to undo yet" at 0 rallies.
- [ ] E3 Undo is refused once the match is over and after POTM is set.
- [ ] E4 Undo back to 0 does not make a played match deletable.

## F. Results, POTM and anti-fraud
- [ ] F1 POTM auto-picks the most credited points; the scorer can change and confirm it.
- [ ] F2 Only the opposing captain can confirm or reject; reject reason ≤ 200 characters.
- [ ] F3 A match under 10 minutes is flagged and does not count until reviewed.
- [ ] F4 Daily (3 per player) and weekly (2 per team pair) limits apply in IST.
- [ ] F5 Admin approve only clears the flag; void never counts; admins cannot review their own matches.
- [ ] F6 Rankings and wallet count confirmed results only.

## G. Abandon
- [ ] G1 A match with no rally can be abandoned or deleted.
- [ ] G2 After the first rally the 'review' policy records the abandon for review; the opposing captain can report.
- [ ] G3 A won match cannot be abandoned.

## H. Challenges
- [ ] H1 Only captains can send; a team cannot challenge itself; both teams need 6 players.
- [ ] H2 Challenged captain gets a notification and can accept / decline.
- [ ] H3 Accept creates a playable match (accepting captain scores; challenger's captain confirms).
- [ ] H4 A challenge can only be linked to a match between its two teams.

## I. Tournaments
- [ ] I1 Knockout: byes to top seeds; play-in round when needed; bracket readable at 360 px.
- [ ] I2 League: table uses 3 / 2 / 1 points.
- [ ] I3 Groups + knockout: ≥ 4 teams, ≤ 32; seeded and random draws; preview counts match.
- [ ] I4 Only the organiser (or an admin) changes a tournament.
- [ ] I5 Table / Bracket / Fixtures tabs update from match results; champion shown.

## J. Home and map
- [ ] J1 Greeting matches the hour (morning / afternoon / evening / night) with the first name.
- [ ] J2 Fact / Quote of the day shows a source; "Tap for next" cycles; Share works.
- [ ] J3 Quick actions open the right screens (Courts → Map tab).
- [ ] J4 Live hero, rank card, invites, challenges and upcoming are shown when relevant.
- [ ] J5 Map shows courts and games; distance chips filter; Play nearby works without location permission.

## K. Ask VolleyLive
- [ ] K1 Rules questions answer with sources (EN, HI, romanised HI).
- [ ] K2 "My stats / teams / matches", live score, standings, fixtures, challenges, leaderboard show correct cards.
- [ ] K3 Write requests are refused with a pointer to the right screen.
- [ ] K4 Requests for someone else's phone / private data are refused.
- [ ] K5 Prompt-injection attempts are refused; injected text in data is ignored.
- [ ] K6 Phone numbers and e-mails never appear in answers or stored history.
- [ ] K7 History is owner-only; Clear deletes it.
- [ ] K8 Over the rate limit the user sees a friendly "try again later".
- *Automated: Ask eval (≥ 98 % at 1.5.7), server Ask tests, PII tests.*

## L. Help, feedback, rate, about
- [ ] L1 Help Center search, topics and FAQ work in EN and HI; Contact us creates a ticket.
- [ ] L2 Support buttons only appear for configured contacts.
- [ ] L3 Feedback sends 1 – 5 stars + optional text; rate-limited; no rewards.
- [ ] L4 Rate opens the Play review sheet in the Play build; the pre-prompt is off by default.
- [ ] L5 About shows version, versionCode and backend; Licences and Privacy (DRAFT) open.

## M. Non-functional
- [ ] M1 Contrast: every text pair passes WCAG AA in Day and Night (contrast scan 0 failures).
- [ ] M2 Touch targets ≥ 48 dp; screen reader labels on tiles, chips and buttons.
- [ ] M3 Layout at 360 px: nothing clipped; content clears the tab bar and keyboard.
- [ ] M4 All suites green: Jest (+ 5 time zones), server, rules.
- [ ] M5 No secrets in the repo or the APK; production build passes `assertProductionBuild`.
- [ ] M6 The APK installs over the previous build with `adb install -r` (versionCode increased, same certificate).
