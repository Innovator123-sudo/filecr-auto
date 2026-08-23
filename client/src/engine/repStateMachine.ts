import type { RepEvent, PoseState, TrackingStatus } from './types';
import poseConfig from '../config/pose-config.json';

export interface MachineConfig {
  upThreshold: number;
  downThreshold: number;
  hipThreshold: number;
  kneeThreshold: number;
  visibilityThreshold: number;
  minRepDurationMs: number;
}

export const DEFAULT_MACHINE_CONFIG: MachineConfig = {
  upThreshold: (poseConfig as any).elbowUpThresholdDeg ?? 155,
  downThreshold: (poseConfig as any).elbowDownThresholdDeg ?? 92,
  hipThreshold: (poseConfig as any).hipStraightThresholdDeg ?? 160,
  kneeThreshold: (poseConfig as any).kneeStraightThresholdDeg ?? 155,
  visibilityThreshold: (poseConfig as any).visibilityThreshold ?? 0.42,
  minRepDurationMs: (poseConfig as any).minRepDurationMs ?? 320,
};

export class RepStateMachine {
  private state: PoseState = 'UP';
  private repCount = 0;
  private hasVisitedDown = false;
  private repStartTime = 0;
  private lastRepTime = 0;
  private durations: number[] = [];
  private status: TrackingStatus = 'tracking';
  public onRep?: (ev: RepEvent) => void;
  public lastRejectReason: string | null = null;
  private adaptiveEnabled = (poseConfig as any).adaptive?.enabled ?? true;
  private warmupReps = (poseConfig as any).adaptive?.warmupReps ?? 4;
  private upPercent = (poseConfig as any).adaptive?.upPercent ?? 0.80;
  private downPercent = (poseConfig as any).adaptive?.downPercent ?? 0.20;
  private minRangeDeg = (poseConfig as any).adaptive?.minRangeDeg ?? 30;
  private angleHistory: number[] = [];
  private userMin = 180;
  private userMax = 0;
  private isCalibrated = false;
  public adaptiveThresholds: {up:number, down:number} | null = null;
  // Fast-mode tracking for accurate but fast reps
  private prevElbow: number | null = null;
  private prevTime: number = 0;
  private fastConfig = (poseConfig as any).fastMode || {};

  constructor(private cfg: MachineConfig = DEFAULT_MACHINE_CONFIG) {}

  getRepCount() { return this.repCount; }
  getState() { return this.state; }
  getStatus() { return this.status; }

