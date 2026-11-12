// Standalone MFA interface for integration into FlowPay's authenticated app.
// Mount only after Supabase is initialized: mountFlowPayMfa({supabase, host, onReady}).
import { createMfaController,chooseMfaFactor,mfaFactorLabel } from "./manual-mfa.mjs";
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
  const choiceBox=document.createElement('div');choiceBox.hidden=true;
  const choiceLabel=document.createElement('label');choiceLabel.textContent='Choose authenticator';
  const selector=document.createElement('select');selector.setAttribute('aria-label','Choose authenticator');selector.style.cssText='display:block;width:100%;padding:10px;border:1px solid #94a3b8;border-radius:8px;background:white;color:#111827';
  choiceLabel.append(selector);
  const choiceHint=document.createElement('p');choiceHint.style.fontSize='13px';choiceHint.textContent='Each separately enrolled authenticator has its own codes. FlowPay cannot detect whether you saved it in Google or Microsoft Authenticator. Select the matching entry; it will not switch automatically.';
  const aliasLabel=document.createElement('label');aliasLabel.textContent='Name this authenticator (optional)';
  const aliasInput=document.createElement('input');aliasInput.type='text';aliasInput.maxLength=60;aliasInput.placeholder='Google Authenticator or Microsoft Authenticator';aliasInput.setAttribute('aria-label','Authenticator name');aliasInput.style.cssText=selector.style.cssText;aliasLabel.append(aliasInput);
  const rememberLabel=document.createElement('label');const remember=document.createElement('input');remember.type='checkbox';remember.checked=true;rememberLabel.append(remember,document.createTextNode(' Use this authenticator by default on this browser'));
  choiceBox.append(choiceLabel,choiceHint,aliasLabel,rememberLabel);
  let verifiedFactors=[],preferences={aliases:{},preferredId:''},preferenceKey=null,challengeMode=false;
  const readPreferences=userId=>{preferenceKey=userId?'flowpay_mfa_choice_v1:'+userId:null;try{const parsed=preferenceKey?JSON.parse(localStorage.getItem(preferenceKey)||'{}'):{};return {aliases:parsed.aliases&&typeof parsed.aliases==='object'?parsed.aliases:{},preferredId:typeof parsed.preferredId==='string'?parsed.preferredId:''}}catch{return {aliases:{},preferredId:''}}};
  function choose(id){factorId=id||null;selector.value=id||'';const factor=verifiedFactors.find(f=>f.id===id);aliasInput.value=preferences.aliases[id]||'';button.disabled=!factor;message.textContent=factor?'Enter a fresh code for '+mfaFactorLabel(factor,preferences.aliases)+'.':'Choose which authenticator you want to use, then enter its code.';input.value='';}
  selector.addEventListener('change',()=>choose(selector.value));
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
  form.hidden = true;
  const input = document.createElement("input");
  input.type = "text";
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
  const backupButton = document.createElement("button");
  backupButton.type = "button";
  backupButton.textContent = "Add backup authenticator";
  backupButton.hidden = true;
  const restartButton = document.createElement("button");
  restartButton.type = "button";
  restartButton.textContent = "Restart unfinished setup";
  restartButton.hidden = true;
  const signOut = document.createElement("button");
  signOut.type = "button";
  signOut.textContent = "Sign out";
  panel.append(heading, message, choiceBox, enrollButton, backupButton, restartButton, qr, setupDetails, form, signOut);
  panel.style.cssText = "display:flex;flex-direction:column;align-items:stretch;gap:12px;max-width:100%;";
  for (const control of [enrollButton, backupButton, restartButton, signOut, button]) control.style.cssText = "padding:10px 14px;border-radius:8px;border:1px solid #a5b4fc;cursor:pointer;min-height:40px;";
  input.style.cssText = "min-width:0;max-width:100%;padding:10px;border-radius:6px;color:#111827;background:#fff;";
  host.append(panel);
  let factorId = null;
  async function render() {
    const result = await controller.status();
    qr.hidden = true;
    qr.removeAttribute("src");
    manual.textContent = "";
    input.value = "";
    setupDetails.style.display = "none";
    form.hidden = false;
    form.style.display = "";
    enrollButton.hidden = true;
    backupButton.hidden = true;
    restartButton.hidden = true;
    const priorFactor=factorId;factorId = null;
    challengeMode=false;choiceBox.hidden=true;
    if (result.state === "signed-out") {
      message.textContent = "Sign in before setting up multi-factor authentication.";
      form.hidden = true;
    } else if (result.state === "ready") {
      message.textContent = "Your authenticator is verified. You can add a backup authenticator on a separate device to reduce lockout risk.";
      form.hidden = true;
      const unfinishedBackup = (result.pendingFactors || []).some(f => f.friendly_name === "FlowPay backup authenticator");
      backupButton.textContent = unfinishedBackup ? "Restart unfinished backup setup" : "Add backup authenticator";
      backupButton.hidden = false;
      onReady();
    } else if (result.state === "challenge-required") {
      verifiedFactors=[...result.factors].sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||''))||String(a.id).localeCompare(String(b.id)));
      preferences=readPreferences(result.userId);selector.replaceChildren();
      const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Choose an authenticator…';selector.append(placeholder);
      for(const factor of verifiedFactors){const option=document.createElement('option');option.value=factor.id;option.textContent=mfaFactorLabel(factor,preferences.aliases);selector.append(option);}
      challengeMode=true;choiceBox.hidden=false;
      choose(chooseMfaFactor(verifiedFactors,priorFactor,preferences.preferredId));
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
      qr.hidden = true;
      qr.removeAttribute("src");
      manual.textContent = "";
      setupDetails.style.display = "none";
      form.hidden = true;
      factorId = null;
      message.textContent = error?.message || "Unable to start MFA enrollment.";
    } finally {
      enrollButton.disabled = false;
    }
  });
  backupButton.addEventListener("click", async () => {
    backupButton.disabled = true;
    message.textContent = "Creating backup authenticator…";
    try {
      const current = await controller.status();
      const unfinishedBackup = (current.pendingFactors || []).some(f => f.friendly_name === "FlowPay backup authenticator");
      const setup = unfinishedBackup ? await controller.restartUnverifiedBackupEnrollment() : await controller.enroll("FlowPay backup authenticator");
      const qrSource = safeQrImageSource(setup.qrCode);
      factorId = setup.factorId;
      if (qrSource) qr.src = qrSource;
      qr.hidden = !qrSource;
      if (typeof setup.secret !== "string" || !setup.secret.trim()) throw new Error("Backup setup key unavailable");
      manual.textContent = setup.secret;
      setupDetails.style.display = "block";
      form.hidden = false;
      form.style.display = "flex";
      form.style.flexWrap = "wrap";
      form.style.gap = "8px";
      backupButton.hidden = true;
      message.textContent = "Set up this backup on a separate device, then verify its six-digit code. Keep your original authenticator until the backup is verified.";
    } catch (error) {
      qr.hidden = true;
      qr.removeAttribute("src");
      manual.textContent = "";
      setupDetails.style.display = "none";
      form.hidden = true;
      factorId = null;
      message.textContent = error?.message || "Unable to create backup authenticator.";
    } finally { backupButton.disabled = false; }
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
      if (typeof setup.secret !== "string" || !setup.secret.trim()) throw new Error("Authenticator setup key unavailable; cannot finish enrollment");
      manual.textContent = setup.secret;
      setupDetails.style.display = "block";
      form.hidden = false;
      form.style.display = "flex";
      form.style.flexWrap = "wrap";
      form.style.gap = "8px";
      restartButton.hidden = true;
      message.textContent = qrSource ? "Scan the new QR code and verify the six-digit code." : "Enter the setup key shown below manually in your authenticator app, then enter its six-digit code.";
    } catch (error) {
      qr.hidden = true;
      qr.removeAttribute("src");
      manual.textContent = "";
      setupDetails.style.display = "none";
      form.hidden = true;
      factorId = null;
      message.textContent = error?.message || "Unable to restart setup.";
    } finally { restartButton.disabled = false; }
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if(!factorId){message.textContent='Choose an authenticator first.';return;}
    const selectedFactor=factorId,wasChallenge=challengeMode;
    const label=mfaFactorLabel(verifiedFactors.find(f=>f.id===selectedFactor)||{id:selectedFactor,friendly_name:'Authenticator'},preferences.aliases);
    const pendingAlias=aliasInput.value.trim();
    button.disabled = true;selector.disabled=true;aliasInput.disabled=true;remember.disabled=true;
    message.textContent = "Verifying…";
    try {
      await controller.verify(selectedFactor, input.value.trim());
      if(wasChallenge&&preferenceKey){if(pendingAlias)preferences.aliases[selectedFactor]=pendingAlias;if(remember.checked)preferences.preferredId=selectedFactor;else if(preferences.preferredId===selectedFactor)preferences.preferredId='';try{localStorage.setItem(preferenceKey,JSON.stringify(preferences))}catch{}}
      input.value = "";
      await render();
    } catch (error) {
      message.textContent=error?.code==='mfa_verification_failed'?'Code not accepted for '+label+'. Keep this authenticator selected and enter its next fresh code. If both apps fail, check that your phone uses automatic date and time.':error?.message||'Unable to verify. Try again.';
      input.value='';
    } finally {
      button.disabled = false;selector.disabled=false;aliasInput.disabled=false;remember.disabled=false;
    }
  });
  try { await render(); } catch (error) {
    message.textContent = error?.message || "Unable to initialize MFA.";
    form.hidden = true;
  }
  return { refresh: render };
}
