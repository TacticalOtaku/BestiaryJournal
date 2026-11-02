## Artwork and usability
- Larger collection tiles show the complete cover over a softly blurred background, with captions below the artwork.
- Collection covers and creature portraits remain still until hover or keyboard focus. Animated artwork respects motion settings; static artwork receives a subtle light effect.
- Finite GIF animations restart on repeated interaction for locally hosted artwork. External images retain native playback when CORS prevents independent playback sources.
- Collection and family controls are visible on keyboard focus; item disclosures update their accessibility state.

## Fixes
- Research chat outcomes disclose names and automatic DCs only when all recipients know them, and preserve blind-roll visibility.
- Concurrent requests cannot consume the same research roll twice.
- Legacy migrations save recovery data before writing and restore originals after failed writes, retaining the backup if rollback fails.
- Rapid comment submissions no longer create duplicates; pending saves preserve newly typed drafts and allow retry after failure.
- Creature cards distinguish entry locks from inherited collection locks.
- A newly selected collection cover can be cleared immediately without reopening the editor.

## Validation and compatibility
- 157 automated tests pass, together with lint and manifest validation.
- Artwork tested in Foundry VTT 14.367: multiple aspect ratios, repeated GIF playback, themes, density, narrow windows and GM player preview.
- Requires Foundry VTT 14.367 (v14) and dnd5e 5.3.3 or later within the declared compatibility range. No public API changes.
