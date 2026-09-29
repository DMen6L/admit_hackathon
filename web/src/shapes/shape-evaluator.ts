import type { PathPoint, RecordedStroke } from '../drawing/path-recorder';

export type ShapeTopology = 'open' | 'closed' | 'either';
export type ShapeDirection = 'any' | 'up' | 'down' | 'left' | 'right';
export type ClosurePolicy = 'required' | 'preferred' | 'ignored';
export type ShapeGeometry = 'circle' | 'polygon' | 'polyline';

export interface ShapeTemplate {
  id: string;
  name: string;
  points: PathPoint[];
  geometry?: ShapeGeometry;
  /** @deprecated Use topology: 'open' | 'closed' | 'either'. */
  closed?: boolean;
  topology?: ShapeTopology;
  expectedCorners?: number;
  cornerTolerance?: number;
  direction?: ShapeDirection;
  closure?: ClosurePolicy;
  allowRotation?: boolean;
  aspectRatio?: { min: number; max: number };
}

export interface ShapeDiagnostics {
  pointError: number;
  directionError: number;
  endpointError: number;
  closureError: number;
  lengthRatio: number;
  topologyError: number;
  cornerError: number;
  aspectRatioError: number;
  turnError: number;
  radialError: number;
  coverageError: number;
}

export type ShapeEvaluationStatus = 'matched' | 'near-miss' | 'unrecognized' | 'insufficient';

export interface ShapeEvaluation {
  status: ShapeEvaluationStatus;
  templateId?: string;
  templateName?: string;
  score: number;
  correction?: string;
  ambiguous: boolean;
  diagnostics: ShapeDiagnostics;
}

interface ShapeFeatures {
  points: PathPoint[];
  length: number;
  aspectRatio: number;
  closureError: number;
  closedIntentScore: number;
  openIntentScore: number;
  closureAmbiguous: boolean;
  isClosed: boolean;
  corners: number;
  turnSigns: number[];
  directionAngle: number;
  radialError: number;
  coverageError: number;
}

interface Candidate {
  template: ShapeTemplate;
  features: ShapeFeatures;
  score: number;
  diagnostics: ShapeDiagnostics;
  evidence: boolean;
  closureAmbiguous: boolean;
}

const RESAMPLE_POINTS = 24;
const MIN_PATH_LENGTH = 0.035;
const SIMPLIFY_TOLERANCE = 0.08;
const TURN_ANGLE_THRESHOLD = Math.PI / 5;
const CLOSED_GEOMETRY_THRESHOLD = 0.55;
const CLOSED_INTENT_THRESHOLD = 0.45;
const OPEN_INTENT_THRESHOLD = 0.55;
const MATCH_THRESHOLD = 0.60;
const NEAR_MISS_THRESHOLD = 0.40;
const AMBIGUITY_MARGIN = 0.08;
const ZERO_DIAGNOSTICS: ShapeDiagnostics = {
  pointError: 1,
  directionError: 1,
  endpointError: 1,
  closureError: 1,
  lengthRatio: 0,
  topologyError: 1,
  cornerError: 1,
  aspectRatioError: 1,
  turnError: 1,
  radialError: 1,
  coverageError: 1,
};

function distance(a: PathPoint, b: PathPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function pathLength(points: readonly PathPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += distance(points[index - 1], points[index]);
  }
  return length;
}

function deduplicate(points: readonly PathPoint[]): PathPoint[] {
  if (points.length === 0) return [];
  const result = [{ ...points[0] }];
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    const isClosingPoint = index === points.length - 1 && distance(point, points[0]) < 0.001;
    if (isClosingPoint || distance(result[result.length - 1], point) >= 0.001) result.push({ ...point });
  }
  return result;
}

function resample(points: readonly PathPoint[], count: number): PathPoint[] {
  if (points.length === 0) return [];
  if (points.length === 1) return Array.from({ length: count }, () => ({ ...points[0] }));

  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + distance(points[index - 1], points[index]));
  }
  const total = cumulative[cumulative.length - 1];
  if (total <= Number.EPSILON) return Array.from({ length: count }, () => ({ ...points[0] }));

  const sampled: PathPoint[] = [];
  let segment = 1;
  for (let sample = 0; sample < count; sample += 1) {
    const target = total * sample / (count - 1);
    while (segment < cumulative.length - 1 && cumulative[segment] < target) segment += 1;
    const startDistance = cumulative[segment - 1];
    const segmentLength = cumulative[segment] - startDistance;
    const ratio = segmentLength <= Number.EPSILON ? 0 : (target - startDistance) / segmentLength;
    const start = points[segment - 1];
    const end = points[segment];
    sampled.push({
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio,
    });
  }
  return sampled;
}

