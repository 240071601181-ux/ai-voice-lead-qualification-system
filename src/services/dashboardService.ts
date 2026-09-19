import { pool } from '../database';

export interface QualificationMix {
  total: number;
  hot: number;
  warm: number;
  cold: number;
}

const toInt = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : 0;
};

/**
 * Phase 17 — real qualification-mix aggregates for the dashboard donut.
 *
 * Counts persisted qualification records by tier (single GROUP BY query —
 * no row fetching). Tiers outside HOT/WARM/COLD are ignored so only the
 * deterministic scorer's outputs shape the chart. Scoring untouched.
 */
export const getQualificationMix = async (): Promise<QualificationMix> => {
  const res = await pool.query(
    'SELECT tier, COUNT(*)::int AS n FROM qualifications GROUP BY tier'
  );
  const mix: QualificationMix = { total: 0, hot: 0, warm: 0, cold: 0 };
  for (const row of res.rows as Array<{ tier: string; n: number }>) {
    const n = toInt(row.n);
    if (row.tier === 'HOT') mix.hot = n;
    else if (row.tier === 'WARM') mix.warm = n;
    else if (row.tier === 'COLD') mix.cold = n;
    else continue;
    mix.total += n;
  }
  return mix;
};
