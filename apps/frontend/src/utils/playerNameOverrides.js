// Manual box-score name overrides, keyed by card_id.
//
// Box scores refer to players as "F. Last (paren)". When two players in the same game share the
// same first initial + last name, the auto-disambiguator (see newspaperNames.js) falls back to the
// full first name. If that still isn't enough — or you simply want a specific rendering for a given
// card — dictate it here. The value is used verbatim.
//
// Example:
//   export const NAME_OVERRIDES = {
//     614: 'B.J. Ryan',
//     512: 'Frank Thomas (BIG)',
//   };
export const NAME_OVERRIDES = {
  // The only cards that collide even at "Fi. Last" (no parenthetical to separate them).
  189: 'A. Gonzalez',      // Alex Gonzalez  (only A-initial Gonzalez besides 368, now A.S.)
  368: 'A.S. Gonzalez',    // Alex S. Gonzalez
  44: 'Bra. Anderson',     // Brady Anderson  (Brady/Brian both start "Br")
  394: 'Bri. Anderson',    // Brian Anderson
  108: 'Mar. Anderson',    // Marlon Anderson (Marlon/Matt both start "Ma")
  511: 'Mat. Anderson',    // Matt Anderson
};
