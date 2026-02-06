import { hc } from "hono/client";
import type { ApiAppType } from "../server/api/router.ts";

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";

export const apiClient = hc<ApiAppType>(API_BASE_URL);

export type { ApiAppType };
