import type { SentryRisk, TorinoScale } from "../types/asteroid.js";
import { getJson, ApiError } from "./http.js";

const API_BASE = "https://ssd-api.jpl.nasa.gov/sentry.api";

const SUPPORTED_VERSION = "2.0";

interface SignatureData {
  version: string;
  source: string;
}

interface SentryListResponse<T> {
  signature: SignatureData;
  count: string;
  data: T[];
}

/** Mode S row. `id` is Sentry-internal; note there is no SPK-ID here. */
interface SentrySummaryRow {
  des: string;
  id: string;
  fullname: string;
  h: string;
  diameter: string;
  ip: string;
  n_imp: number;
  ps_cum: string;
  ps_max: string;
  /** Null for objects whose impacts all fall outside the 100-year Torino window. */
  ts_max: string | null;
  range: string;
  last_obs: string;
  last_obs_jd: string;
  v_inf: string;
}

/** Mode R row. */
interface SentryRemovedRow {
  des: string;
  removed: string;
}


//Mode O
interface SentryObjectSummary {
  des: string;
  fullname: string;
  method: SentryMethod;
  h: string;
  diameter: string;
  mass: string;
  ip: string;
  n_imp: number;
  energy: string;
  ps_cum: string;
  ps_max: string;
  ts_max: string | null;
  v_inf: string;
  v_imp: string;
  first_obs: string;
  last_obs: string;
  darc: string;
  cdate: string;
  pdate: string;
  nobs: number;
  ndel: number;
  ndop: number;
  nsat: string;
}

/** IOBS is the Sentry-II default; MC and LOV survive only on legacy special cases. */
type SentryMethod = "IOBS" | "MC" | "LOV";

/** Fields every virtual impactor carries, whatever the analysis method. */
interface VirtualImpactorBase {
  date: string;
  ip: string;
  energy: string;
  ps: string;
  ts: string;
}

interface IobsImpactor extends VirtualImpactorBase {
  sigma_vi: string;
}

interface McImpactor extends VirtualImpactorBase {
  sigma_mc: string;
}

interface LovImpactor extends VirtualImpactorBase {
  dist: string;
  width: string;
  sigma_imp: string;
  sigma_lov: string;
  stretch: string;
}

/**
 * A virtual impactor row. The method-specific fields differ, and — unlike mode
 * V — mode O does NOT repeat `method` on each row, so there is no literal
 * discriminant to switch on. Narrow with the guards below instead.
 */
export type VirtualImpactor = IobsImpactor | McImpactor | LovImpactor;

export function isIobs(vi: VirtualImpactor): vi is IobsImpactor {
  return "sigma_vi" in vi;
}

export function isMonteCarlo(vi: VirtualImpactor): vi is McImpactor {
  return "sigma_mc" in vi;
}

export function isLov(vi: VirtualImpactor): vi is LovImpactor {
  return "sigma_lov" in vi;
}

interface SentryObjectResponse {
  signature: SignatureData;
  summary: SentryObjectSummary;
  data: VirtualImpactor[];
}

interface SentryErrorResponse {
  signature: SignatureData;
  error: string;
  removed?: string; //sometimes shows up
}


//What fetchSentryApiO resolves to.
export type SentryObjectResult =
  | { kind: "found"; summary: SentryObjectSummary; impactors: VirtualImpactor[] }
  | { kind: "removed"; removedAt: Date | null }
  | { kind: "not-tracked" };

/* -------------------------------------------------------------------------- */
/*  Parsing helpers                                                            */
/* -------------------------------------------------------------------------- */

function assertVersion(signature: SignatureData): void {
  if (signature?.version !== SUPPORTED_VERSION) {
    throw new ApiError(`unsupported Sentry version ${signature?.version} (expected ${SUPPORTED_VERSION})`,200,false);
  }
}