  update(params: {
    elbowAngle: number;
    hipAngle: number;
    kneeAngle: number;
    meanVisibility: number;
    now: number;
    lowerBodyVisible?: boolean;
  }): { state: PoseState; status: TrackingStatus; counted: boolean; event?: RepEvent; rejectReason?: string } {
    const { elbowAngle, hipAngle, kneeAngle, meanVisibility, now } = params;
    const lowerBodyVisible = params.lowerBodyVisible ?? true;
    const fastVelocityThresh = this.fastConfig.velocityThresholdDegPerSec ?? 160;
    const fastDrop = this.fastConfig.fastThresholdDropDeg ?? 8;
    const minDurNormal = this.fastConfig.minDurationMsNormal ?? this.cfg.minRepDurationMs;
    const minDurFast = this.fastConfig.minDurationMsFast ?? 220;

    if (this.adaptiveEnabled && !this.isCalibrated) {
      this.angleHistory.push(elbowAngle);
      if (this.angleHistory.length > 180) this.angleHistory.shift();
      if (elbowAngle < this.userMin) this.userMin = elbowAngle;
      if (elbowAngle > this.userMax) this.userMax = elbowAngle;
    }

    if (meanVisibility < this.cfg.visibilityThreshold) {
      this.status = 'lost';
      this.lastRejectReason = 'Get back in frame';
      this.prevElbow = elbowAngle;
      this.prevTime = now;
      return { state: this.state, status: this.status, counted: false };
    }
    this.status = 'tracking';

    // Velocity / fast detection
    let velocity = 0;
    let isFast = false;
    if (this.prevElbow != null && this.prevTime) {
      const dt = now - this.prevTime;
      if (dt > 5 && dt < 300) {
        velocity = Math.abs(elbowAngle - this.prevElbow) / (dt / 1000);
        isFast = velocity > fastVelocityThresh;
      }
    }

    // Fast-mode: when going fast, thresholds become more forgiving by dropping downThreshold down by 8deg
    // and upThreshold down slightly, so quick shallow reps still count accurately without missing.
    let upThresh = this.cfg.upThreshold;
    let downThresh = this.cfg.downThreshold;
    let minDuration = minDurNormal;
    if (isFast) {
      downThresh = Math.max(70, downThresh - fastDrop);
      // don't drop UP thresh too much else half-reps counted — keep 4deg leniency
      upThresh = Math.max(135, upThresh - 4);
      minDuration = minDurFast;
    }

    // FAST INTERPOLATION: at 30 FPS a fast 280ms rep can jump 50deg between frames and skip the DOWN state entirely
    // If we see a large drop from near UP to near DOWN in one frame, infer DOWN was visited.
    // Window widened (+26): frontal cameras project elbow flexion shallower, so the
    // bottom often lands above downThresh — a big swing must still count as depth.
    const largeDrop = this.prevElbow != null && this.prevElbow >= upThresh - 5 && elbowAngle <= downThresh + 26 && Math.abs(elbowAngle - this.prevElbow) > 28;
    const largeRise = this.prevElbow != null && this.prevElbow <= downThresh + 26 && elbowAngle >= upThresh - 5 && Math.abs(elbowAngle - this.prevElbow) > 28;

    // If large drop while in UP, force hasVisitedDown true even if we didn't hit exact threshold
    if (largeDrop && this.state === 'UP' && !this.hasVisitedDown) {
      this.hasVisitedDown = true;
      if (this.repStartTime === 0) this.repStartTime = now;
      // console.debug(`[Fast] largeDrop inferred DOWN visited ${this.prevElbow?.toFixed(0)} -> ${elbowAngle.toFixed(0)} v=${velocity|0}°/s`);
    }

    let next: PoseState = this.state;
    if (elbowAngle >= upThresh) next = 'UP';
    else if (elbowAngle <= downThresh) next = 'DOWN';
    else next = 'MID';

    let effectiveState: PoseState = next;
    if (next === 'MID') effectiveState = this.state;

    // Also treat large rise from DOWN region directly to UP as UP even if intermediate MID missed
    if (largeRise && this.state === 'DOWN' && this.hasVisitedDown) {
      effectiveState = 'UP';
    }

    if (effectiveState !== this.state) {
      if (effectiveState === 'DOWN' && this.state === 'UP') {
        this.hasVisitedDown = true;
        if (this.repStartTime === 0) this.repStartTime = now;
      }
      if (effectiveState === 'UP' && this.state === 'DOWN' && this.hasVisitedDown) {
        const duration = now - (this.repStartTime || this.lastRepTime || now);
        const backOk = !lowerBodyVisible || hipAngle >= this.cfg.hipThreshold;
        const legOk = !lowerBodyVisible || kneeAngle >= this.cfg.kneeThreshold;
        // Fast mode uses shorter minDuration so fast reps aren't rejected as "Too fast"
        const tempoOk = duration >= minDuration;

        let rejectReason: string | null = null;
        if (!backOk) rejectReason = `Back not straight (hip ${Math.round(hipAngle)}° < ${this.cfg.hipThreshold}°)`;
        else if (!legOk) rejectReason = `Legs bent — straighten knees (knee ${Math.round(kneeAngle)}° < ${this.cfg.kneeThreshold}°)`;
        else if (!tempoOk) rejectReason = `Too fast (${duration|0}ms < ${minDuration}ms)`;

        if (backOk && legOk && tempoOk) {
          this.repCount += 1;
          this.durations.push(duration);
          if (this.durations.length > 3) this.durations.shift();
          const formScore = this.computeFormScore(elbowAngle, hipAngle, kneeAngle, duration, lowerBodyVisible);
          const ev: RepEvent = {
            repNumber: this.repCount,
            timestamp: now,
            formScore,
            elbowAngle,
            hipAngle,
            kneeAngle,
            durationMs: duration,
          } as any;
          this.lastRepTime = now;
          this.repStartTime = now;
          this.hasVisitedDown = false;
          this.state = 'UP';
          this.lastRejectReason = null;
          if (this.adaptiveEnabled && !this.isCalibrated && this.repCount >= this.warmupReps) {
            this.calibrateAdaptive();
          }
          this.onRep?.(ev);
          this.prevElbow = elbowAngle;
          this.prevTime = now;
          return { state: 'UP', status: this.status, counted: true, event: ev };
        } else {
          this.lastRejectReason = rejectReason;
          this.hasVisitedDown = false;
          this.repStartTime = now;
          this.prevElbow = elbowAngle;
          this.prevTime = now;
          return { state: 'UP', status: this.status, counted: false, rejectReason: rejectReason || undefined };
        }
      }
      this.state = effectiveState;
    }

    this.prevElbow = elbowAngle;
    this.prevTime = now;
    return { state: this.state, status: this.status, counted: false };
  }

