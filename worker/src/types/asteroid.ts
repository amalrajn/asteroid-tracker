
/**
 * NASA JPL small-body SPK-ID, e.g. "3542519".
 *
 * This is the join key between the two APIs and the primary key everywhere in
 * our system. NeoWs calls it `neo_reference_id`; Sentry accepts it as `spk`.
 *
 */
export type SpkId = string;

/**
 * Torino impact hazard scale: 0 (no hazard) through 10 (certain global
 * catastrophe).
 */
export type TorinoScale = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/* -------------------------------------------------------------------------- */
/*  Entities                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A near-Earth object's identity and physical properties.
 *
 * Slow-moving data — diameter estimates change only when new observations
 * refine the absolute magnitude.
 *
 * Postgres: primary key `spkId`.
 */
export interface Asteroid {
  spkId: SpkId;
  designation: string;
  fullName: string;
  absoluteMagnitude: number; //lower means bigger
  diameterMinM: number; //Diameter estimates in meters. NASA doesn't give exact numbers on diameter.
  diameterMaxM: number;
  isPotentiallyHazardous: boolean; //might not use given sentry
  isSentryObject: boolean;
  jplUrl: string; //JPL's real life URL for this object if available
}

/**
 * One predicted or observed close approach: this asteroid, this moment.
 *
 * Distinct from Asteroid because a single object has many approaches over
 * time, and the Feed endpoint returns them per-date.
 *
 * Postgres: composite primary key (spkId, approachAt) — no surrogate id
 * needed, since an object cannot have two approaches at the same instant.
 */
export interface CloseApproach {
  spkId: SpkId;

  approachAt: Date; //epochms

  /** Closest distance in kilometres. Parsed from NASA's string field. */
  missDistanceKm: number;
  missDistanceLunar: number; //Same distance in lunar distances (1 LD ≈ 384,400 km)
  velocityKmS: number;
  /**
   * The body being approached. The Feed gives "Earth", but the Lookup
   * endpoint returns an object's full approach history and uses values like
   * "Venus", "Mars", and "Juptr" (sic). Filter to "Earth" before displaying,
   * or a Mars flyby will show up as a near miss.
   */
  orbitingBody: string;
}

/**
 * A snapshot of Sentry's impact-risk assessment for one asteroid.
 *
 * Postgres: primary key `spkId`.
 */
export interface SentryRisk {
  spkId: SpkId;
  designation: string;
  impactProbability: number; //float
  potentialImpacts: number;
  palermoScaleCumulative: number;
  palermoScaleMax: number;
  torinoScaleMax: TorinoScale | null;
  diameterM: number | null;
  impactVelocityKmS: number | null;
  impactEnergyMt: number | null; //Megatons TNT
  impactYearFirst: number | null; //calendar year span for First and Last
  impactYearLast: number | null;
  /** Date of the most recent observation used in the analysis. */
  lastObservedAt: Date | null;
}

/* -------------------------------------------------------------------------- */
/*  Read model                                                                 */
/* -------------------------------------------------------------------------- */

export interface AsteroidView extends Asteroid {
  nextApproach: CloseApproach | null;
  risk: SentryRisk | null;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Mean Earth–Moon distance in km, for the missDistanceLunar conversion. */
export const LUNAR_DISTANCE_KM = 384_400;