function perpendicularDistance(point: PathPoint, start: PathPoint, end: PathPoint): number {
  const lineLength = distance(start, end);
  if (lineLength <= Number.EPSILON) return distance(point, start);
  return Math.abs(
    (end.x - start.x) * (start.y - point.y) - (start.x - point.x) * (end.y - start.y),
  ) / lineLength;
}

function simplify(points: readonly PathPoint[], tolerance: number): PathPoint[] {
  if (points.length <= 2) return points.map((point) => ({ ...point }));
  const end = points.length - 1;
  let split = -1;
  let maximum = tolerance;
  for (let index = 1; index < end; index += 1) {
    const deviation = perpendicularDistance(points[index], points[0], points[end]);
    if (deviation > maximum) {
      maximum = deviation;
      split = index;
    }
  }
  if (split < 0) return [{ ...points[0] }, { ...points[end] }];
  const left = simplify(points.slice(0, split + 1), tolerance);
  const right = simplify(points.slice(split), tolerance);
  return [...left.slice(0, -1), ...right];
}

function normalize(points: readonly PathPoint[]): { points: PathPoint[]; width: number; height: number } {
  if (points.length === 0) return { points: [], width: 0, height: 0 };
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const width = maxX - minX;
  const height = maxY - minY;
  const scale = Math.max(width, height);
  if (scale <= Number.EPSILON) return { points: points.map(() => ({ x: 0, y: 0 })), width: 0, height: 0 };
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return {
    points: points.map((point) => ({
      x: (point.x - centerX) / scale,
      y: (point.y - centerY) / scale,
    })),
    width: width / scale,
    height: height / scale,
  };
}

function angleBetween(a: PathPoint, b: PathPoint): number {
  const aLength = Math.hypot(a.x, a.y);
  const bLength = Math.hypot(b.x, b.y);
  if (aLength <= Number.EPSILON || bLength <= Number.EPSILON) return 0;
  return Math.acos(clamp((a.x * b.x + a.y * b.y) / (aLength * bLength), -1, 1));
}

function turnAt(previous: PathPoint, current: PathPoint, next: PathPoint): { angle: number; sign: number } {
  const incoming = { x: current.x - previous.x, y: current.y - previous.y };
  const outgoing = { x: next.x - current.x, y: next.y - current.y };
  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
  return {
    angle: angleBetween(incoming, outgoing),
    sign: Math.sign(cross),
  };
}

function cornerFeatures(points: readonly PathPoint[], isClosed: boolean): { count: number; signs: number[] } {
  const cycle = isClosed
    ? points.slice(0, -1)
    : [...points];
  const signs: number[] = [];
  const start = isClosed ? 0 : 1;
  const end = isClosed ? cycle.length : cycle.length - 1;
  for (let index = start; index < end; index += 1) {
    const previous = cycle[(index - 1 + cycle.length) % cycle.length];
    const current = cycle[index % cycle.length];
    const next = cycle[(index + 1) % cycle.length];
    const turn = turnAt(previous, current, next);
    if (turn.angle >= TURN_ANGLE_THRESHOLD) signs.push(turn.sign);
  }
  return { count: signs.length, signs };
}

function topologyFor(template: ShapeTemplate): ShapeTopology {
  if (template.topology) return template.topology;
  if (template.closed !== undefined) return template.closed ? 'closed' : 'open';
  return 'either';
}

function closureFor(template: ShapeTemplate): ClosurePolicy {
  if (template.closure) return template.closure;
  return topologyFor(template) === 'closed' ? 'preferred' : 'ignored';
}

function geometryFor(template: ShapeTemplate): ShapeGeometry {
  if (template.geometry) return template.geometry;
  if (template.topology === 'open' || template.closed === false) return 'polyline';
  if (template.expectedCorners === 0) return 'circle';
  return 'polygon';
}

