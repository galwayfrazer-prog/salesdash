const WILDVISION_EMAIL_PATTERN = /^[^@\s]+@wildvision\.io$/;

export function normalizeAccessValue(value) {
  return String(value || "").trim().toLowerCase();
}

export function parseAccessList(value) {
  return String(value || "")
    .split(",")
    .map(normalizeAccessValue)
    .filter(Boolean);
}

export function isWildVisionEmail(value) {
  return WILDVISION_EMAIL_PATTERN.test(normalizeAccessValue(value));
}

export function hasMatchingGoogleIdentity(authUser, email) {
  const normalizedEmail = normalizeAccessValue(email);
  return Array.isArray(authUser?.identities) && authUser.identities.some((identity) => (
    identity?.provider === "google"
      && normalizeAccessValue(identity?.identity_data?.email) === normalizedEmail
  ));
}

export function validateGoogleAuthUser(authUser) {
  const email = normalizeAccessValue(authUser?.email);
  if (!authUser?.id) return { allowed: false, code: "INVALID_SESSION" };
  if (!authUser.email_confirmed_at) return { allowed: false, code: "EMAIL_NOT_VERIFIED" };
  if (!isWildVisionEmail(email)) return { allowed: false, code: "DOMAIN_NOT_ALLOWED" };
  if (!hasMatchingGoogleIdentity(authUser, email)) {
    return { allowed: false, code: "GOOGLE_IDENTITY_REQUIRED" };
  }
  return { allowed: true, email };
}

function matchesConfiguredSalesTeam(zohoUser, access) {
  const roleId = normalizeAccessValue(zohoUser?.role?.id);
  const roleName = normalizeAccessValue(zohoUser?.role?.name);
  const profileId = normalizeAccessValue(zohoUser?.profile?.id);
  const profileName = normalizeAccessValue(zohoUser?.profile?.name);
  const roleIds = new Set(access.roleIds || []);
  const roleNames = new Set(access.roleNames || []);
  const profileIds = new Set(access.profileIds || []);
  const profileNames = new Set(access.profileNames || []);

  return roleIds.has(roleId)
    || roleNames.has(roleName)
    || profileIds.has(profileId)
    || profileNames.has(profileName);
}

export function evaluateZohoSalesAccess({ authUser, zohoUsers, access }) {
  const auth = validateGoogleAuthUser(authUser);
  if (!auth.allowed) return auth;

  const configuredAccess = {
    roleIds: (access?.roleIds || []).map(normalizeAccessValue).filter(Boolean),
    roleNames: (access?.roleNames || []).map(normalizeAccessValue).filter(Boolean),
    profileIds: (access?.profileIds || []).map(normalizeAccessValue).filter(Boolean),
    profileNames: (access?.profileNames || []).map(normalizeAccessValue).filter(Boolean),
  };
  if (Object.values(configuredAccess).every((values) => values.length === 0)) {
    return { allowed: false, code: "SALES_TEAM_NOT_CONFIGURED" };
  }

  const matchingUsers = (Array.isArray(zohoUsers) ? zohoUsers : []).filter(
    (zohoUser) => normalizeAccessValue(zohoUser?.email) === auth.email,
  );
  if (matchingUsers.length !== 1) {
    return { allowed: false, code: "ZOHO_USER_NOT_FOUND" };
  }

  const zohoUser = matchingUsers[0];
  if (normalizeAccessValue(zohoUser?.status) !== "active") {
    return { allowed: false, code: "ZOHO_USER_INACTIVE", zohoUser };
  }
  if (!matchesConfiguredSalesTeam(zohoUser, configuredAccess)) {
    return { allowed: false, code: "ZOHO_SALES_MEMBERSHIP_REQUIRED", zohoUser };
  }

  return { allowed: true, email: auth.email, zohoUser };
}

export function displayNameForMember(zohoUser, authUser, email) {
  const zohoName = String(zohoUser?.full_name || "").trim()
    || [zohoUser?.first_name, zohoUser?.last_name].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
  const googleName = String(authUser?.user_metadata?.full_name || authUser?.user_metadata?.name || "").trim();
  if (zohoName || googleName) return zohoName || googleName;
  return normalizeAccessValue(email)
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function planSalesOsMembership({ authUser, email, memberByUserId, memberByEmail }) {
  const normalizedEmail = normalizeAccessValue(email);
  const existingRows = [memberByUserId, memberByEmail].filter(Boolean);
  const conflict = existingRows.some((member) => (
    member.user_id !== authUser.id || normalizeAccessValue(member.email) !== normalizedEmail
  ));
  if (conflict) return { allowed: false, code: "MEMBERSHIP_CONFLICT" };

  const existing = memberByUserId || memberByEmail || null;
  if (existing && existing.active !== true) {
    return { allowed: false, code: "MEMBERSHIP_DISABLED" };
  }
  if (existing) return { allowed: true, action: "keep", member: existing };

  return {
    allowed: true,
    action: "insert",
    member: {
      email: normalizedEmail,
      user_id: authUser.id,
      role: "rep",
      active: true,
      stats_enabled: true,
    },
  };
}
