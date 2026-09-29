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
  allowReflection?: boolean;
  allowReverse?: boolean;
  aspectRatio?: { min: number; max: number };
  minimumSpan?: number;
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
  candidates?: Array<{ templateId: string; score: number; evidence: boolean; outlineError: number; triangleFitError?: number; failed: string[] }>;
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
  fillRatio: number;
  straightRunFraction: number;
}

interface Candidate {
  template: ShapeTemplate;
  features: ShapeFeatures;
  score: number;
  diagnostics: ShapeDiagnostics;
  evidence: boolean;
  nearEvidence: boolean;
  closureAmbiguous: boolean;
  straightRunFraction: number;
  triangleFit: number;
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
const POLYGON_MATCH_OUTLINE_ERROR = 0.18;
const POLYGON_MATCH_CLOSURE_ERROR = 0.20;
const TRIANGLE_EDGE_FIT_ERROR = 0.055;
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

/** Fit three ordered sides to a closed stroke, allowing a short rounded corner or hook. */
function triangleEdgeFit(points: readonly PathPoint[]): number {
  const cycle = points.slice(0, -1);
  const count = cycle.length;
  if (count < 9) return Infinity;
  let best = Infinity;
  for (let first = 0; first < count - 6; first += 1) {
    for (let second = first + 3; second < count - 3; second += 1) {
      for (let third = second + 3; third < count; third += 1) {
        if (count - third + first < 3) continue;
        const vertices = [cycle[first], cycle[second], cycle[third]];
        const sides = [distance(vertices[0], vertices[1]), distance(vertices[1], vertices[2]),
          distance(vertices[2], vertices[0])];
        const perimeter = sides[0] + sides[1] + sides[2];
        if (Math.min(...sides) < perimeter * 0.16) continue;
        let error = 0;
        let maximum = 0;
        for (let index = 0; index < count; index += 1) {
          const side = index >= first && index < second ? 0
            : index >= second && index < third ? 1 : 2;
          const deviation = perpendicularDistance(cycle[index], vertices[side], vertices[(side + 1) % 3]);
          error += deviation;
          maximum = Math.max(maximum, deviation);
        }
        best = Math.min(best, error / count + maximum * 0.25);
      }
    }
  }
  return best;
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

function fillRatio(points: readonly PathPoint[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index].x * next.y - next.x * points[index].y;
  }
  area = Math.abs(area) / 2;
  let smallestBox = Infinity;
  for (let step = 0; step < 36; step += 1) {
    const angle = Math.PI * step / 36;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const rotated = points.map((point) => ({
      x: point.x * cosine - point.y * sine,
      y: point.x * sine + point.y * cosine,
    }));
    const xs = rotated.map((point) => point.x);
    const ys = rotated.map((point) => point.y);
    smallestBox = Math.min(smallestBox,
      (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)));
  }
  return smallestBox <= Number.EPSILON ? 0 : area / smallestBox;
}

function straightRunFraction(points: readonly PathPoint[]): number {
  const total = pathLength(points);
  if (points.length < 3 || total <= Number.EPSILON) return 0;
  let longest = 0;
  for (let start = 0; start < points.length - 2; start += 1) {
    let runLength = distance(points[start], points[start + 1]);
    for (let end = start + 2; end < points.length; end += 1) {
      runLength += distance(points[end - 1], points[end]);
      const chord = distance(points[start], points[end]);
      if (chord <= 0.05) continue;
      let deviation = 0;
      for (let middle = start + 1; middle < end; middle += 1) {
        deviation = Math.max(deviation, perpendicularDistance(points[middle], points[start], points[end]));
      }
      if (deviation <= 0.025) longest = Math.max(longest, runLength / total);
    }
  }
  return longest;
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
    fillRatio: fillRatio(resampled),
    straightRunFraction: straightRunFraction(resampled),
  };
}

