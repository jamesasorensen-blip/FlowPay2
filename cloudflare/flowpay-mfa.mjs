// FlowPay TOTP MFA controller. Integrate after Supabase client initialization.
// Never use this module alone as authorization: enforce AAL2 on every data API and RLS policy.
export function createMfaController(supabase) {
  if (!supabase?.auth?.mfa) throw new Error("Supabase MFA client required");
  const mfa = supabase.auth.mfa;
  const unwrap = async promise => {
    const { data, error } = await promise;
    if (error) throw error;
    return data;
  };
  async function status() {
    const session = await unwrap(supabase.auth.getSession());
    if (!session.session) return { state: "signed-out", factors: [] };
    const [factors, assurance] = await Promise.all([
      unwrap(mfa.listFactors()),
      unwrap(mfa.getAuthenticatorAssuranceLevel())
    ]);
    const verified = (factors.totp || []).filter(f => f.status === "verified");
    const pending = (factors.all || factors.totp || []).filter(f => f.factor_type === "totp" || f.factorType === "totp" || (factors.totp || []).some(t => t.id === f.id)).filter(f => f.status === "unverified");
    const state = assurance.currentLevel === "aal2" && verified.length ? "ready" :
      verified.length ? "challenge-required" : "enrollment-required";
    return { state, userId: session.session.user?.id || null, factors: verified, pendingFactors: pending, currentLevel: assurance.currentLevel,
      nextLevel: assurance.nextLevel };
  }
  async function enroll(friendlyName = "FlowPay authenticator") {
    const before = await status();
    if (before.state === "signed-out") throw new Error("Sign in to enroll an authenticator");
    if (before.state === "challenge-required") throw new Error("Verify your existing authenticator before adding another");
    const data = await unwrap(mfa.enroll({ factorType: "totp", friendlyName }));
    if (!data?.id || !data?.totp?.qr_code) throw new Error("Invalid enrollment response");
    return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
  }
  async function restartUnverifiedEnrollment() {
    const before = await status();
    if (before.state !== "enrollment-required") throw new Error("Enrollment reset unavailable when MFA is verified");
    const pending = (before.pendingFactors || []).filter(f => f.friendly_name === "FlowPay authenticator");
    if (pending.length !== 1) throw new Error("Unable to identify a single unfinished FlowPay authenticator");
    await unwrap(mfa.unenroll({ factorId: pending[0].id }));
    return enroll();
  }
  async function restartUnverifiedBackupEnrollment() {
    const before = await status();
    if (before.state !== "ready") throw new Error("MFA verification required to restart backup enrollment");
    const pending = (before.pendingFactors || []).filter(f => f.friendly_name === "FlowPay backup authenticator");
    if (pending.length !== 1) throw new Error("Unable to identify a single unfinished backup authenticator");
    await unwrap(mfa.unenroll({ factorId: pending[0].id }));
    return enroll("FlowPay backup authenticator");
  }
  async function verify(factorId, code) {
    if (!factorId || !/^\d{6}$/.test(code)) throw new Error("Enter a six-digit authenticator code");
    const challenge = await unwrap(mfa.challenge({ factorId }));
    await unwrap(mfa.verify({ factorId, challengeId: challenge.id, code }));
    const result = await status();
    if (result.state !== "ready") throw new Error("MFA verification did not establish AAL2");
    return result;
  }
  async function removeFactor(factorId) {
    const before = await status();
    if (before.state !== "ready") throw new Error("MFA verification required");
    if (!before.factors.some(f => f.id === factorId)) throw new Error("Factor is not verified for this account");
    if (before.factors.length <= 1) throw new Error("Cannot remove your last verified factor");
    return unwrap(mfa.unenroll({ factorId }));
  }
  return { status, enroll, restartUnverifiedEnrollment, restartUnverifiedBackupEnrollment, verify, removeFactor };
}
