import type { MetadataRoute } from "next";
import { getSiteBaseUrl } from "@/lib/siteUrl";
import { getAllTasks } from "@/lib/taskStore";
import { getAllApprovedAgents } from "@/lib/agentRegistry";

/** Static marketing & product surfaces (no admin, no API). */
const STATIC_PATHS: { path: string; changeFrequency: MetadataRoute.Sitemap[0]["changeFrequency"]; priority: number }[] = [
  { path: "/",          changeFrequency: "weekly", priority: 1 },
  { path: "/dashboard", changeFrequency: "weekly", priority: 0.85 },
  { path: "/agents",    changeFrequency: "weekly", priority: 0.9 },
  { path: "/tasks",     changeFrequency: "daily",  priority: 0.9 },
  { path: "/projects",  changeFrequency: "weekly", priority: 0.75 },
  { path: "/docs",      changeFrequency: "weekly", priority: 0.95 },
];

/** Last meaningful modification time for a task (latest activity). */
function taskLastModified(task: Awaited<ReturnType<typeof getAllTasks>>[number]): Date {
  const subTimes = task.submissions?.map((s) => s.submittedAt) ?? [];
  const latestSecs = subTimes.length ? Math.max(...subTimes) : task.deadline;
  return new Date(latestSecs * 1000);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteBaseUrl();
  const now = new Date();

  // Static entries
  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map(({ path, changeFrequency, priority }) => ({
    url: path === "/" ? base : `${base}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }));

  // Dynamic entries — guard against store failures so sitemap stays usable
  let taskEntries: MetadataRoute.Sitemap = [];
  try {
    const tasks = await getAllTasks();
    taskEntries = tasks
      .filter((t) => t.status !== "Open" || t.submissions.length > 0)
      .slice(0, 5_000)
      .map((t) => ({
        url: `${base}/task/${t.id}`,
        lastModified: taskLastModified(t),
        changeFrequency: "weekly" as const,
        priority: 0.6,
      }));
  } catch {
    /* sitemap should not 500 if data store is offline */
  }

  let agentEntries: MetadataRoute.Sitemap = [];
  try {
    const agents = await getAllApprovedAgents();
    agentEntries = agents.slice(0, 5_000).map((a) => ({
      url: `${base}/agent/${a.pubkey}`,
      lastModified: a.lastSeen ? new Date(a.lastSeen) : now,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    }));
  } catch {
    /* sitemap should not 500 if data store is offline */
  }

  return [...staticEntries, ...taskEntries, ...agentEntries];
}
