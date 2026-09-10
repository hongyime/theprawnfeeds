/* One queue serves every category. Leaving a view pauses unstarted work. */
class FeedQueue {
  constructor(entries, { limit = 6, run, onChange = () => {} }) {
    this.entries = entries.map(entry => ({ ...entry, status: 'idle' }));
    this.limit = limit;
    this.run = run;
    this.onChange = onChange;
    this.section = null;
    this.visible = true;
    this.active = 0;
  }
  setView(section, visible = true) {
    this.section = section;
    this.visible = visible;
    this.pump();
  }
  summary(section) {
    const entries = this.entries.filter(entry => entry.section === section);
    return {
      total: entries.length,
      finished: entries.filter(entry => ['success', 'error'].includes(entry.status)).length,
      failed: entries.filter(entry => entry.status === 'error').length
    };
  }
  pump() {
    while (this.visible && this.active < this.limit) {
      const entry = this.entries.find(item => item.section === this.section && item.status === 'idle');
      if (!entry) return;
      entry.status = 'running';
      this.active++;
      Promise.resolve().then(() => this.run(entry)).then(
        value => { entry.status = 'success'; entry.value = value; },
        error => { entry.status = 'error'; entry.error = error; }
      ).finally(() => {
        this.active--;
        try { this.onChange(entry); } finally { this.pump(); }
      });
    }
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { FeedQueue };
else globalThis.FeedQueue = FeedQueue;
