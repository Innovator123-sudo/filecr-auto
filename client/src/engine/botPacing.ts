// client/src/engine/botPacing.ts — adaptive bot pacing (spec §8.2)
export type BotDifficulty = 'easy' | 'medium' | 'hard';

export interface BotConfig {
  k: number; // pace factor vs user
  gamma: number; // rubber-band strength
  startRpm: number;
}

export const BOT_CONFIGS: Record<BotDifficulty, BotConfig> = {
  easy: { k: 1.30, gamma: 0.02, startRpm: 12 },
  medium: { k: 1.00, gamma: 0.05, startRpm: 18 },
  hard: { k: 0.85, gamma: 0.10, startRpm: 24 },
};

const ALPHA = 0.35;
const T_MIN = 0.5;
const T_MAX = 4.0;

export class BotPacer {
  private tBot: number; // current bot rep duration (seconds)
  private userDurations: number[] = []; // last 3 user rep durations (seconds)
  private botReps = 0;
  private userReps = 0;
  private surgeRemaining = 0;
  private surgeActive = false;

  constructor(private difficulty: BotDifficulty) {
    const cfg = BOT_CONFIGS[difficulty];
    this.tBot = 60 / cfg.startRpm;
  }

  setDifficulty(d: BotDifficulty) {
    this.difficulty = d;
    if (this.userDurations.length === 0) {
      this.tBot = 60 / BOT_CONFIGS[d].startRpm;
    }
  }

  // call on every user rep
  onUserRep(durationMs: number) {
    this.userReps += 1;
    this.userDurations.push(durationMs / 1000);
    if (this.userDurations.length > 3) this.userDurations.shift();
    this.recompute();
  }

  onBotRep() {
    this.botReps += 1;
    // Hard mode surge logic: 3 bursts per match (triggered elsewhere), we model as temporary tBot *= 0.7
    if (this.surgeActive && this.surgeRemaining > 0) {
      this.surgeRemaining -= 1;
      if (this.surgeRemaining === 0) this.surgeActive = false;
    }
    this.recompute();
  }

  triggerSurge(reps: number = 5) {
    this.surgeActive = true;
    this.surgeRemaining = reps;
  }

  private recompute() {
    if (this.userDurations.length === 0) return;
    const cfg = BOT_CONFIGS[this.difficulty];
    const tUserMean = this.userDurations.reduce((a, b) => a + b, 0) / this.userDurations.length;
    let tTarget = cfg.k * tUserMean * (1 + cfg.gamma * (this.botReps - this.userReps));
    if (this.surgeActive) tTarget *= 0.72; // sprint
    tTarget = Math.max(T_MIN, Math.min(T_MAX, tTarget));
    this.tBot = (1 - ALPHA) * this.tBot + ALPHA * tTarget;
    this.tBot = Math.max(T_MIN, Math.min(T_MAX, this.tBot));
  }

  getTBot() { return this.tBot; }
  getBotRpm() { return 60 / this.tBot; }
  getUserRpm(): number | null {
    if (!this.userDurations.length) return null;
    const m = this.userDurations.reduce((a, b) => a + b, 0) / this.userDurations.length;
    return 60 / m;
  }
  getCounts() { return { bot: this.botReps, user: this.userReps }; }

  reset() {
    this.tBot = 60 / BOT_CONFIGS[this.difficulty].startRpm;
    this.userDurations = [];
    this.botReps = 0;
    this.userReps = 0;
    this.surgeActive = false;
    this.surgeRemaining = 0;
  }
}
