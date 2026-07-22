export class SalesOsAuthError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "SalesOsAuthError";
    this.status = status;
  }
}

export async function requireSalesOsMember({ userClient, admin }) {
  const { data: userData, error: userError } = await userClient.auth.getUser();
  const user = userData?.user;
  if (userError || !user) throw new SalesOsAuthError(401, "Invalid session");
  if (!user.email_confirmed_at) {
    throw new SalesOsAuthError(403, "A verified email is required");
  }

  const email = String(user.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@wildvision\.io$/.test(email)) {
    throw new SalesOsAuthError(403, "A verified Wild Vision email is required");
  }

  const { data: member, error: memberError } = await admin
    .from("sales_os_members")
    .select("email,user_id,role,display_name,active")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (memberError) {
    throw new SalesOsAuthError(503, "Membership could not be checked");
  }
  if (!member || member.user_id !== user.id || String(member.email).toLowerCase() !== email) {
    throw new SalesOsAuthError(403, "Approved membership required");
  }

  return { user, member: { ...member, email } };
}
