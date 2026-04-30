import re

with open('apps/frontend/src/views/GameView.vue', 'r') as f:
    content = f.read()

# 1. Update infieldInOutThreshold to also look at isInfieldInDefenseChoice
content = content.replace("""const infieldInOutThreshold = computed(() => {
    if (!isInfieldInDecision.value) return null;""", """const infieldInOutThreshold = computed(() => {
    if (!isInfieldInDecision.value && !isInfieldInDefenseChoice.value) return null;""")

# 2. Add isInfieldInDefenseChoice computed property
content = content.replace("""const isInfieldInDecision = computed(() => {
    if (isGameOver.value) return false;
    return amIOffensivePlayer.value && isMyTurn.value && gameStore.gameState?.currentPlay?.type === 'INFIELD_IN_CHOICE' && !showRollForSwingButton.value;
});""", """const isInfieldInDecision = computed(() => {
    if (isGameOver.value) return false;
    return amIOffensivePlayer.value && isMyTurn.value && gameStore.gameState?.currentPlay?.type === 'INFIELD_IN_CHOICE' && !showRollForSwingButton.value;
});

const isInfieldInDefenseChoice = computed(() => {
    if (isGameOver.value) return false;
    return amIDefensivePlayer.value && isMyTurn.value && gameStore.gameState?.currentPlay?.type === 'INFIELD_IN_DEFENSE_CHOICE' && !showRollForPitchButton.value;
});""")

# 3. Add handleInfieldInDefenseChoice
content = content.replace("""function handleInfieldInDecision(sendRunner) {
    gameStore.submitInfieldInDecision(gameId, sendRunner);
}""", """function handleInfieldInDecision(sendRunner) {
    gameStore.submitInfieldInDecision(gameId, sendRunner);
}

function handleInfieldInDefenseChoice(throwHome) {
    gameStore.submitInfieldInDefenseChoice(gameId, throwHome);
}""")

# 4. Add the template block for isInfieldInDefenseChoice
search_template = """            <div v-else-if="isInfieldInDecision">
                <h3>Infield In Play</h3>
                <p>The defense has the infield in. What will the runner on third do?</p>
                <div class="infield-in-decisions">
                    <button @click="handleInfieldInDecision(true)" class="tactile-button">Send Runner Home ({{ infieldInOutThreshold }}+)</button>
                    <button @click="handleInfieldInDecision(false)" class="tactile-button">Hold Runner</button>
                </div>
            </div>"""

replace_template = search_template + """
            <div v-else-if="isInfieldInDefenseChoice">
                <h3>Infield In Play</h3>
                <p>The runner on third is heading home! Where will you throw?</p>
                <div class="infield-in-decisions">
                    <button @click="handleInfieldInDefenseChoice(true)" class="tactile-button">Throw Home ({{ infieldInOutThreshold }}+)</button>
                    <button @click="handleInfieldInDefenseChoice(false)" class="tactile-button">Throw to 1st</button>
                </div>
            </div>"""

content = content.replace(search_template, replace_template)

# 5. Add waiting text for the offensive player
content = content.replace("""            <div v-if="isAwaitingBaserunningDecision" class="waiting-text">Waiting on baserunning decision...</div>""", """            <div v-if="isAwaitingBaserunningDecision" class="waiting-text">Waiting on baserunning decision...</div>
            <div v-else-if="amIDisplayOffensivePlayer && gameStore.gameState?.currentPlay?.type === 'INFIELD_IN_DEFENSE_CHOICE'" class="waiting-text">Waiting for defense to throw...</div>""")

with open('apps/frontend/src/views/GameView.vue', 'w') as f:
    f.write(content)
print("Replaced Vue file!")
