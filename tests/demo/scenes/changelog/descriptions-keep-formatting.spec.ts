import { createClient } from "@supabase/supabase-js";
import { loadDemoEnv } from "../../env";
import { expect, shot, test } from "../../fixtures";

/**
 * Screenshot for the changelog entry "Prickle and event descriptions keep their formatting": the next Sprint Prickle, whose
 * calendar description (seeded in demo/rest-seed.ts) has bold, italic, a list, a link and a dividing line.
 */
test("a member reads a formatted description @changelog", async ({ page, signInAs }, testInfo) => {
  const env = loadDemoEnv();
  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false } });
  const { data, error } = await admin
    .from("prickles")
    .select("id")
    .ilike("description", "%Bring a scene that is stuck%")
    .gt("start_time", new Date().toISOString())
    .order("start_time")
    .limit(1);
  expect(error).toBeNull();
  expect(data?.length, "run pnpm demo:seed first").toBe(1);

  await signInAs("member");
  await page.goto(`/prickles/${data![0].id}`);
  await expect(page.getByRole("link", { name: "our list of prompts" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await shot(page, testInfo, "prickle-description");
});
