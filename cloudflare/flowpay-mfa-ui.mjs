// Standalone MFA interface for integration into FlowPay's authenticated app.
// Mount only after Supabase is initialized: mountFlowPayMfa({supabase, host, onReady}).
import { createMfaController } from "./flowpay-mfa.mjs";
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
  const signOut = document.createElement("button");
  signOut.type = "button";
  signOut.textContent = "Sign out";
  panel.append(heading, message, enrollButton, qr, manual, form, signOut);
  host.append(panel);
  let factorId = null;
  async function render() {
    const result = await controller.status();
    qr.hidden = manual.hidden = true;
    form.hidden = false;
    enrollButton.hidden = true;
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
      enrollButton.hidden = false;
      form.hidden = true;
    }
  }
  enrollButton.addEventListener("click", async () => {
    enrollButton.disabled = true;
    message.textContent = "Setting up your authenticator…";
    try {
      const setup = await controller.enroll();
      if (!/^data:image\/(?:svg\+xml|png);base64,[A-Za-z0-9+/=]+$/.test(setup.qrCode)) {
        throw new Error("Invalid authenticator QR response");
      }
      factorId = setup.factorId;
      qr.src = setup.qrCode;
      qr.hidden = false;
      manual.textContent = setup.secret;
      manual.hidden = false;
      form.hidden = false;
      enrollButton.hidden = true;
      message.textContent = "Scan the QR code or enter the setup key in your authenticator app, then enter a code.";
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
