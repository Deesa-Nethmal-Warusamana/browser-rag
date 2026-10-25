/**
 * Guards against degenerate generations. Small local models fall into copy
 * loops: given a context full of repeated instruction-shaped sentences they will
 * emit the same lines dozens of times. Nothing downstream can fix a 10k-character
 * loop, so the stream is cut as soon as it is detected.
 */

export type StopReason = 'repetition' | 'length';

export interface GuardVerdict {
  stop: boolean;
  reason?: StopReason;
}

/** Length of the window compared against earlier output. */
const WINDOW = 64;
/** How many times that window may recur before we call it a loop. */
const MAX_OCCURRENCES = 3;
/** Only re-scan once this many new characters have arrived. */
const CHECK_EVERY = 32;

export interface OutputGuard {
  push(delta: string): GuardVerdict;
  readonly text: string;
  readonly length: number;
}

export function createOutputGuard(maxChars = 4000): OutputGuard {
  let text = '';
  let checkedAt = 0;

  return {
    push(delta: string): GuardVerdict {
      text += delta;

      if (text.length > maxChars) return { stop: true, reason: 'length' };
      if (text.length - checkedAt < CHECK_EVERY) return { stop: false };
      checkedAt = text.length;

      if (text.length < WINDOW * MAX_OCCURRENCES) return { stop: false };

      const tail = text.slice(-WINDOW);
      let occurrences = 0;
      let index = text.indexOf(tail);
      while (index !== -1) {
        occurrences += 1;
        if (occurrences >= MAX_OCCURRENCES) return { stop: true, reason: 'repetition' };
        index = text.indexOf(tail, index + 1);
      }
      return { stop: false };
    },
    get text() {
      return text;
    },
    get length() {
      return text.length;
    },
  };
}

export function stopMessage(reason: StopReason): string {
  return reason === 'repetition'
    ? 'Stopped early — the model started repeating itself. Try a narrower question or a stronger model.'
    : 'Stopped early — the answer hit the length limit. Ask for something more specific.';
}