/** Compare ordered, equally spaced outlines after allowed transformations. */
function alignedOutlineError(attempt: ShapeFeatures, template: ShapeFeatures, policy: ShapeTemplate): number {
  const closed = topologyFor(policy) === 'closed';
  const a = closed ? attempt.points.slice(0, -1) : attempt.points;
  const b = closed ? template.points.slice(0, -1) : template.points;
  const n = Math.min(a.length, b.length);
  if (n === 0) return 1;
  let best = Infinity;
  const angles = policy.allowRotation ? 24 : 1;
  for (const reflected of policy.allowReflection ? [false, true] : [false]) {
    for (const reversed of policy.allowReverse || closed ? [false, true] : [false]) {
      for (let turn = 0; turn < angles; turn += 1) {
        const theta = 2 * Math.PI * turn / angles;
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        const rotated = a.map((p) => {
          const x = reflected ? -p.x : p.x;
          return { x: x * c - p.y * s, y: x * s + p.y * c };
        });
        for (let shift = 0; shift < (closed ? n : 1); shift += 1) {
          let error = 0;
          for (let i = 0; i < n; i += 1) {
            const index = reversed ? (shift - i + n) % n : (shift + i) % n;
            error += distance(rotated[index], b[i]);
          }
          best = Math.min(best, error / n);
        }
      }
    }
  }
  return best;
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

function allowedTurnError(attempt: ShapeFeatures, template: ShapeFeatures, policy: ShapeTemplate): number {
  const direct = angleDirectionError(attempt, template);
  if (!policy.allowReflection) return direct;
  const reflected = { ...attempt, turnSigns: attempt.turnSigns.map((sign) => -sign) };
  return Math.min(direct, angleDirectionError(reflected, template));
}

function aspectError(attempt: ShapeFeatures, template: ShapeTemplate, templateFeatures: ShapeFeatures): number {
  if (template.allowRotation && !template.aspectRatio) return 0;
  if (template.aspectRatio) {
    if (attempt.aspectRatio >= template.aspectRatio.min && attempt.aspectRatio <= template.aspectRatio.max) return 0;
    const distanceOutside = attempt.aspectRatio < template.aspectRatio.min
      ? template.aspectRatio.min - attempt.aspectRatio
      : attempt.aspectRatio - template.aspectRatio.max;
    return clamp(distanceOutside / Math.max(template.aspectRatio.max, 1));
  }
  return clamp(Math.abs(Math.log(Math.max(attempt.aspectRatio, 0.1) / Math.max(templateFeatures.aspectRatio, 0.1))) / Math.log(2));
}

function scoreCandidate(attempt: ShapeFeatures, template: ShapeTemplate, templateFeatures: ShapeFeatures, strokeSpan: number): Candidate {
  const topology = topologyFor(template);
  const closure = closureFor(template);
  const geometry = geometryFor(template);
  const triangleRules = geometry === 'polygon' && topology === 'closed' && (template.expectedCorners ?? templateFeatures.corners) === 3;
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
  const turnError = allowedTurnError(attempt, templateFeatures, template);
  const closureError = attempt.closureError;
  const closureErrorValue = closure === 'ignored'
    ? 0
    : closure === 'required' ? clamp(closureError / 0.35) : clamp(closureError / 0.55);
  const endpointError = distance(attempt.points[attempt.points.length - 1], templateFeatures.points[templateFeatures.points.length - 1]);
  const lengthRatio = templateFeatures.length <= Number.EPSILON ? 0 : attempt.length / templateFeatures.length;
  const lengthError = lengthRatio <= Number.EPSILON ? 1 : clamp(Math.abs(Math.log(lengthRatio)) / Math.log(2));
  const outlineError = alignedOutlineError(attempt, templateFeatures, template);
  const triangleFit = triangleRules ? triangleEdgeFit(attempt.points) : Infinity;
  const flexibleTriangle = triangleRules && triangleFit <= TRIANGLE_EDGE_FIT_ERROR
    && attempt.fillRatio >= 0.35 && attempt.fillRatio <= 0.66
    && cornerError <= 0.35 && attempt.closureError <= POLYGON_MATCH_CLOSURE_ERROR;
  const diagnostics: ShapeDiagnostics = {
    pointError: outlineError,
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
  const outlineFit = 1 - clamp(outlineError / 0.32);
  const combinedScore = geometry === 'circle' ? baseScore * 0.85 + outlineFit * 0.15 : baseScore * 0.70 + outlineFit * 0.30;
  const score = topologyMustMatch || (strictDirection && directionErrorValue > 0.55)
    ? Math.min(combinedScore, NEAR_MISS_THRESHOLD)
    : combinedScore;
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
  const geometryEvidence = geometry === 'circle'
    ? closureCompatible && circleGeometryCompatible && attempt.coverageError <= 0.35
      && attempt.straightRunFraction <= 0.20
    : triangleRules
      ? closureCompatible && attempt.fillRatio <= 0.66 && cornerError <= 0.35
        && (cornerError <= 0.25 || outlineError <= POLYGON_MATCH_OUTLINE_ERROR || flexibleTriangle)
      : closureCompatible && cornerError <= 0.25 && polylineGeometryCompatible;
  const matchFit = geometry === 'circle' ? true
    : triangleRules
      ? (outlineError <= POLYGON_MATCH_OUTLINE_ERROR || flexibleTriangle)
        && attempt.closureError <= POLYGON_MATCH_CLOSURE_ERROR
      : outlineError <= 0.26;
  const sizeCompatible = strokeSpan >= (template.minimumSpan ?? 0);
  const evidence = geometryEvidence && matchFit && sizeCompatible;
  return {
    template,
    features: templateFeatures,
    score,
    diagnostics,
    evidence,
    nearEvidence: sizeCompatible && (geometry === 'circle'
      ? closureCompatible && attempt.coverageError <= 0.35
        && attempt.radialError <= 0.55 && attempt.corners >= 5
      : geometryEvidence),
    closureAmbiguous: attempt.closureAmbiguous,
    straightRunFraction: attempt.straightRunFraction,
    triangleFit,
  };
}

function correctionFor(candidate: Candidate): string {
  const { diagnostics, template } = candidate;
  if (diagnostics.topologyError > 0.35) {
    return topologyFor(template) === 'closed' ? 'Bring the end back near the start' : 'Leave the shape open';
  }
  if (geometryFor(template) === 'circle' && candidate.straightRunFraction > 0.20) return 'Round off the straight sections';
  if (geometryFor(template) === 'circle' && diagnostics.radialError > 0.35) return 'Make the loop rounder';
  if (geometryFor(template) === 'circle' && diagnostics.coverageError > 0.35) return 'Complete more of the circular loop';
  if (diagnostics.cornerError > 0 || diagnostics.turnError > 0) {
    const corners = template.expectedCorners ?? candidate.features.corners;
    return `Use about ${corners} clear turn${corners === 1 ? '' : 's'}`;
  }
  if (diagnostics.closureError > 0.25 && closureFor(template) !== 'ignored') return 'Finish closer to where you started';
  if (diagnostics.aspectRatioError > 0.35) return 'Make the shape wider or taller';
  if (diagnostics.directionError > 0.35) return 'Start the gesture in the expected direction';
  if (diagnostics.pointError > 0.18) return 'Follow the outline more closely';
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

    const aspectRatio = 'points' in stroke ? stroke.aspectRatio ?? 1 : 1;
    const corrected = cleaned.map((point) => ({ x: point.x * aspectRatio, y: point.y }));
    const strokeSpan = Math.hypot(
      Math.max(...corrected.map((point) => point.x)) - Math.min(...corrected.map((point) => point.x)),
      Math.max(...corrected.map((point) => point.y)) - Math.min(...corrected.map((point) => point.y)),
    );
    const attempt = extractFeatures(corrected);
    const candidates = this.templates.map((template) => {
      const templateFeatures = extractFeatures(deduplicate(template.points));
      return scoreCandidate(attempt, template, templateFeatures, strokeSpan);
    }).sort((a, b) => b.score - a.score);
    const summaries = candidates.map((candidate) => {
      const { template, diagnostics } = candidate;
      const geometry = geometryFor(template);
      const topology = topologyFor(template);
      const triangleRules = geometry === 'polygon' && topology === 'closed'
        && (template.expectedCorners ?? candidate.features.corners) === 3;
      const closureLimit = closureFor(template) === 'required' ? CLOSED_INTENT_THRESHOLD : OPEN_INTENT_THRESHOLD;
      const matchClosureLimit = triangleRules ? POLYGON_MATCH_CLOSURE_ERROR : closureLimit;
      const closureFailed = topology === 'closed' ? diagnostics.closureError > matchClosureLimit
        : topology === 'open' && diagnostics.closureError < OPEN_INTENT_THRESHOLD;
      const circleFailed = geometry === 'circle' && !(diagnostics.radialError <= 0.30
        || (diagnostics.radialError <= 0.45 && attempt.corners >= 5));
      return {
        templateId: template.id,
        score: candidate.score,
        evidence: candidate.evidence,
        outlineError: diagnostics.pointError,
        ...(triangleRules ? { triangleFitError: candidate.triangleFit } : {}),
        failed: [
          closureFailed ? 'topology' : '',
          triangleRules && diagnostics.cornerError > 0.35 ? 'corners' : '',
          triangleRules && attempt.fillRatio > 0.66 ? 'filled area' : '',
          !triangleRules && geometry !== 'circle' && diagnostics.cornerError > 0.25 ? 'corners' : '',
          triangleRules && diagnostics.pointError > POLYGON_MATCH_OUTLINE_ERROR && !candidate.evidence ? 'outline' : '',
          !triangleRules && geometry !== 'circle' && diagnostics.pointError > 0.26 ? 'outline' : '',
          circleFailed ? 'roundness' : '',
          geometry === 'circle' && attempt.straightRunFraction > 0.20 ? 'straight sections' : '',
          geometry === 'circle' && diagnostics.coverageError > 0.35 ? 'loop coverage' : '',
          geometry === 'polyline' && (template.expectedCorners ?? 0) > 0 && diagnostics.turnError > 0.25 ? 'turn order' : '',
          template.direction && template.direction !== 'any' && !template.allowRotation
            && diagnostics.directionError > 0.55 ? 'direction' : '',
        ].filter(Boolean),
      };
    });
    const evidencedCandidates = candidates.filter((candidate) => candidate.evidence);
    const coachingCandidates = candidates.filter((candidate) => candidate.nearEvidence && candidate.score >= NEAR_MISS_THRESHOLD);
    if (evidencedCandidates.length === 0 && coachingCandidates.length === 0) {
      return { ...emptyEvaluation('unrecognized'), candidates: summaries };
    }

    const best = evidencedCandidates[0] ?? coachingCandidates[0];
    const second = (evidencedCandidates.length ? evidencedCandidates : coachingCandidates)
      .find((candidate) => candidate.template.id !== best.template.id);
    const ambiguous = Boolean(second && best.score - second.score < AMBIGUITY_MARGIN);
    const convincing = best.evidence
      && best.score >= MATCH_THRESHOLD
      && !ambiguous
      && !best.closureAmbiguous;
    const nearMiss = best.nearEvidence && best.score >= NEAR_MISS_THRESHOLD && !ambiguous;
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
      correction: status === 'matched' ? undefined : ambiguous
        ? 'Several runes look possible; draw a clearer outline'
        : status === 'near-miss' ? correctionFor(best) : 'No supported shape matched',
      ambiguous,
      diagnostics: best.diagnostics,
      candidates: summaries,
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
    allowReflection: true,
    allowReverse: true,
    points: [
      { x: 0.2, y: 0.7 },
      { x: 0.4, y: 0.25 },
      { x: 0.6, y: 0.7 },
      { x: 0.8, y: 0.25 },
    ],
  },
  {
    id: 'hourglass',
    name: 'Twin triangle rune',
    geometry: 'polygon',
    topology: 'closed',
    expectedCorners: 6,
    cornerTolerance: 2,
    closure: 'preferred',
    allowRotation: true,
    points: [
      { x: 0.5, y: 0.5 },
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.5, y: 0.5 },
      { x: 0.2, y: 0.8 },
      { x: 0.8, y: 0.8 },
      { x: 0.5, y: 0.5 },
    ],
  },
  {
    id: 'square',
    name: 'Square rune',
    geometry: 'polygon',
    topology: 'closed',
    expectedCorners: 4,
    cornerTolerance: 1,
    closure: 'required',
    allowRotation: true,
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
      { x: 0.2, y: 0.2 },
    ],
  },
  {
    id: 'line',
    name: 'Line rune',
    geometry: 'polyline',
    topology: 'open',
    expectedCorners: 0,
    cornerTolerance: 0,
    closure: 'ignored',
    direction: 'any',
    allowRotation: true,
    allowReverse: true,
    minimumSpan: 0.2,
    points: [
      { x: 0.2, y: 0.5 },
      { x: 0.4, y: 0.5 },
      { x: 0.6, y: 0.5 },
      { x: 0.8, y: 0.5 },
    ],
  },
];
