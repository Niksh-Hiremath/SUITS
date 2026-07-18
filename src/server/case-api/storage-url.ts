type EnvironmentSource = Partial<Record<string, string | undefined>>;

export function validateConvexStorageUploadUrl(
  value: string,
  source: EnvironmentSource = process.env,
): string {
  const deploymentValue = source.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!deploymentValue) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");

  let deployment: URL;
  let candidate: URL;
  try {
    deployment = new URL(deploymentValue);
    candidate = new URL(value);
  } catch {
    throw new Error("CASE_STORAGE_URL_INVALID");
  }
  const localDeployment = deployment.hostname === "localhost" || deployment.hostname === "127.0.0.1";
  if (
    candidate.origin !== deployment.origin ||
    candidate.username !== "" ||
    candidate.password !== "" ||
    candidate.protocol !== (localDeployment ? deployment.protocol : "https:") ||
    !candidate.pathname.startsWith("/api/storage/")
  ) {
    throw new Error("CASE_STORAGE_URL_INVALID");
  }
  return candidate.toString();
}
