import {mapPlaidTransactions} from './plaid-transaction-adapter.mjs';
import {reconcileReceipt} from './receipt-reconciliation.mjs';

// Pure, read-only bridge. The caller must provide records from its authenticated,
// authorized account scope. No account fetch, write, or receipt attachment occurs here.
export function suggestReceiptMatchesFromPlaid(receipt,plaidRecords,{accountId}={}){
 if(accountId!==undefined&&(typeof accountId!=='string'||!accountId.trim()))throw new TypeError('Account ID must be a nonempty string');
 if(!Array.isArray(plaidRecords))throw new TypeError('Transaction records must be an array');
 // A scoped request must fail closed: records without an account ID cannot match.
 const scoped=accountId===undefined?plaidRecords:plaidRecords.filter(r=>r&&r.account_id===accountId);
 const transactions=mapPlaidTransactions(scoped);
 const result=reconcileReceipt(receipt,transactions);
 return Object.freeze({
  ...result,
  matches:Object.freeze(transactions.filter(tx=>result.matchingTransactionIds.includes(tx.id)).map(tx=>Object.freeze({...tx}))),
  source:'provided-transactions',
  autoAttach:false
 });
}
