# 13. FAQ

## Players

**How do I sign in?** Enter your 10-digit mobile number, tap **Send OTP**, type the 6-digit code. First time: accept
the Terms and set up your profile.

**I didn't get the code.** Wait for the resend timer and tap **Resend code**. Check the number with **Change**. There
is a per-hour limit on codes per number.

**Can other players see my phone number?** No. They can add you to a team by number, but your number is never shown to
them, and Ask never reveals it.

**How do I give a point to a player?** On the scoring screen tap the player's tile: the player and their team both get
the point. Tap the team's half for a team point only (e.g. an opponent error).

**I tapped the wrong player.** Tap **UNDO** – it removes the last rally. You can also correct the credit on one of the
last 3 rallies after the match.

**Why can't I undo after the match ended?** Once the winning rally is in, the match is final everywhere.

**Can two people score the same match?** No. Only the assigned scorer can score; the scorer can hand over the role.
Everyone else follows live.

**Why doesn't my win count yet?** A result counts only after the **opposing captain confirms** it, and only if it is
not flagged (shorter than 10 minutes) and within the daily / weekly limits. The wallet shows what is waiting.

**How are ranking points calculated?** Credited points + 10 per win + 25 per Player of the Match, over finished
counted matches. You need 3 finished matches to appear in the rankings.

**Are wallet points money?** No. They are in-app points only, with no money value.

**Why did the theme change?** In **Auto**, the app uses Day from 06:00 to 17:59 and Night from 18:00 to 05:59. Choose
Day or Night in Settings → Appearance to fix it. The animation can be turned off there.

**Does the app work offline while scoring?** Yes. Rallies are saved on the phone ("Offline – saved on phone") and sent
in order when the network is back.

**How do I switch to Hindi?** Settings → Language → हिन्दी (also on the login screen).

**How do I delete my account?** 1.5.7 has no in-app delete button yet. Contact support through Help → Contact us. The server supports owner-only deletion (`DELETE /api/users/:id`).

## Captains and organisers

**How do I challenge another team?** Home → Challenge (captains only), pick your team, find the other team, set day,
time, place and an optional message.

**Who scores a challenge match?** The accepting captain is the scorer; the challenger's captain confirms the result.

**How many teams can a tournament have?** Up to 32 registered teams with at least 6 players each. Groups + knockout
needs at least 4 teams.

**How are league points awarded?** 3-0 / 3-1 win = 3 points, 3-2 win = 2 points, 2-3 loss = 1 point.

**Can I delete a match?** Only a match that never had a rally (creator or admin). A played match cannot be deleted.

## Ask VolleyLive

**What can Ask do?** Answer rules and how-to questions with sources, and show your stats, teams, matches, live scores,
tournament tables and fixtures, challenges and the leaderboard.

**Can Ask change my data?** No. It is read-only; it tells you which screen to use instead.

**Is Ask a real AI model?** By default it runs a deterministic mock planner. An operator can connect OpenAI, Gemini or
Anthropic on the server with a key in the server's secret store; this has not been switched on yet.

**Who can see my Ask history?** Only you. **Clear** deletes it.

## Developers and operators

**Which backend does a build use?** Decided from `EXPO_PUBLIC_*` variables: API if `EXPO_PUBLIC_API_URL` is set,
Firebase if Firebase keys are set, otherwise demo. See [03](03-architecture.md#33-backend-selection).

**Where do secrets go?** Never in the repo. Use the EAS environment, the host's secret store or a git-ignored `.env`.
`.env.example` files are placeholders.

**Can I edit an applied migration?** No – the runner checks sha256 checksums and refuses to start. Add a new migration.

**Why did `adb install` fail with `INSTALL_FAILED_VERSION_DOWNGRADE`?** The installed app has a higher versionCode.
Build with a higher versionCode; do not uninstall (that wipes app data).

**Why `INSTALL_FAILED_VERIFICATION_FAILURE` on a Realme phone?** Enable Developer options → *Install via USB* and
approve the prompt on the phone.

**How do I run more than one API instance?** Set `REDIS_URL` (shared rate limits and live bus) and use S3 or a shared
volume for photos.
