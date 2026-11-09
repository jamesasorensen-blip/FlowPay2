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
    const [session, factors, assurance] = await Promise.all([
      unwrap(supabase.auth.getSession()),
      unwrap(mfa.listFactors()),
      unwrap(mfa.getAuthenticatorAssuranceLevel())
    ]);
    if (!session.session) return { state: "signed-out", factors: [] };
    const verified = (factors.totp || []).filter(f => f.status === "verified");
    const state = assurance.currentLevel === "aal2" ? "ready" :
      verified.length ? "challenge-required" : "enrollment-required";
    return { state, factors: verified, currentLevel: assurance.currentLevel,
      nextLevel: assurance.nextLevel };
  }
  async function enroll(friendlyName = "FlowPay authenticator") {
    const data = await unwrap(mfa.enroll({ factorType: "totp", friendlyName }));
    if (!data?.id || !data?.totp?.qr_code) throw new Error("Invalid enrollment response");
    return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
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
    if (before.factors.length <= 1) throw new Error("Cannot remove your last verified factor");
    return unwrap(mfa.unenroll({ factorId }));
  }
  return { status, enroll, verify, removeFactor };
}
