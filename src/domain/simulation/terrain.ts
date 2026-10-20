export interface TerrainPoint {
  readonly xM: number;
  readonly heightM: number;
}

export interface TerrainDefinition {
  readonly id: string;
  readonly points: readonly TerrainPoint[];
  readonly maxSlopeDegrees: number;
  readonly maxCurvaturePerM: number;
}

export interface TerrainSample {
  readonly xM: number;
  readonly heightM: number;
  readonly slope: number;
  readonly slopeDegrees: number;
  readonly curvaturePerM: number;
}

export interface TerrainSampler {
  readonly id: string;
  readonly lengthM: number;
  sample(xM: number): TerrainSample;
}

export function createTerrainSampler(definition: TerrainDefinition): TerrainSampler {
  if (!definition.id || definition.points.length < 2
    || !Number.isFinite(definition.maxSlopeDegrees) || definition.maxSlopeDegrees < 0 || definition.maxSlopeDegrees > 10
    || !Number.isFinite(definition.maxCurvaturePerM) || definition.maxCurvaturePerM < 0) {
    throw new RangeError('地形定义无效；样板坡度上限不得超过 10°。');
  }
  const points = definition.points.map(point => ({ ...point }));
  const slopeLimit = Math.tan(definition.maxSlopeDegrees * Math.PI / 180);
  for (const [index, point] of points.entries()) {
    if (!Number.isFinite(point.xM) || !Number.isFinite(point.heightM) || (index === 0 && point.xM !== 0)) {
      throw new RangeError('地形坐标必须为有限米制数值，起点必须为 0。');
    }
    if (index === 0) continue;
    const previous = points[index - 1];
    const lengthM = point.xM - previous.xM;
    const riseM = Math.abs(point.heightM - previous.heightM);
    if (!Number.isFinite(lengthM) || !Number.isFinite(riseM) || lengthM <= 0 || 1.875 * riseM / lengthM > slopeLimit
      || (10 * Math.sqrt(3) / 3) * riseM / lengthM ** 2 > definition.maxCurvaturePerM) {
      throw new RangeError('地形节点必须递增，且每段解析最大坡度和曲率不得超限。');
    }
  }
  const lengthM = points[points.length - 1].xM;
  return {
    id: definition.id,
    lengthM,
    sample(xM) {
      if (!Number.isFinite(xM)) throw new RangeError('采样位置必须为有限米制数值。');
      const positionM = Math.min(lengthM, Math.max(0, xM));
      const endIndex = points.findIndex((point, index) => index > 0 && point.xM >= positionM);
      const start = points[endIndex - 1];
      const end = points[endIndex];
      const segmentM = end.xM - start.xM;
      const fraction = (positionM - start.xM) / segmentM;
      const riseM = end.heightM - start.heightM;
      const blend = fraction ** 3 * (10 - 15 * fraction + 6 * fraction ** 2);
      const slope = riseM / segmentM * 30 * fraction ** 2 * (1 - fraction) ** 2 || 0;
      const curvaturePerM = riseM / segmentM ** 2 * 60 * fraction * (1 - fraction) * (1 - 2 * fraction) || 0;
      return { xM: positionM, heightM: start.heightM + riseM * blend, slope,
        slopeDegrees: Math.atan(slope) * 180 / Math.PI, curvaturePerM };
    },
  };
}
