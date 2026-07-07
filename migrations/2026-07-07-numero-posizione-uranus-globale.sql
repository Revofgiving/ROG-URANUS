-- MIGRATION PROPOSTA (NON ESEGUIRE FINO AD APPROVAZIONE)
-- Obiettivo: numero_posizione_uranus globale unico (0..N), idempotente e transazionale.
-- NOTE: scegliere UNO tra Scenario A e Scenario B.

BEGIN;

-- 1) Aggiunta colonna se assente
ALTER TABLE posizioni
  ADD COLUMN IF NOT EXISTS numero_posizione_uranus INTEGER;

-- 2) Se esiste la vecchia colonna numero_posizione, copia in numero_posizione_uranus
--    senza sovrascrivere valori già presenti (idempotente)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'posizioni' AND column_name = 'numero_posizione'
  ) THEN
    UPDATE posizioni
       SET numero_posizione_uranus = numero_posizione
     WHERE numero_posizione_uranus IS NULL
       AND numero_posizione IS NOT NULL;
  END IF;
END $$;

-- 3) Sequenza globale (parte da 0)
CREATE SEQUENCE IF NOT EXISTS seq_numero_posizione_uranus
  START WITH 0 INCREMENT BY 1 MINVALUE 0;

-- 4) Scenario A (PRESERVA numeri esistenti non duplicati)
--    - Identifica duplicati
--    - Mantiene il primo record per numero
--    - Azzerra i duplicati eccedenti
--    - Assegna nuovi numeri ai NULL
--
-- << SCENARIO A: ABILITARE SOLO SE APPROVATO >>
/*
WITH dup AS (
  SELECT numero_posizione_uranus
  FROM posizioni
  WHERE numero_posizione_uranus IS NOT NULL
  GROUP BY numero_posizione_uranus
  HAVING COUNT(*) > 1
),
ranked AS (
  SELECT p.id,
         ROW_NUMBER() OVER (
           PARTITION BY p.numero_posizione_uranus
           ORDER BY p.created_at ASC, p.id ASC
         ) AS rn
  FROM posizioni p
  WHERE p.numero_posizione_uranus IN (SELECT numero_posizione_uranus FROM dup)
)
UPDATE posizioni p
   SET numero_posizione_uranus = NULL
  FROM ranked r
 WHERE p.id = r.id
   AND r.rn > 1;

-- Allinea la sequenza al massimo esistente + 1
SELECT setval(
  'seq_numero_posizione_uranus',
  COALESCE((SELECT MAX(numero_posizione_uranus) FROM posizioni WHERE numero_posizione_uranus IS NOT NULL), -1) + 1,
  false
);

-- Assegna nuovi numeri ai NULL (sequenza atomica)
UPDATE posizioni
   SET numero_posizione_uranus = nextval('seq_numero_posizione_uranus')
 WHERE numero_posizione_uranus IS NULL;
*/

-- 5) Scenario B (RICOSTRUISCE tutta la numerazione in ordine cronologico)
--    - Assegna numero 0..N secondo created_at, id
--
-- << SCENARIO B: ABILITARE SOLO SE APPROVATO >>
/*
WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) - 1 AS new_num
  FROM posizioni
)
UPDATE posizioni p
   SET numero_posizione_uranus = o.new_num
  FROM ordered o
 WHERE p.id = o.id;

SELECT setval(
  'seq_numero_posizione_uranus',
  COALESCE((SELECT MAX(numero_posizione_uranus) FROM posizioni), -1) + 1,
  false
);
*/

-- 6) Vincolo univoco NON parziale (da applicare solo dopo la numerazione completa)
--    Nota: se esiste già un indice/constraint parziale, rimuoverlo manualmente prima.
-- ALTER TABLE posizioni
--   ADD CONSTRAINT posizioni_numero_posizione_uranus_key UNIQUE (numero_posizione_uranus);

-- 7) NOT NULL solo dopo valorizzazione completa
-- ALTER TABLE posizioni
--   ALTER COLUMN numero_posizione_uranus SET NOT NULL;

COMMIT;