//number parsing due to JPL payloads
function num(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseSentryDate(value: string | null | undefined): Date | null {
  if (!value) return null;

  const fractional = /^(\d{4})-(\d{1,2})-(\d{1,2})(\.\d+)?$/.exec(value);
  if (fractional) {
    const [, year, month, day, frac] = fractional;
    const ms = Date.UTC(Number(year), Number(month) - 1, Number(day));
    const dayFraction = frac ? Number(frac) * 86_400_000 : 0;
    return new Date(ms + dayFraction);
  }

  // "2022-09-17 04:54:54" (cdate/pdate) — make the space an ISO 'T'.
  const parsed = new Date(value.replace(" ", "T") + (value.includes(" ") ? "Z" : ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseTorino(value: string | null | undefined): TorinoScale | null {
  const n = num(value);
  if (n == null || !Number.isInteger(n) || n < 0 || n > 10) return null;
  return n as TorinoScale;
}

const EARTH_ESCAPE_VELOCITY_KMS = 11.15;

/** Bulk density Sentry assumes for its mass estimates, kg/m^3. */
const ASSUMED_DENSITY_KGM3 = 2600;

/** Joules per megaton of TNT. */
const JOULES_PER_MEGATON = 4.184e15;

function deriveImpactVelocityKmS(vInf: number | null): number | null {
  if (vInf == null) return null;
  return Math.sqrt(vInf ** 2 + EARTH_ESCAPE_VELOCITY_KMS ** 2);
}

function deriveImpactEnergyMt(
  diameterKm: number | null,
  impactVelocityKmS: number | null,
): number | null {
  if (diameterKm == null || impactVelocityKmS == null) return null;
  const radiusM = (diameterKm * 1000) / 2;
  const massKg = ASSUMED_DENSITY_KGM3 * (4 / 3) * Math.PI * radiusM ** 3;
  const velocityMs = impactVelocityKmS * 1000;
  return (0.5 * massKg * velocityMs ** 2) / JOULES_PER_MEGATON;
}

/** Sentry's impact window, always "YYYY-YYYY" e.g. "2056-2113". */
function parseYearRange(range: string | null | undefined): [number | null, number | null] {
  const match = /^(\d{4})-(\d{4})$/.exec(range ?? "");
  if (!match) return [null, null];
  return [Number(match[1]), Number(match[2])];
}

/* -------------------------------------------------------------------------- */
/*  Requests                                                                   */
/* -------------------------------------------------------------------------- */

export async function fetchSentryApiO(selector: string): Promise<SentryObjectResult> {
  // Designations contain spaces. Unencoded, the request never leaves the
  // process — fetch rejects the URL outright.
  const url = `${API_BASE}?des=${encodeURIComponent(selector)}`;
  const res = await getJson<SentryObjectResponse | SentryErrorResponse>(url);
  assertVersion(res.signature);

  if ("error" in res) {
    if ("removed" in res && res.removed) {
      return { kind: "removed", removedAt: parseSentryDate(res.removed) };
    }
    return { kind: "not-tracked" };
  }

  return { kind: "found", summary: res.summary, impactors: res.data };
}

export async function fetchSentryApiS(): Promise<SentryListResponse<SentrySummaryRow>> {
  const res = await getJson<SentryListResponse<SentrySummaryRow>>(API_BASE);
  assertVersion(res.signature);
  return res;
}

export async function fetchSentryApiR(): Promise<SentryListResponse<SentryRemovedRow>> {
  const res = await getJson<SentryListResponse<SentryRemovedRow>>(`${API_BASE}?removed=1`);
  assertVersion(res.signature);
  return res;
}

/* -------------------------------------------------------------------------- */
/*  Mappers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Mode S rows -> domain risk records, sorted by designation for stable hashing.
 *
 * `spkId` is deliberately absent: mode S returns only `des` and Sentry's own
 * internal `id`, never an SPK-ID. The producer resolves it by joining
 * `designation` against the asteroid table, which is why neows.ts normalises
 * NeoWs names down to the same primary designation.
 */
export function toSentryRisks(
  response: SentryListResponse<SentrySummaryRow>,
): Array<Omit<SentryRisk, "spkId">> {
  return response.data
    .map((row) => {
      const [impactYearFirst, impactYearLast] = parseYearRange(row.range);
      const diameterKm = num(row.diameter);
      // Mode S publishes neither v_imp nor energy, so both are reconstructed
      // from v_inf and diameter. See the derive* helpers for accuracy figures.
      const impactVelocityKmS = deriveImpactVelocityKmS(num(row.v_inf));

      return {
        designation: row.des,
        impactProbability: num(row.ip) ?? 0,
        potentialImpacts: row.n_imp,
        palermoScaleCumulative: num(row.ps_cum) ?? 0,
        palermoScaleMax: num(row.ps_max) ?? 0,
        torinoScaleMax: parseTorino(row.ts_max),
        diameterM: diameterKm == null ? null : diameterKm * 1000,
        impactVelocityKmS,
        impactEnergyMt: deriveImpactEnergyMt(diameterKm, impactVelocityKmS),
        impactYearFirst,
        impactYearLast,
        lastObservedAt: parseSentryDate(row.last_obs),
      };
    })
    .sort((left, right) =>
      left.designation < right.designation ? -1 : left.designation > right.designation ? 1 : 0,
    );
}

/** Mode R rows -> designation and removal timestamp. */
export function toRemovals(
  response: SentryListResponse<SentryRemovedRow>,
): Array<{ designation: string; removedAt: Date | null }> {
  return response.data
    .map((row) => ({ designation: row.des, removedAt: parseSentryDate(row.removed) }))
    .sort((left, right) =>
      left.designation < right.designation ? -1 : left.designation > right.designation ? 1 : 0,
    );
}
