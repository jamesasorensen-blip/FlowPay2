// Standalone MFA interface for integration into FlowPay's authenticated app.
// Mount only after Supabase is initialized: mountFlowPayMfa({supabase, host, onReady}).
import { createMfaController } from "./flowpay-mfa.mjs";
function safeQrImageSource(value) {
  if (typeof value !== "string") throw new Error("Invalid authenticator QR response");
  const qr = value.trim();
  if (/^data:image\/(?:svg\+xml|png);base64,[A-Za-z0-9+/=]+$/i.test(qr)) return qr;
  if (/^data:image\/svg\+xml(?:;charset=[a-z0-9-]+)?,/i.test(qr)) return qr;
  if (/^<svg(?:\s|>)/i.test(qr) && /<\/svg>\s*$/i.test(qr)) {
    const bytes = new TextEncoder().encode(qr);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return "data:image/svg+xml;base64," + btoa(binary);
  }
  return null;
}
export async function mountFlowPayMfa({ supabase, host, onReady = () => {} }) {
  if (!host) throw new Error("MFA mount element required");
  const controller = createMfaController(supabase);
  host.replaceChildren();
  const panel = document.createElement("section");
  panel.setAttribute("aria-label", "FlowPay account security");
  const heading = document.createElement("h2");
  heading.textContent = "Secure your FlowPay account";
  const message = document.createElement("p");
  message.setAttribute("role", "status");
  const qr = document.createElement("img");
  qr.alt = "Scan this code with your authenticator app";
  qr.style.maxWidth = "220px";
  const manual = document.createElement("code");
  const manualLabel = document.createElement("div");
  manualLabel.textContent = "Authenticator setup key (keep private)";
  const setupDetails = document.createElement("div");
  setupDetails.style.cssText = "display:none; margin:12px 0; padding:12px; border:1px solid #94a3b8; border-radius:8px; background:#fff; color:#111827; max-width:100%;";
  manual.style.cssText = "display:block; white-space:pre-wrap; overflow-wrap:anywhere; user-select:all; padding:8px 0; font:600 15px monospace; color:#111827;";
  setupDetails.append(manualLabel, manual);
  const form = document.createElement("form");
  const input = document.createElement("input");
  input.inputMode = "numeric";
  input.autocomplete = "one-time-code";
  input.pattern = "[0-9]{6}";
  input.maxLength = 6;
  input.required = true;
  input.placeholder = "6-digit code";
  input.setAttribute("aria-label", "Authenticator code");
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Verify authenticator";
  form.append(input, button);
  const enrollButton = document.createElement("button");
  enrollButton.type = "button";
  enrollButton.textContent = "Set up authenticator";
  enrollButton.hidden = true;
  const restartButton = document.createElement("button");
  restartButton.type = "button";
  restartButton.textContent = "Restart unfinished setup";
  restartButton.hidden = true;
  const signOut = document.createElement("button");
  signOut.type = "button";
  signOut.textContent = "Sign out";
  panel.append(heading, message, enrollButton, restartButton, qr, setupDetails, form, signOut);
  host.append(panel);
  let factorId = null;
  async function render() {
    const result = await controller.status();
    qr.hidden = true;
    setupDetails.style.display = "none";
    form.hidden = false;
    form.style.display = "";
    enrollButton.hidden = true;
    restartButton.hidden = true;
    factorId = null;
    if (result.state === "signed-out") {
      message.textContent = "Sign in before setting up multi-factor authentication.";
      form.hidden = true;
    } else if (result.state === "ready") {
      message.textContent = "Your authenticator is verified.";
      form.hidden = true;
      onReady();
    } else if (result.state === "challenge-required") {
      factorId = result.factors[0].id;
      message.textContent = "Enter the code from your authenticator app to continue.";
    } else {
      message.textContent = "Set up an authenticator app to protect your account.";
      enrollButton.hidden = (result.pendingFactors || []).some(f => f.friendly_name === "FlowPay authenticator");
      restartButton.hidden = !enrollButton.hidden;
      if (!restartButton.hidden) message.textContent = "An earlier authenticator setup was not completed. You can restart that unfinished setup.";
      form.hidden = true;
    }
  }
  enrollButton.addEventListener("click", async () => {
    enrollButton.disabled = true;
    message.textContent = "Setting up your authenticator…";
    try {
      const setup = await controller.enroll();
      const qrSource = safeQrImageSource(setup.qrCode);
      factorId = setup.factorId;
      if (qrSource) qr.src = qrSource;
      qr.hidden = !qrSource;
      if (typeof setup.secret !== "string" || !setup.secret.trim()) throw new Error("Authenticator setup key unavailable; cannot finish enrollment");
      manual.textContent = setup.secret;
      setupDetails.style.display = "block";
      form.hidden = false;
      form.style.display = "flex";
      form.style.flexWrap = "wrap";
      form.style.gap = "8px";
      enrollButton.hidden = true;
      message.textContent = qrSource ? "Scan the QR code or enter the setup key in your authenticator app, then enter a code." : "Enter the setup key shown below manually in your authenticator app, then enter its six-digit code.";
    } catch (error) {
      message.textContent = error?.message || "Unable to start MFA enrollment.";
    } finally {
      enrollButton.disabled = false;
    }
  });
  signOut.addEventListener("click", async () => {
    signOut.disabled = true;
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      await render();
    } catch (error) {
      message.textContent = error?.message || "Unable to sign out.";
    } finally {
      signOut.disabled = false;
    }
  });
  restartButton.addEventListener("click", async () => {
    restartButton.disabled = true;
    try {
      const setup = await controller.restartUnverifiedEnrollment();
      const qrSource = safeQrImageSource(setup.qrCode);
      factorId = setup.factorId;
      if (qrSource) qr.src = qrSource;
      qr.hidden = !qrSource;
      manual.textContent = setup.secret || "";
      manual.hidden = false;
      form.hidden = false;
      form.style.display = "flex";
      form.style.flexWrap = "wrap";
      form.style.gap = "8px";
      restartButton.hidden = true;
      message.textContent = qrSource ? "Scan the new QR code and verify the six-digit code." : "Enter the setup key shown below manually in your authenticator app, then enter its six-digit code.";
    } catch (error) {
      message.textContent = error?.message || "Unable to restart setup.";
    } finally { restartButton.disabled = false; }
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    button.disabled = true;
    message.textContent = "Verifying…";
    try {
      await controller.verify(factorId, input.value.trim());
      input.value = "";
      await render();
    } catch (error) {
      message.textContent = error?.message || "Unable to verify. Try again.";
    } finally {
      button.disabled = false;
    }
  });
  try { await render(); } catch (error) {
    message.textContent = error?.message || "Unable to initialize MFA.";
    form.hidden = true;
  }
  return { refresh: render };
}
