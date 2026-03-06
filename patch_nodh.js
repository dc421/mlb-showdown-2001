const fs = require('fs');

const serverPath = 'apps/backend/server.js';
let content = fs.readFileSync(serverPath, 'utf8');

const searchBlock = `            // 5. Adapt the lineup
            if (prev_use_dh && !use_dh) {
                // Previous: DH (YES) -> Current: DH (NO)
                // Need to replace 'DH' with 'P' (placeholder for pitcher)
                return battingOrder.map(spot => {
                    if (spot.position === 'DH') {
                        return { ...spot, position: 'P', card_id: 'PITCHER_PLACEHOLDER' };
                    }
                    return spot;
                });
            } else if (!prev_use_dh && use_dh) {`;

const replaceBlock = `            // 5. Adapt the lineup
            if (prev_use_dh && !use_dh) {
                // Previous: DH (YES) -> Current: DH (NO)
                // Need to remove 'DH' from current position and add 'P' at the bottom (9th spot)
                const newOrder = battingOrder.filter(spot => spot.position !== 'DH');
                newOrder.push({ position: 'P', card_id: 'PITCHER_PLACEHOLDER' });
                return newOrder;
            } else if (!prev_use_dh && use_dh) {`;

if (content.includes(searchBlock)) {
    content = content.replace(searchBlock, replaceBlock);
    fs.writeFileSync(serverPath, content);
    console.log("Success");
} else {
    console.log("Failed to find block");
}
