/**
 * A2A Bot-Koordination
 *
 * Bots kommunizieren über das A2A-Protokoll (Agent-to-Agent).
 * Jeder Bot hat eine eigene DID-Identität und UCAN-Berechtigungen.
 *
 * Bekannte Bots:
 *   - Agent1        — persönlicher Assistent (Darius)
 *   - Agent2 — Sönkes Bot
 */

export { createBot } from './bot.js'
export { A2AMessage } from './message.js'
