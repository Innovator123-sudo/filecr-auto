export type Vec2 = { x: number; y: number };
export type Landmark = { x: number; y: number; z: number; visibility: number };

export const CRITICAL_INDICES = {
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
} as const;

// Upper-body skeleton only: head -> shoulders -> arms -> hips (no legs)
export const SKELETON_CONNECTIONS: [number, number][] = [
  [0, 11], [0, 12],
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
];
export const SKELETON_MAX_LANDMARK = 24; // skip knees/ankles/feet dots

export type PoseState = 'UP' | 'MID' | 'DOWN';
export type TrackingStatus = 'tracking' | 'lost' | 'paused';

export interface RepEvent {
  repNumber: number;
  timestamp: number;
  formScore: number;
  elbowAngle: number;
  hipAngle: number;
  kneeAngle?: number;
  durationMs: number;
}

export interface EngineStats {
  repCount: number;
  state: PoseState;
  status: TrackingStatus;
  elbowAngle: number;
  hipAngle: number;
  kneeAngle?: number;
  formScore: number;
  lastRep?: RepEvent;
}

export interface CalibrationResult {
  personalUpThreshold: number;
  personalDownThreshold: number;
  armLengthPx: number;
  neutralElbow: number;
}
