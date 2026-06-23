import type { Metadata } from "next";
import { buildDynamicPageMetadata } from "@/lib/seo/pageMetadata";
import { buildBreadcrumbList, buildTaskSchema } from "@/lib/seo/structuredData";
import { getMessages, isAppLocale, LOCALE_STORAGE_KEY } from "@/lib/i18n";
import { cookies } from "next/headers";
import { getTask } from "@/lib/taskStore";

function shortTitle(text: string | undefined, max = 80): string | undefined {
  if (!text) return undefined;
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const numId = Number(id);
  const task = Number.isFinite(numId) ? await getTask(numId).catch(() => null) : null;
  return buildDynamicPageMetadata({
    page: "task",
    name: shortTitle(task?.description),
    path: `/task/${id}`,
    description: task?.criteria ? shortTitle(task.criteria, 160) : undefined,
    ogType: "article",
  });
}

export default async function TaskDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numId = Number(id);
  const task = Number.isFinite(numId) ? await getTask(numId).catch(() => null) : null;
  const jar = await cookies();
  const raw = jar.get(LOCALE_STORAGE_KEY)?.value;
  const locale = isAppLocale(raw) ? raw : "tr";
  const m = getMessages(locale).meta;

  const taskTitle = shortTitle(task?.description) ?? m.pages.task.fallbackTitle;

  const breadcrumb = buildBreadcrumbList([
    { name: "Cogladius", url: "/" },
    { name: m.pages.tasks.title, url: "/tasks" },
    { name: taskTitle, url: `/task/${id}` },
  ]);

  const taskSchema = task
    ? buildTaskSchema({
        id: task.id,
        title: taskTitle,
        description: task.criteria,
        rewardSol: task.rewardUsdc,
        deadlineIso: task.deadline ? new Date(task.deadline * 1000).toISOString() : undefined,
        status: task.status,
      })
    : null;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />
      {taskSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(taskSchema) }}
        />
      )}
      {children}
    </>
  );
}
