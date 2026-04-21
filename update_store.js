const fs = require('fs');

let storeCode = fs.readFileSync('apps/frontend/src/stores/game.js', 'utf8');

const insertFunc = `async function submitInfieldInDefenseChoice(gameId, throwHome) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await apiClient(\`/api/games/\${gameId}/resolve-infield-in-defense-choice\`, {
      method: 'POST',
      body: JSON.stringify({ throwHome })
    });
  } catch (error) {
    console.error("Error submitting infield in defense choice:", error);
  }
}
`;

storeCode = storeCode.replace('async function resetRolls(gameId)', insertFunc + '\nasync function resetRolls(gameId)');
storeCode = storeCode.replace('submitInfieldInDecision,', 'submitInfieldInDecision,\n    submitInfieldInDefenseChoice,');

fs.writeFileSync('apps/frontend/src/stores/game.js', storeCode);
