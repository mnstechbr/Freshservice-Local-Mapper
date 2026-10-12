-- Migration de dados (auditoria H1). Remove a demonstração legada: seed anterior à versão 2, com
-- chaves de módulo sem ponto (service_catalog, knowledge_base, ...), conexão "connected" e contagens erradas.
-- Só toca instâncias com is_demo = 1: somente o seed grava essa flag, então são dados fictícios.
-- Instâncias reais não são alteradas. A cascata leva connections, sync_runs, resources, versões,
-- observações, diferenças, api_modules e resource_relations. O usuário recria a demo pela UI.
DELETE FROM `app_settings` WHERE `key` = 'active_instance_id' AND CAST(`value` AS INTEGER) IN (SELECT `id` FROM `instances` WHERE `is_demo` = 1);
--> statement-breakpoint
DELETE FROM `audit_events` WHERE `instance_id` IN (SELECT `id` FROM `instances` WHERE `is_demo` = 1);
--> statement-breakpoint
DELETE FROM `instances` WHERE `is_demo` = 1;
