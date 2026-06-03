Original prompt: Add a server side for user account so it is secured

## 2026-05-29

- Server-side account system is implemented in `server.js` with Node built-ins only.
- Passwords are hashed with `crypto.scryptSync`, sessions use an HttpOnly SameSite cookie, and data is stored in `data/store.json`.
- Static serving blocks private files such as `data/store.json`, `server.js`, and package metadata.
- Frontend auth and card/deck persistence are now routed through `/api/*` endpoints instead of browser `localStorage`.
- Verification passed for syntax checks, register/login/logout/reset, protected page redirects, owned card save, owned deck save, and private-file 404 responses.
- Stopped the previous background server that was occupying port 5173 and added a clearer `EADDRINUSE` message with alternate port commands.
- Added `cards.html` as the first Card Creator page: 50-card paginated library, right-pane preview, edit redirect, bulk delete mode, confirmation dialog, and server-side owned-card deletion.
- Verification passed for card-library navigation, 50-per-page rendering, empty initial detail pane, selected-card preview, edit-mode loading, and bulk delete from the server store.
- Monster description fields are contextual: Effect monsters show only effect type plus effect description; Normal monsters show only short description. The same rule applies to card previews and the library right pane.
- Effect monsters, spell cards, and trap cards now build their short effect description from Cause and Effects dropdowns, with the generated text saved to the card and shown in the library detail pane.
- The Effects dropdown is level-gated: levels 1-4 show only All Levels effects, levels 5-7 also show Level 5-7 effects, and levels 8-10 show all effect groups.
- Parameterized effects now show contextual Effect Options: level range fields for "Special summon a level X to X monster from hand", destination for graveyard-to-hand/deck, and source for level 4-or-below hand/deck summons.
- The card creator form spacing was relaxed with larger section gaps, taller inputs, a restored Effect / Description legend, and a padded Effect Options panel so the effect controls are easier to scan.
- Effect Options controls now align with the Cause/Effect columns, and the level-range summon effect is capped to levels 1-4.
- The level-range effect now validates From/To Level so From must be lower than To; equal or reversed values are disabled or corrected before preview/save.
- Effect monsters now have a "Can be used ONCE per turn" checkbox, saved as `effectOncePerTurn`, restored in edit mode, and shown as Usage in the card detail pane.
- Saving a card now redirects to `cards.html` with the saved card selected in the library detail pane.

## 2026-06-01

- Deck creator slot rows now size fluidly inside their pane and stay centered at narrow widths.
- The deck creator stacked layout breakpoint moved to 760px so the four-pane layout stops squeezing the deck slots off-center on smaller screens.
- Verified with a Playwright layout harness at 800px, 703px, and 480px viewport widths; deck slot center offset was 0px at the stacked widths and within 0.5px at 800px.
- Added global themed scrollbar styling for scrollable app surfaces, with dark-gold default rails, blue hover/active thumb states, and muted inactive/disabled styling.
- Verified scrollbar pseudo-styles in Playwright: root and pane scrollbars report the new 18px width and ornate gradient thumb backgrounds.
- Selected Card pane now expands into the remaining deck-creator width instead of being capped at 320px, and its preview/details stretch full-width while staying center-aligned.
- Verified selected pane responsiveness in Playwright at 1900px, 1100px, 703px, and 480px; preview/details stayed centered with no horizontal overflow.
- Deck Details now uses the same flexible pane sizing as Selected Card, so both panes stay nearly equal width across desktop/tablet sizes and stack full-width on small screens.
- Verified Deck Details vs Selected Card widths in Playwright at 1900px, 1400px, 1100px, 900px, 800px, 703px, and 480px; width delta was 0px or within rounding and no horizontal overflow was detected.
- Selected Card details now omit the separate Effect row and show only Effect Description, with the displayed description's first letter capitalized.
- Verified with Playwright that the selected-card table has no Effect row and displays `Special summon...` with an uppercase first letter.
- Battlefield turn controls now let each side change each face-up monster's Attack/Defense position once during its own Main Phase; the AI uses the same rule before Battle Phase.
- Battle now shows a centered Victory/Defeat overlay, aligns the turn badge to the battlefield column, extends direct-attack arrows to the opponent hand area, and uses a slower attack-arrow cadence.
- Added battlefield animations for drawing, placing cards, sending cards to the graveyard, monster shatter before battle destruction, and life point changes.
- Verified with a Playwright battle harness that mode changing works, turn alignment stays within 1.6px at 1440px and 0.9px at 800px, direct attack arrows reach the AI hand center, LP loss animates, Victory appears, and destroyed monsters shatter before both graveyards update.
- AI battle targeting now scores attacks against attack-position ATK and defense/face-down DEF, skips unfavorable attacks, and only direct-attacks when the opponent has no monsters.
- Victory/Defeat overlay now includes Rematch and Exit actions; Rematch resets the duel state with the loaded deck pool, while Exit returns to `home.html`.
- Replaced stacked battlefield hover listeners with guarded per-render handlers so rematch resets cannot leave old slot listeners pointing at null cards.
- Verified with Playwright harnesses that the AI skips a risky 1000 ATK into a 3000 ATK target, attacks and destroys a 1000 ATK target with a 3000 ATK monster for 2000 damage, Victory shows Rematch/Exit, Rematch resets turn/LP/GY/draw prompt, and Exit navigates to `home.html`.
- Ran the stock `web_game_playwright_client.js`; it reached the login page because `battle.html` requires an authenticated `/api/session`, so authenticated duel checks used the mocked API harness instead.

## TODO

- For production deployment, replace the demo reset-password endpoint with an email token flow and run behind HTTPS so cookies can also use the `Secure` flag.
