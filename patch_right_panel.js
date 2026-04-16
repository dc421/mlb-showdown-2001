const fs = require('fs');

const file = 'apps/frontend/src/views/GameView.vue';
let content = fs.readFileSync(file, 'utf8');

const oldBullpenCode = `                  <li v-for="p in rightPanelData.bullpen" :key="p.card_id" class="lineup-item">
                          <span class="sub-icon"></span>
                          <span @click.stop="selectedCard = p" :class="{'is-used': usedPlayerIds.has(p.card_id), 'is-tired': p.fatigueStatus === 'tired' && !usedPlayerIds.has(p.card_id)}">{{ p.displayName }} ({{p.ip}} IP)</span>
                          <span v-if="p.fatigueStatus === 'tired' && !usedPlayerIds.has(p.card_id)" class="status-indicators">
                              <span v-for="n in Math.abs(p.fatigue_modifier || 0)" :key="n" class="status-icon tired" :title="\`Penalty: -\${p.fatigue_modifier}\`"></span>
                          </span>
                          <span v-else-if="p.isBufferUsed && !usedPlayerIds.has(p.card_id)" class="status-icon used" title="Buffer Used"></span>
                  </li>`;

const newBullpenCode = `                  <li v-for="p in rightPanelData.bullpen" :key="p.card_id" class="lineup-item">
                          <span class="sub-icon"></span>
                          <span @click.stop="selectedCard = p" :class="{'is-used': opponentUsedPlayerIds.has(p.card_id), 'is-tired': p.fatigueStatus === 'tired' && !opponentUsedPlayerIds.has(p.card_id)}">{{ p.displayName }} ({{p.ip}} IP)</span>
                          <span v-if="p.fatigueStatus === 'tired' && !opponentUsedPlayerIds.has(p.card_id)" class="status-indicators">
                              <span v-for="n in Math.abs(p.fatigue_modifier || 0)" :key="n" class="status-icon tired" :title="\`Penalty: -\${p.fatigue_modifier}\`"></span>
                          </span>
                          <span v-else-if="p.isBufferUsed && !opponentUsedPlayerIds.has(p.card_id)" class="status-icon used" title="Buffer Used"></span>
                  </li>`;

content = content.replace(oldBullpenCode, newBullpenCode);

const oldBenchCode = `                  <li v-for="p in rightPanelData.bench" :key="p.card_id" class="lineup-item">
                      <span class="sub-icon"></span>
                      <span @click.stop="selectedCard = p" :class="{'is-used': usedPlayerIds.has(p.card_id)}">{{ p.displayName }} ({{p.displayPosition}})</span>
                  </li>`;

const newBenchCode = `                  <li v-for="p in rightPanelData.bench" :key="p.card_id" class="lineup-item">
                      <span class="sub-icon"></span>
                      <span @click.stop="selectedCard = p" :class="{'is-used': opponentUsedPlayerIds.has(p.card_id)}">{{ p.displayName }} ({{p.displayPosition}})</span>
                  </li>`;

content = content.replace(oldBenchCode, newBenchCode);

fs.writeFileSync(file, content);
console.log('Patched right panel elements.');
