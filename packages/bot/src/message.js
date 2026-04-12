/**
 * A2A-Nachrichtenformat
 * Orientiert sich am Google A2A-Protokoll-Draft.
 */
export class A2AMessage {
  /**
   * @param {'task'|'result'|'error'|'status'} type
   * @param {string} from  DID des Senders
   * @param {string} to    DID des Empfängers
   * @param {unknown} payload
   */
  constructor(type, from, to, payload) {
    this.type = type
    this.from = from
    this.to = to
    this.payload = payload
    this.timestamp = new Date().toISOString()
  }

  toJSON() {
    return {
      type: this.type,
      from: this.from,
      to: this.to,
      payload: this.payload,
      timestamp: this.timestamp,
    }
  }
}
