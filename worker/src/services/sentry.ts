import type { Asteroid } from "../types/asteroid.js";
import { getJson, ApiError } from "./http.js";

const KEY = process.env.NASA_KEY;
if(!KEY){
    throw new Error("set NASA_KEY in .env file");
}

const API_BASE = 'https://ssd-api.jpl.nasa.gov/sentry.api';

interface SentrySummaryResponse{

}

export async function fetchSentryApi(query: string | null): Promise<SentrySummaryResponse> {
    let url: string;
    if(!query){
        url = API_BASE
    }
    else{
        url = '${API_BASE}/query'
    }
    return await getJson<SentrySummaryResponse>(url);
}