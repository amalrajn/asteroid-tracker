import type { Asteroid } from "../types/asteroid.js";
import { getJson, ApiError } from "./http.js";

const KEY = process.env.NASA_KEY;
if(!KEY){
    throw new Error("set NASA_KEY in .env file");
}

const API_BASE = "https://api.nasa.gov/neo/rest/v1";

interface NeoWire {
  id: string;
  neo_reference_id: string;
  name: string;
  nasa_jpl_url: string;
  absolute_magnitude_h: number;
  is_potentially_hazardous_asteroid: boolean;
  is_sentry_object: boolean;
  estimated_diameter: {
    meters: { estimated_diameter_min: number; estimated_diameter_max: number };
  };
  close_approach_data: Array<{
    epoch_date_close_approach: number; //ms
    relative_velocity: { kilometers_per_second: string };
    miss_distance: { kilometers: string };                  
    orbiting_body: string;
  }>;
}

interface NeoFeedResponse {
  element_count: number;
  near_earth_objects: Record<string, NeoWire[]>;   // keyed by "YYYY-MM-DD"
}

/** The Feed endpoint rejects windows wider than this. */
const MAX_FEED_DAYS = 7;

export async function fetchNeoApi(start_date: string, end_date: string): Promise<NeoFeedResponse> {
    // Catch an oversized window here rather than letting NASA 400 on it: getJson
    // classifies 4xx as non-retryable, so BullMQ would discard the whole job.
    const spanDays = (Date.parse(end_date) - Date.parse(start_date)) / 86_400_000;
    if (!Number.isFinite(spanDays)) {
        throw new ApiError(`invalid date range ${start_date}..${end_date}`, 0, false);
    }
    if (spanDays < 0 || spanDays > MAX_FEED_DAYS) {
        throw new ApiError(
            `feed window must be 0..${MAX_FEED_DAYS} days, got ${spanDays} (${start_date}..${end_date})`,
            0,
            false,
        );
    }

    const url = `${API_BASE}/feed?start_date=${start_date}&end_date=${end_date}&api_key=${KEY}`;
    return getJson<NeoFeedResponse>(url);
}

function toDesignation(name: string): string {
    /*parses designation to only get the number id*/
    const numbered = /^(\d+)\s/.exec(name); 
    if (numbered) return numbered[1]!;
    return name.replace(/[()]/g, "").trim();
}

export function toAsteroids(feed_response: NeoFeedResponse): Asteroid[]{
  const asteroidById = new Map<string, Asteroid>();

  for (const neo of Object.values(feed_response.near_earth_objects).flat()) {
    if (asteroidById.has(neo.neo_reference_id)) {
      continue;
    }

    asteroidById.set(neo.neo_reference_id, {
      spkId: neo.neo_reference_id,
      designation: toDesignation(neo.name),
      fullName: neo.name,
      absoluteMagnitude: neo.absolute_magnitude_h,
      diameterMinM: neo.estimated_diameter.meters.estimated_diameter_min,
      diameterMaxM: neo.estimated_diameter.meters.estimated_diameter_max,
      isPotentiallyHazardous: neo.is_potentially_hazardous_asteroid,
      isSentryObject: neo.is_sentry_object,
      jplUrl: neo.nasa_jpl_url,
    });
  }

  //string compare because for some reason not all id's are numeric
  return [...asteroidById.values()].sort((left, right) =>
    left.spkId < right.spkId ? -1 : left.spkId > right.spkId ? 1 : 0,
  );
}