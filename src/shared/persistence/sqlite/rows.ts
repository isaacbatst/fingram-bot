// Vault table row
export interface VaultRow {
  id: string;
  token: string;
  created_at: string;
}

// Category table row
export interface CategoryRow {
  id: string;
  name: string;
  code: string;
  description: string;
  transaction_type: 'income' | 'expense' | 'both';
}

// Action table row
export interface ActionRow {
  id: string;
  type: 'expense' | 'income';
  payload: string; // JSON string
  created_at: string;
  status: 'pending' | 'executed' | 'failed' | 'cancelled';
}

// Transaction table row
export interface TransactionRow {
  id: string;
  code: string;
  amount: number;
  type: 'expense' | 'income';
  category_id: string | null;
  vault_id: string;
  created_at: string;
  committed: number;
  description?: string;
}

// Chat table row
export interface ChatRow {
  id: string;
  telegram_chat_id: string;
  vault_id: string | null;
}