function extractFeatures(points: readonly PathPoint[]): ShapeFeatures {
  const normalized = normalize(points);
  const resampled = resample(normalized.points, RESAMPLE_POINTS);
  const closureError = resampled.length > 1 ? distance(resampled[0], resampled[resampled.length - 1]) : 1;
  const closedIntentScore = 1 - clamp(closureError / OPEN_INTENT_THRESHOLD);
  const openIntentScore = clamp((closureError - CLOSED_INTENT_THRESHOLD) / (OPEN_INTENT_THRESHOLD - CLOSED_INTENT_THRESHOLD));
  const closureAmbiguous = closureError > CLOSED_INTENT_THRESHOLD && closureError < OPEN_INTENT_THRESHOLD;
  const isClosed = closureError <= CLOSED_GEOMETRY_THRESHOLD;
  const simplified = simplify(resampled, SIMPLIFY_TOLERANCE);
  const corners = cornerFeatures(simplified, isClosed);
  const center = resampled.reduce((sum, point) => ({
    x: sum.x + point.x / resampled.length,
    y: sum.y + point.y / resampled.length,
  }), { x: 0, y: 0 });
  const radii = resampled.map((point) => distance(point, center));
  const meanRadius = radii.reduce((sum, radius) => sum + radius, 0) / Math.max(radii.length, 1);
  const radialVariance = radii.reduce((sum, radius) => sum + (radius - meanRadius) ** 2, 0)
    / Math.max(radii.length, 1);
  const radialError = meanRadius <= Number.EPSILON
    ? 1
    : clamp(Math.sqrt(radialVariance) / meanRadius / 0.35);
  const occupiedAngleBins = new Set(resampled.map((point) => {
    const angle = Math.atan2(point.y - center.y, point.x - center.x);
    return Math.floor(((angle + Math.PI) / (Math.PI * 2)) * 16);
  }));
  const coverageError = 1 - occupiedAngleBins.size / 16;
  const direction = resampled.length > 1
    ? Math.atan2(resampled[resampled.length - 1].y - resampled[0].y, resampled[resampled.length - 1].x - resampled[0].x)
    : 0;
  return {
    points: resampled,
    length: pathLength(resampled),
    aspectRatio: normalized.height <= Number.EPSILON ? 10 : normalized.width / normalized.height,
    closureError,
    closedIntentScore,
    openIntentScore,
    closureAmbiguous,
    isClosed,
    corners: corners.count,
    turnSigns: corners.signs,
    directionAngle: direction,
    radialError,
    coverageError,
  };
}

function directionError(attempt: ShapeFeatures, template: ShapeTemplate): number {
  if (template.allowRotation || !template.direction || template.direction === 'any' || attempt.isClosed) return 0;
  const expected = {
    up: -Math.PI / 2,
    down: Math.PI / 2,
    left: Math.PI,
    right: 0,
  }[template.direction];
  let delta = Math.abs(attempt.directionAngle - expected);
  if (delta > Math.PI) delta = Math.PI * 2 - delta;
  return delta / Math.PI;
}

function angleDirectionError(attempt: ShapeFeatures, template: ShapeFeatures): number {
  if (attempt.isClosed || template.isClosed || attempt.turnSigns.length === 0 || template.turnSigns.length === 0) return 0;
  const length = Math.max(attempt.turnSigns.length, template.turnSigns.length);
  let mismatches = Math.abs(attempt.turnSigns.length - template.turnSigns.length);
  for (let index = 0; index < Math.min(attempt.turnSigns.length, template.turnSigns.length); index += 1) {
    if (attempt.turnSigns[index] !== template.turnSigns[index]) mismatches += 1;
  }
  return clamp(mismatches / length);
}

function aspectError(attempt: ShapeFeatures, template: ShapeTemplate, templateFeatures: ShapeFeatures): number {
  if (template.aspectRatio) {
    if (attempt.aspectRatio >= template.aspectRatio.min && attempt.aspectRatio <= template.aspectRatio.max) return 0;
    const distanceOutside = attempt.aspectRatio < template.aspectRatio.min
      ? template.aspectRatio.min - attempt.aspectRatio
      : attempt.aspectRatio - template.aspectRatio.max;
    return clamp(distanceOutside / Math.max(template.aspectRatio.max, 1));
  }
  return clamp(Math.abs(Math.log(Math.max(attempt.aspectRatio, 0.1) / Math.max(templateFeatures.aspectRatio, 0.1))) / Math.log(2));
}

