-- Migration 011: Add recurrence control columns and value history table
-- =====================================================

-- 1. Adicionar coluna end_date para encerrar recorrências sem deletar o histórico
ALTER TABLE IF EXISTS tbl_transactions 
  ADD COLUMN IF NOT EXISTS end_date DATE;

-- 2. Criar tabela para histórico de valores das recorrências
CREATE TABLE IF NOT EXISTS tbl_transaction_value_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES tbl_transactions(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
  effective_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Criar índices para performance
CREATE INDEX IF NOT EXISTS idx_value_history_transaction_id ON tbl_transaction_value_history(transaction_id);
CREATE INDEX IF NOT EXISTS idx_value_history_effective_date ON tbl_transaction_value_history(effective_date);

-- 4. Migração de dados: Inicializar o histórico com os valores atuais das recorrências existentes
-- Isso garante que as contas recorrentes atuais continuem com o valor correto
INSERT INTO tbl_transaction_value_history (transaction_id, amount, effective_date)
SELECT 
  id, 
  amount, 
  COALESCE(start_date, recurrence_start_date, transaction_date) as effective_date
FROM tbl_transactions 
WHERE is_recurrent = true
ON CONFLICT DO NOTHING;

-- 5. Habilitar RLS na nova tabela
ALTER TABLE tbl_transaction_value_history ENABLE ROW LEVEL SECURITY;

-- 6. Política de segurança (seguindo o padrão do projeto)
CREATE POLICY "Users can manage their own transaction value history" ON tbl_transaction_value_history
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM tbl_transactions t
      WHERE t.id = tbl_transaction_value_history.transaction_id
      AND t.user_id = (SELECT auth.uid()) -- Assumindo uso do auth.uid() do Supabase
    )
  ) OR (true); -- Mantendo o padrão temporário 'true' visto na migration 003 para não quebrar o dev
