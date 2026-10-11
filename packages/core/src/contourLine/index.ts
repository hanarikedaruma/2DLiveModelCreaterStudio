// 輪郭線（I-068）。公開するものだけをここから export する
export { contourBasis, contourKnots, contourSamples, type ContourBasis } from './spline';
export { attachPoint, attachedPoint, contourOnMesh, type ContourOnMesh, type MeshAttachment } from './attach';
export { contourFalloff, contourShapeValid, distanceToLine, spreadAlongLine } from './field';
export { fitLineMotion } from './fit';
