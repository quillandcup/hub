import { ROLE_PERMISSIONS } from "@/lib/permissions";
import { STAFF_FEATURES } from "@/lib/staff-access";

/**
 * Takes the finer staff features (the controls inside a page, like `care.write`) away from the community
 * manager role (except those in `keep`), as if none had been granted yet, and returns a function that puts them back. For tests of
 * what a role without a feature sees or may do.
 */
export function withdrawCommunityManagerFeatures(keep: readonly string[] = []): () => void {
  const bundle = ROLE_PERMISSIONS.community_manager;
  const before = [...bundle];
  const features: readonly string[] = STAFF_FEATURES;
  bundle.splice(0, bundle.length, ...before.filter((permission) => !features.includes(permission) || keep.includes(permission)));
  return () => {
    bundle.splice(0, bundle.length, ...before);
  };
}
