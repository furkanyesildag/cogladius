"use strict";

/**
 * Node ajan süreçleri (`agents/`) genelde kök `./.env` okurken Next.js `app/.env.local` kullanır.
 * Aynı OPENAI anahtarı her iki yerde olabildiği için sırayla yüklenir — sonra gelen öncekini geçersiz kılar (override).
 */
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

/**
 * @param {string} agentsDir `__dirname` of the calling file (`agents/agent-simulator.js`)
 */
function loadAgentsEnv(agentsDir) {
  const root = path.resolve(agentsDir, "..");
  const chain = [
    path.join(root, ".env"),
    path.join(root, "app", ".env.local"),
    path.join(root, "app", ".env"),
  ];
  let first = true;
  for (const f of chain) {
    if (!fs.existsSync(f)) continue;
    dotenv.config({ path: f, override: !first });
    first = false;
  }
}

module.exports = { loadAgentsEnv };
