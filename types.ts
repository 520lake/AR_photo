import { Mesh, Vector3, Quaternion } from 'three';

export interface PhotoUserData {
  originalPosition: Vector3;
  originalRotation: Quaternion;
  originalScale: Vector3;
  
  // New: Target transform for the "Photo Wall" mode
  wallPosition: Vector3;
  wallRotation: Quaternion;
  
  velocity: Vector3;
  isGrabbed: boolean;
  id: string;
  isTrunk?: boolean;
  textureUrl?: string;
  isCustom?: boolean; // Track if this photo has been replaced by user
}

export type ExtendedMesh = Mesh & {
  userData: PhotoUserData;
};

export enum GestureType {
  NONE = 'NONE',
  OPEN_PALM = 'OPEN_PALM', // Now triggers Explosion/Wall
  PINCH = 'PINCH',         // Grabbing
  THUMBS_UP = 'THUMBS_UP'  // Spawning
}