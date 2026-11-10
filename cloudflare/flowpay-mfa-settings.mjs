// Staging-only optional MFA entry in FlowPay Account Settings.
// Call installFlowPayMfaSettings(supabaseClient) after Supabase client initialization.
export function installFlowPayMfaSettings(supabaseClient) {
  if (!supabaseClient?.auth?.mfa) throw new Error("Supabase MFA client unavailable");
  const modal = document.getElementById("modal-settings");
  if (!modal) throw new Error("FlowPay settings modal unavailable");
  if (modal.querySelector("#flowpay-settings-mfa")) return;
  const section = document.createElement("section");
  section.id = "flowpay-settings-mfa";
  section.style.cssText = "border-top:1px solid #94a3b8;padding-top:16px;display:grid;gap:12px";
  const heading = document.createElement("h3");
  heading.textContent = "Two-factor authentication";
  heading.style.cssText = "font-weight:700;font-size:14px";
  const description = document.createElement("p");
  description.textContent = "Protect your account with an authenticator app. Setup is optional during staging tests.";
  description.style.cssText = "font-size:12px";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Manage authenticator";
  button.style.cssText = "background:#4f46e5;color:white;border-radius:8px;padding:10px 14px;font-weight:600";
  const host = document.createElement("div");
  host.hidden = true;
  host.style.cssText = "max-width:100%;overflow-wrap:anywhere";
  const error = document.createElement("p");
  error.setAttribute("role","alert");
  error.style.cssText = "color:#dc2626;font-size:12px";
  section.append(heading,description,button,error,host);
  modal.querySelector(".glass")?.append(section);
  let mounting = false;
  button.addEventListener("click", async () => {
    if (mounting) return;
    if (!host.hidden) { host.hidden = true; button.textContent = "Manage authenticator"; return; }
    mounting = true;
    button.disabled = true;
    error.textContent = "";
    try {
      const {data, error:sessionError} = await supabaseClient.auth.getSession();
      if (sessionError) throw sessionError;
      if (!data.session) throw new Error("Sign in before managing your authenticator");
      const {mountFlowPayMfa} = await import("/mfa/flowpay-mfa-ui.mjs");
      await mountFlowPayMfa({supabase:supabaseClient,host});
      host.hidden = false;
      button.textContent = "Hide authenticator settings";
    } catch (e) {
      host.hidden = true;
      error.textContent = e?.message || "Unable to load authenticator settings";
    } finally { mounting = false; button.disabled = false; }
  });
}
