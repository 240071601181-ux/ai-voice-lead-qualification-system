export type QualificationTier = 'HOT' | 'WARM' | 'COLD';

export type BookingIntent = 'explicit' | 'not_explicit' | 'unknown';

export interface QualificationCriterion {
  points: number;
  qualified: boolean;
  reason: string;
}

export interface QualificationDetails {
  criteria: {
    urgency: QualificationCriterion;
    budget: QualificationCriterion;
    route: QualificationCriterion;
    vehicle: QualificationCriterion;
    cargo: QualificationCriterion;
    bookingIntent: QualificationCriterion;
  };
  totalScore: number;
  qualifiedAt: string;
}

export interface Qualification {
  id: string;
  call_id: string;
  /** Nullable text-conversation anchor (Phase 2 bridge; call_id stays canonical). */
  conversation_id?: string | null;
  lead_id?: string | null;
  score: number;
  tier: QualificationTier;
  details: QualificationDetails;
  qualified_at: string;
  created_at: string;
  updated_at: string;
}