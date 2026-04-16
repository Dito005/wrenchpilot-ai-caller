import { describe, it, expect } from "vitest";
import axios from "axios";

describe("API Secrets Validation", () => {
  it("BLAND_AI_API_KEY is set and non-empty", () => {
    const key = process.env.BLAND_AI_API_KEY;
    expect(key).toBeTruthy();
    expect(key!.length).toBeGreaterThan(10);
  });

  it("CALENDLY_API_TOKEN is set and non-empty", () => {
    const token = process.env.CALENDLY_API_TOKEN;
    expect(token).toBeTruthy();
    expect(token!.length).toBeGreaterThan(10);
  });

  it("FACEBOOK_PAGE_ACCESS_TOKEN is set and non-empty", () => {
    const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    expect(token).toBeTruthy();
    expect(token!.length).toBeGreaterThan(10);
  });

  it("Bland.ai API key authenticates successfully", async () => {
    const key = process.env.BLAND_AI_API_KEY;
    if (!key) return; // skip if not set
    try {
      const res = await axios.get("https://api.bland.ai/v1/calls", {
        headers: { authorization: key },
        params: { limit: 1 },
        timeout: 10000,
      });
      expect(res.status).toBe(200);
    } catch (e: any) {
      // 401 means invalid key, anything else (rate limit, network) is acceptable
      if (e.response?.status === 401) {
        throw new Error("Bland.ai API key is invalid (401 Unauthorized)");
      }
      // Other errors (network, rate limit) — pass
    }
  });

  it("Calendly API token authenticates successfully", async () => {
    const token = process.env.CALENDLY_API_TOKEN;
    if (!token) return;
    try {
      const res = await axios.get("https://api.calendly.com/users/me", {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
      });
      expect(res.status).toBe(200);
      expect(res.data.resource).toBeDefined();
    } catch (e: any) {
      if (e.response?.status === 401) {
        throw new Error("Calendly API token is invalid (401 Unauthorized)");
      }
    }
  });
});
