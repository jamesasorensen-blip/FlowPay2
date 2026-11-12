// Shared financial display utilities. Pure functions; safe to use in any FlowPay view.
export const AMOUNT_KINDS = Object.freeze({
  available: 'Available money', balance: 'Account balance', income: 'Income',
  expense: 'Money spent', upcoming: 'Upcoming payment', reserved: 'Money reserved',
  debt: 'Amount owed', forecast: 'Forecast', simulated: 'What-if estimate'
});
export const AMOUNT_STATUSES = Object.freeze(['actual','pending','estimated','simulated']);
const currencyFormatter = new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', minimumFractionDigits:2, maximumFractionDigits:2});
export function formatMoney(value, {kind='balance', status='actual'}={}) {
  if (!Object.hasOwn(AMOUNT_KINDS,kind)) throw new RangeError('Unknown amount kind');
  if (!AMOUNT_STATUSES.includes(status)) throw new RangeError('Unknown amount status');
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Amount must be a finite number');
  const abs = currencyFormatter.format(Math.abs(value));
  const signed = kind === 'expense' ? '−'+abs : kind === 'income' ? '+'+abs : value < 0 ? '−'+abs : abs;
  return {text:signed, label:AMOUNT_KINDS[kind], status, kind, accessibleLabel:`${AMOUNT_KINDS[kind]}: ${signed}. ${status}.`};
}
export function formatAPR(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new RangeError('APR must be a nonnegative finite percentage');
  return `${value.toFixed(2)}% APR`;
}
export function formatMoneyHTML(value, options={}) {
  const formatted=formatMoney(value,options);
  // All rendered attributes are derived from validated enum values or escaped formatter output.
  return `<span class="fp-financial-value" data-kind="${formatted.kind}" aria-label="${formatted.accessibleLabel}">${formatted.text}</span>`;
}
