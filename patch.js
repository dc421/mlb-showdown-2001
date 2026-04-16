const fs = require('fs');

const file = 'apps/frontend/src/views/GameView.vue';
let content = fs.readFileSync(file, 'utf8');

const newUsedPlayerIdsCode = `const usedPlayerIds = computed(() => {
    if (!gameStore.gameState || !leftPanelData.value?.teamKey) return new Set();
    const teamKey = leftPanelData.value.teamKey;
    const teamUsed = gameStore.gameState[teamKey + 'Team']?.used_player_ids || [];
    return new Set(teamUsed);
});

const opponentUsedPlayerIds = computed(() => {
    if (!gameStore.gameState || !rightPanelData.value?.teamKey) return new Set();
    const teamKey = rightPanelData.value.teamKey;
    const teamUsed = gameStore.gameState[teamKey + 'Team']?.used_player_ids || [];
    return new Set(teamUsed);
});
`;

content = content.replace(
`const usedPlayerIds = computed(() => {
    if (!gameStore.gameState || !leftPanelData.value?.teamKey) return new Set();
    const teamKey = leftPanelData.value.teamKey;
    const teamUsed = gameStore.gameState[teamKey + 'Team']?.used_player_ids || [];
    return new Set(teamUsed);
});`, newUsedPlayerIdsCode);

fs.writeFileSync(file, content);
console.log('Patched usedPlayerIds block.');