function scoreCandidate(attempt: ShapeFeatures, template: ShapeTemplate, templateFeatures: ShapeFeatures): Candidate {
  const topology = topologyFor(template);
  const closure = closureFor(template);
  const geometry = geometryFor(template);
  const topologyFit = topology === 'either'
    ? 1
    : topology === 'closed' ? attempt.closedIntentScore : attempt.openIntentScore;
  const topologyError = 1 - topologyFit;
  const topologyScore = topologyFit;
  const expectedCorners = template.expectedCorners ?? templateFeatures.corners;
  const cornerTolerance = template.cornerTolerance ?? 0;
  const cornerDifference = Math.abs(attempt.corners - expectedCorners);
  const cornerError = cornerDifference <= cornerTolerance
    ? 0
    : clamp((cornerDifference - cornerTolerance) / Math.max(expectedCorners, 2));
  const aspectRatioError = aspectError(attempt, template, templateFeatures);
  const directionErrorValue = directionError(attempt, template);
  const turnError = angleDirectionError(attempt, templateFeatures);
  const closureError = attempt.closureError;
  const closureErrorValue = closure === 'ignored'
    ? 0
    : closure === 'required' ? clamp(closureError / 0.35) : clamp(closureError / 0.55);
  const endpointError = distance(attempt.points[attempt.points.length - 1], templateFeatures.points[templateFeatures.points.length - 1]);
  const lengthRatio = templateFeatures.length <= Number.EPSILON ? 0 : attempt.length / templateFeatures.length;
  const lengthError = lengthRatio <= Number.EPSILON ? 1 : clamp(Math.abs(Math.log(lengthRatio)) / Math.log(2));
  const pointError = attempt.points.reduce((total, point, index) => total + distance(point, templateFeatures.points[index]), 0)
    / attempt.points.length;
  const diagnostics: ShapeDiagnostics = {
    pointError,
    directionError: directionErrorValue,
    endpointError,
    closureError,
    lengthRatio,
    topologyError,
    cornerError,
    aspectRatioError,
    turnError,
    radialError: attempt.radialError,
    coverageError: attempt.coverageError,
  };
  const circleError = attempt.radialError * 0.65 + attempt.coverageError * 0.35;
  const strictDirection = Boolean(template.direction && template.direction !== 'any' && !template.allowRotation);
  const baseScore = geometry === 'circle'
    ? clamp(
      topologyScore * 0.20
        + (1 - circleError) * 0.50
        + (1 - closureErrorValue) * 0.15
        + (1 - aspectRatioError) * 0.10
        + (1 - lengthError) * 0.05,
    )
    : clamp(
      topologyScore * 0.25
        + (1 - cornerError) * 0.30
        + (1 - aspectRatioError) * 0.15
        + (1 - closureErrorValue) * 0.15
        + (1 - directionErrorValue) * 0.10
        + (1 - lengthError) * 0.05,
    );
  const topologyMustMatch = topology === 'open' && attempt.openIntentScore < 1;
  const score = topologyMustMatch || (strictDirection && directionErrorValue > 0.55)
    ? Math.min(baseScore, NEAR_MISS_THRESHOLD)
    : baseScore;
  const maximumClosedClosureError = closure === 'required'
    ? CLOSED_INTENT_THRESHOLD
    : OPEN_INTENT_THRESHOLD;
  const closureCompatible = topology === 'closed'
    ? attempt.closureError <= maximumClosedClosureError
    : topology !== 'open' || attempt.closureError >= OPEN_INTENT_THRESHOLD;
  const circleGeometryCompatible = geometry !== 'circle'
    || attempt.radialError <= 0.30
    || (attempt.radialError <= 0.45 && attempt.corners >= 5);
  const polylineGeometryCompatible = geometry !== 'polyline'
    || expectedCorners === 0
    || (attempt.corners >= expectedCorners && turnError <= 0.25);
  const evidence = geometry === 'circle'
    ? closureCompatible && circleGeometryCompatible && attempt.coverageError <= 0.35
    : closureCompatible && cornerError <= 0.25 && polylineGeometryCompatible;
  return {
    template,
    features: templateFeatures,
    score,
    diagnostics,
    evidence,
    closureAmbiguous: attempt.closureAmbiguous,
  };
}

function correctionFor(candidate: Candidate): string {
  const { diagnostics, template } = candidate;
  if (diagnostics.topologyError > 0) {
    return topologyFor(template) === 'closed' ? 'Bring the end back near the start' : 'Leave the shape open';
  }
  if (diagnostics.cornerError > 0 || diagnostics.turnError > 0) {
    const corners = template.expectedCorners ?? candidate.features.corners;
    return `Use about ${corners} clear turn${corners === 1 ? '' : 's'}`;
  }
  if (geometryFor(template) === 'circle' && diagnostics.radialError > 0.35) return 'Make the loop rounder';
  if (geometryFor(template) === 'circle' && diagnostics.coverageError > 0.35) return 'Complete more of the circular loop';
  if (diagnostics.closureError > 0.25 && closureFor(template) !== 'ignored') return 'Finish closer to where you started';
  if (diagnostics.aspectRatioError > 0.35) return 'Make the shape wider or taller';
  if (diagnostics.directionError > 0.35) return 'Start the gesture in the expected direction';
  return 'Follow the broad outline more closely';
}

