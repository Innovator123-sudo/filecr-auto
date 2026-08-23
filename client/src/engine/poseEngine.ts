// client/src/engine/poseEngine.ts
// Wraps MediaPipe Tasks Vision PoseLandmarker (BlazePose) and drives the
// rep state machine. Runs 100% client-side. Emits smoothed landmarks +
// rep events. Mirrors the Python repo's detection pipeline in the browser.

import {
  PoseLandmarker,
  FilesetResolver,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision';
import { smoothLandmarks } from './math';
import { RepStateMachine, DEFAULT_MACHINE_CONFIG } from './repStateMachine';
import { elbowAngle, hipAngle, meanVisibility } from './math';
import { CRITICAL_INDICES, type Landmark } from './types';
import poseConfig from '../config/pose-config.json';

export interface EngineFrame {
  landmarks: Landmark[]; // smoothed, 33 points
  raw: Landmark[];
  elbowAngle: number;
  hipAngle: number;
  state: 'UP' | 'MID' | 'DOWN';
  status: 'tracking' | 'lost' | 'paused';
  repCount: number;
  formScore: number;
  lastRep?: import('./types').RepEvent;
}

export class PoseEngine {
  private landmarker: PoseLandmarker | null = null;
  private machine = new RepStateMachine();
  private smoothed: Landmark[] | null = null;
  private alpha = (poseConfig as any).smoothingAlpha ?? 0.4;
  private lastVideoTime = -1;
  private running = false;
  private rafId = 0;
  private video: HTMLVideoElement | null = null;
  private onFrame?: (f: EngineFrame) => void;
  private modelPath = (poseConfig as any).pose.modelAssetPath;

  public onRep?: (ev: import('./types').RepEvent) => void;

  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );
    this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: this.modelPath,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: (poseConfig as any).pose.numPoses ?? 1,
      minPoseDetectionConfidence: (poseConfig as any).pose.minPoseDetectionConfidence,
      minPosePresenceConfidence: (poseConfig as any).pose.minPosePresenceConfidence,
      minTrackingConfidence: (poseConfig as any).pose.minTrackingConfidence,
    });
    this.machine.onRep = (ev) => this.onRep?.(ev);
  }

  get isReady() {
    return this.landmarker !== null;
  }

  private detectMode(): 'GPU' | 'CPU' {
    return 'GPU';
  }

  start(video: HTMLVideoElement, onFrame: (f: EngineFrame) => void) {
    this.video = video;
    this.onFrame = onFrame;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.tick();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  private tick() {
    const v = this.video;
    const lm = this.landmarker;
    if (!v || !lm || v.readyState < 2) return;
    if (v.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = v.currentTime;

    let result: PoseLandmarkerResult;
    try {
      result = lm.detectForVideo(v, performance.now());
    } catch (e) {
      return;
    }

    if (!result.landmarks || result.landmarks.length === 0) {
      const f = this.buildFrame(null);
      this.onFrame?.(f);
      return;
    }

    const raw = result.landmarks[0].map((p) => ({
      x: p.x,
      y: p.y,
      z: p.z ?? 0,
      visibility: p.visibility ?? 0,
    })) as Landmark[];

    this.smoothed = smoothLandmarks(this.smoothed, raw, this.alpha);
    this.onFrame?.(this.buildFrame(this.smoothed));
  }

  private buildFrame(lm: Landmark[] | null): EngineFrame {
    if (!lm) {
      return {
        landmarks: [],
        raw: [],
        elbowAngle: 180,
        hipAngle: 180,
        state: this.machine.getState(),
        status: 'lost',
        repCount: this.machine.getRepCount(),
        formScore: 0,
      };
    }
    const I = CRITICAL_INDICES;
    const R = (i: number) => lm[i];
    const eA = elbowAngle(R(I.rightShoulder), R(I.rightElbow), R(I.rightWrist));
    const hA = hipAngle(R(I.rightShoulder), R(I.rightHip), R(I.rightKnee));
    const kA = hipAngle(R(I.rightHip), R(I.rightKnee), R(I.rightAnkle));
    const vis = meanVisibility(lm, [
      I.leftShoulder, I.rightShoulder, I.leftElbow, I.rightElbow,
      I.leftWrist, I.rightWrist, I.leftHip, I.rightHip, I.rightKnee, I.rightAnkle,
    ]);
    const upd = this.machine.update({
      elbowAngle: eA,
      hipAngle: hA,
      kneeAngle: kA,
      meanVisibility: vis,
      now: performance.now(),
    });
    return {
      landmarks: lm,
      raw: lm,
      elbowAngle: eA,
      hipAngle: hA,
      state: upd.state,
      status: upd.status,
      repCount: this.machine.getRepCount(),
      formScore: upd.event?.formScore ?? 0,
      lastRep: upd.event,
    };
  }

  getRepCount() {
    return this.machine.getRepCount();
  }

  reset() {
    this.machine.reset();
  }
}

// Keep TS from complaining about unused dettype
void (null as unknown as ReturnType<PoseEngine['detectMode']>);
