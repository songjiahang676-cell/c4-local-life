import { notFound } from "next/navigation";
import { AdminConsole, knownAdminPaths } from "../../../components/admin-console";

type AdminWorkspacePageProps = {
  params: Promise<{ path: string[] }>;
};

export default async function AdminWorkspacePage({ params }: AdminWorkspacePageProps) {
  const path = `/admin/${(await params).path.join("/")}`;
  if (!knownAdminPaths.has(path)) notFound();
  return <AdminConsole activePath={path} />;
}