  isPlankValid(hipAngle: number, kneeAngle: number, lowerBodyVisible = true): { valid: boolean; reason?: string } {
    if (!lowerBodyVisible) return { valid: true };
    if (hipAngle < this.cfg.hipThreshold) return { valid: false, reason: `Hip ${Math.round(hipAngle)}°` };
    if (kneeAngle < this.cfg.kneeThreshold) return { valid: false, reason: `Knee ${Math.round(kneeAngle)}°` };
    return { valid: true };
  }

  private computeFormScore(elbowAngle: number, hipAngle: number, kneeAngle: number, durationMs: number, lowerBodyVisible = true): number {
    const w = (poseConfig as any).formScoreWeights;
    const depthScore = 95;
    const hipScore = hipAngle >= this.cfg.hipThreshold ? 100 : Math.max(0, (hipAngle / this.cfg.hipThreshold) * 100);
    const kneeScore = kneeAngle >= this.cfg.kneeThreshold ? 100 : Math.max(0, (kneeAngle / this.cfg.kneeThreshold) * 100);
    const ideal = 1200; // faster ideal for fast-capable app (was 1500)
    const tempoScore = Math.max(0, 100 - Math.abs(durationMs - ideal) / 18);
    const useHipKnee = lowerBodyVisible;
    const totalW = (w.depth ?? 0.35) + (w.tempo ?? 0.15) + (useHipKnee ? (w.hip ?? 0.25) + (w.knee ?? 0.25) : 0);
    const raw = (w.depth ?? 0.35) * depthScore + (w.tempo ?? 0.15) * tempoScore + (useHipKnee ? (w.hip ?? 0.25) * hipScore + (w.knee ?? 0.25) * kneeScore : 0);
    const score = raw / (totalW || 1);
    return Math.round(Math.max(60, Math.min(100, score)));
  }

  private calibrateAdaptive() {
    const range = this.userMax - this.userMin;
    if (range < this.minRangeDeg) {
      console.log(`[Adaptive] range ${range.toFixed(1)}° too small, keeping defaults ${this.cfg.downThreshold}/${this.cfg.upThreshold}`);
      this.isCalibrated = true;
      return;
    }
    const newDown = this.userMin + range * this.downPercent;
    const newUp = this.userMin + range * this.upPercent;
    const clampedDown = Math.max(70, Math.min(110, newDown));
    const clampedUp = Math.max(140, Math.min(170, newUp));
    console.log(`[Adaptive] Calibrated from ${this.userMin.toFixed(0)}°–${this.userMax.toFixed(0)}° (range ${range.toFixed(0)}°) → DOWN <${clampedDown.toFixed(0)}° UP >${clampedUp.toFixed(0)}° (was ${this.cfg.downThreshold}/${this.cfg.upThreshold})`);
    this.cfg.downThreshold = clampedDown;
    this.cfg.upThreshold = clampedUp;
    this.adaptiveThresholds = {up: clampedUp, down: clampedDown};
    this.isCalibrated = true;
  }

  updateThresholds(up: number, down: number) {
    this.cfg.upThreshold = up;
    this.cfg.downThreshold = down;
    this.isCalibrated = true;
    this.adaptiveThresholds = {up, down};
  }

  getThresholds() { return {up: this.cfg.upThreshold, down: this.cfg.downThreshold, adaptive: this.adaptiveThresholds, calibrated: this.isCalibrated, userMin: this.userMin, userMax: this.userMax}; }

  reset() {
    this.state = 'UP';
    this.repCount = 0;
    this.hasVisitedDown = false;
    this.repStartTime = 0;
    this.lastRepTime = 0;
    this.durations = [];
    this.status = 'tracking';
    this.lastRejectReason = null;
    this.angleHistory = [];
    this.userMin = 180;
    this.userMax = 0;
    this.isCalibrated = false;
    this.adaptiveThresholds = null;
    this.prevElbow = null;
    this.prevTime = 0;
  }

  getDurations() { return [...this.durations]; }
}
