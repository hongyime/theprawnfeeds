// These are disposable per-instance response caches, not persistent feed storage.
class FeedCache {
  constructor({ maxEntries = 256, maxBytes = 8 * 1024 * 1024, freshMs = 3600000, staleMs = 21600000, now = Date.now } = {}) {
    Object.assign(this, { maxEntries, maxBytes, freshMs, staleMs, now });
    this.entries = new Map();
    this.bytes = 0;
  }
  remove(key) {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.now() - entry.timestamp >= this.staleMs) { this.remove(key); return null; }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { ...entry, fresh: this.now() - entry.timestamp < this.freshMs };
  }
  set(key, data) {
    const bytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
    this.remove(key);
    if (bytes > this.maxBytes) return;
    for (const [oldKey, entry] of this.entries) {
      if (this.now() - entry.timestamp >= this.staleMs) this.remove(oldKey);
    }
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      this.remove(this.entries.keys().next().value);
    }
    this.entries.set(key, { data, bytes, timestamp: this.now() });
    this.bytes += bytes;
  }
}

module.exports = { FeedCache };