function emptyEvaluation(status: 'insufficient' | 'unrecognized'): ShapeEvaluation {
  return {
    status,
    score: 0,
    correction: status === 'unrecognized' ? 'No supported shape matched' : undefined,
    ambiguous: false,
    diagnostics: { ...ZERO_DIAGNOSTICS },
  };
}

export class ShapeEvaluator {
  private readonly templates: ShapeTemplate[];

  constructor(templates: readonly ShapeTemplate[]) {
    this.templates = templates.map((template) => ({
      ...template,
      points: template.points.map((point) => ({ ...point })),
    }));
  }

  evaluate(stroke: RecordedStroke | readonly PathPoint[]): ShapeEvaluation {
    const source = 'points' in stroke ? stroke.points : stroke;
    const cleaned = deduplicate(source);
    const rawLength = pathLength(cleaned);
    if (cleaned.length < 4 || rawLength < MIN_PATH_LENGTH || this.templates.length === 0) {
      return emptyEvaluation(cleaned.length < 4 || rawLength < MIN_PATH_LENGTH ? 'insufficient' : 'unrecognized');
    }

    const attempt = extractFeatures(cleaned);
    const candidates = this.templates.map((template) => {
      const templateFeatures = extractFeatures(deduplicate(template.points));
      return scoreCandidate(attempt, template, templateFeatures);
    }).sort((a, b) => b.score - a.score);
    const evidencedCandidates = candidates.filter((candidate) => candidate.evidence);
    if (evidencedCandidates.length === 0) return emptyEvaluation('unrecognized');

    const best = evidencedCandidates[0];
    const second = evidencedCandidates[1];
    const ambiguous = Boolean(second && best.score - second.score < AMBIGUITY_MARGIN);
    const convincing = best.evidence
      && best.score >= MATCH_THRESHOLD
      && !ambiguous
      && !best.closureAmbiguous;
    const nearMiss = best.evidence && best.score >= NEAR_MISS_THRESHOLD && !ambiguous;
    const status: ShapeEvaluationStatus = convincing
      ? 'matched'
      : nearMiss
        ? 'near-miss'
        : 'unrecognized';
    return {
      status,
      templateId: status === 'unrecognized' ? undefined : best.template.id,
      templateName: status === 'unrecognized' ? undefined : best.template.name,
      score: best.score,
      correction: status === 'matched' ? undefined : status === 'near-miss'
        ? correctionFor(best)
        : 'No supported shape matched',
      ambiguous,
      diagnostics: best.diagnostics,
    };
  }
}

function circleTemplate(): PathPoint[] {
  return Array.from({ length: 33 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 32;
    return { x: 0.5 + Math.cos(angle) * 0.35, y: 0.5 + Math.sin(angle) * 0.35 };
  });
}

export const DEFAULT_SHAPE_TEMPLATES: ShapeTemplate[] = [
  {
    id: 'triangle',
    name: 'Triangle rune',
    geometry: 'polygon',
    topology: 'closed',
    expectedCorners: 3,
    cornerTolerance: 0,
    closure: 'preferred',
    allowRotation: true,
    points: [
      { x: 0.25, y: 0.75 },
      { x: 0.5, y: 0.2 },
      { x: 0.75, y: 0.75 },
      { x: 0.25, y: 0.75 },
    ],
  },
  {
    id: 'circle',
    name: 'Circle rune',
    geometry: 'circle',
    topology: 'closed',
    expectedCorners: 0,
    cornerTolerance: 2,
    closure: 'preferred',
    allowRotation: true,
    points: circleTemplate(),
  },
  {
    id: 'zigzag',
    name: 'Lightning rune',
    geometry: 'polyline',
    topology: 'open',
    expectedCorners: 2,
    cornerTolerance: 1,
    closure: 'ignored',
    direction: 'any',
    allowRotation: true,
    points: [
      { x: 0.2, y: 0.7 },
      { x: 0.4, y: 0.25 },
      { x: 0.6, y: 0.7 },
      { x: 0.8, y: 0.25 },
    ],
  },
];
