const PROFILE_ONLY_FIELDS = new Set([
  "password",
  "passwordHash",
  "mustChangePassword",
  "role",
  "user_id",
  "userId",
  "authUserId",
  "needsPasswordSetup",
  "localTestOnly",
  "statsEnabled",
]);

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeUiMessage(value) {
  return typeof value === "string" ? value : "";
}

export function isWildVisionEmail(value) {
  return /^[^@\s]+@wildvision\.io$/.test(normalizeEmail(value));
}

export function displayNameFromEmail(value) {
  return normalizeEmail(value)
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function isSalesStatsUser(user) {
  return user?.statsEnabled !== false;
}

export function sanitizeLegacyProfile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const profile = { ...value };
  for (const field of PROFILE_ONLY_FIELDS) delete profile[field];
  if (profile.email) profile.email = normalizeEmail(profile.email);
  return profile;
}

export function profileForRemoteStorage(user) {
  const profile = sanitizeLegacyProfile(user);
  return {
    ...profile,
    email: normalizeEmail(profile.email),
  };
}

export function mergeAuthenticatedUser(authUser, membership, legacyProfile = {}) {
  const authEmail = normalizeEmail(authUser?.email);
  const memberEmail = normalizeEmail(membership?.email);
  if (!authUser?.id || !membership?.active) throw new Error("Approved membership required.");
  if (!authUser.email_confirmed_at || !isWildVisionEmail(authEmail)) {
    throw new Error("A verified Wild Vision email is required.");
  }
  if (membership.user_id !== authUser.id || memberEmail !== authEmail) {
    throw new Error("This account is not linked to the approved membership.");
  }

  const profile = sanitizeLegacyProfile(legacyProfile);
  const displayName = profile.displayName || membership.display_name || displayNameFromEmail(authEmail);
  return {
    ...profile,
    email: authEmail,
    role: membership.role,
    statsEnabled: membership.stats_enabled !== false,
    displayName,
    nickname: profile.nickname || displayName,
    authUserId: authUser.id,
    needsPasswordSetup: Boolean(authUser.user_metadata?.needs_password_setup),
  };
}

export function makeLocalTestUser(email, role, legacyProfile = {}) {
  const normalizedEmail = normalizeEmail(email) || "local.tester@wildvision.invalid";
  const safeRole = role === "manager" ? "manager" : "rep";
  const profile = sanitizeLegacyProfile(legacyProfile);
  const displayName = profile.displayName || displayNameFromEmail(normalizedEmail);
  return {
    ...profile,
    email: normalizedEmail,
    role: safeRole,
    statsEnabled: true,
    displayName,
    nickname: profile.nickname || displayName,
    setupComplete: profile.setupComplete ?? true,
    localTestOnly: true,
    needsPasswordSetup: false,
  };
}
