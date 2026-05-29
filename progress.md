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

## TODO

- For production deployment, replace the demo reset-password endpoint with an email token flow and run behind HTTPS so cookies can also use the `Secure` flag.
