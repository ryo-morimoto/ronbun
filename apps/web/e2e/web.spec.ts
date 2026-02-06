import { test, expect } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:8787";

test.describe("Web Page E2E Tests", () => {
  test.describe("Home Page", () => {
    test("should display home page with navigation", async ({ page }) => {
      await page.goto(BASE_URL);

      // Check title
      await expect(page).toHaveTitle(/Ronbun/);

      // Check navigation links
      await expect(page.locator("nav")).toBeVisible();
      await expect(page.locator("nav a[href='/']")).toBeVisible();
      await expect(page.locator("nav a[href='/papers']")).toBeVisible();
      await expect(page.locator("nav a[href='/search']")).toBeVisible();
      await expect(page.locator("nav a[href='/arxiv']")).toBeVisible();

      // Check welcome message
      await expect(page.locator("text=Welcome to Ronbun")).toBeVisible();
    });

    test("should navigate to papers page", async ({ page }) => {
      await page.goto(BASE_URL);
      await page.click("nav a[href='/papers']");
      await expect(page).toHaveURL(/\/papers/);
      await expect(page.locator("h2")).toContainText("Papers");
    });

    test("should navigate to search page", async ({ page }) => {
      await page.goto(BASE_URL);
      await page.click("nav a[href='/search']");
      await expect(page).toHaveURL(/\/search/);
      await expect(page.locator("h2")).toContainText("Search");
    });

    test("should navigate to arxiv page", async ({ page }) => {
      await page.goto(BASE_URL);
      await page.click("nav a[href='/arxiv']");
      await expect(page).toHaveURL(/\/arxiv/);
      await expect(page.locator("h2")).toContainText("arXiv");
    });
  });

  test.describe("Papers Page", () => {
    test("should display papers page", async ({ page }) => {
      await page.goto(`${BASE_URL}/papers`);
      await expect(page.locator("h2")).toContainText("Papers");
      await expect(page.locator("text=/api/papers")).toBeVisible();
    });
  });

  test.describe("Search Page", () => {
    test("should display search page with search input", async ({ page }) => {
      await page.goto(`${BASE_URL}/search`);
      await expect(page.locator("h2")).toContainText("Search Papers");
      await expect(page.locator("input[placeholder*='search']")).toBeVisible();
      await expect(page.locator("button:has-text('Search')")).toBeVisible();
    });
  });

  test.describe("ArXiv Page", () => {
    test("should display arxiv page with search input", async ({ page }) => {
      await page.goto(`${BASE_URL}/arxiv`);
      await expect(page.locator("h2")).toContainText("arXiv Search");
      await expect(page.locator("input[placeholder*='arXiv']")).toBeVisible();
      await expect(page.locator("button:has-text('Search')")).toBeVisible();
    });
  });

  test.describe("API Health Check", () => {
    test("should return ok from health endpoint", async ({ request }) => {
      const response = await request.get(`${BASE_URL}/api/health`);
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ status: "ok" });
    });
  });
});
