import {mapPlaidTransactions} from './plaid-transaction-adapter.mjs';
import {reconcileReceipt} from './receipt-reconciliation.mjs';

// Pure, read-only bridge. The caller must provide records from its authenticated,
// authorized account scope. No account fetch, write, or receipt attachment occurs here.
export function suggestReceiptMatchesFromPlaid(receipt,plaidRecords){
 const transactions=mapPlaidTransactions(plaidRecords);
 const result=reconcileReceipt(receipt,transactions);
 return Object.freeze({
  ...result,
  matches:Object.freeze(transactions.filter(tx=>result.matchingTransactionIds.includes(tx.id)).map(tx=>Object.freeze({...tx}))),
  source:'provided-transactions',
  autoAttach:false
 });
}
