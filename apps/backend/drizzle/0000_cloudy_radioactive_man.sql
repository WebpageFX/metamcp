CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`uuid` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`key` text NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_unique` ON `api_keys` (`key`);--> statement-breakpoint
CREATE INDEX `api_keys_user_id_idx` ON `api_keys` (`user_id`);--> statement-breakpoint
CREATE INDEX `api_keys_key_idx` ON `api_keys` (`key`);--> statement-breakpoint
CREATE INDEX `api_keys_is_active_idx` ON `api_keys` (`is_active`);--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_name_per_user_idx` ON `api_keys` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `config` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `endpoints` (
	`uuid` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`namespace_uuid` text NOT NULL,
	`enable_api_key_auth` integer DEFAULT true NOT NULL,
	`enable_oauth` integer DEFAULT false NOT NULL,
	`enable_max_rate` integer DEFAULT false NOT NULL,
	`enable_client_max_rate` integer DEFAULT false NOT NULL,
	`max_rate` integer,
	`max_rate_seconds` integer,
	`client_max_rate` integer,
	`client_max_rate_seconds` integer,
	`client_max_rate_strategy` text,
	`client_max_rate_strategy_key` text,
	`use_query_param_auth` integer DEFAULT false NOT NULL,
	`enable_metamcp_admin_tools` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` text,
	FOREIGN KEY (`namespace_uuid`) REFERENCES `namespaces`(`uuid`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `endpoints_namespace_uuid_idx` ON `endpoints` (`namespace_uuid`);--> statement-breakpoint
CREATE INDEX `endpoints_user_id_idx` ON `endpoints` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `endpoints_name_unique` ON `endpoints` (`name`);--> statement-breakpoint
CREATE TABLE `mcp_request_audit_logs` (
	`uuid` text PRIMARY KEY NOT NULL,
	`endpoint_name` text NOT NULL,
	`namespace_uuid` text,
	`session_id` text NOT NULL,
	`auth_method` text NOT NULL,
	`api_key_uuid` text,
	`api_key_user_id` text,
	`oauth_user_id` text,
	`mcp_server_uuid` text,
	`mcp_server_name` text,
	`tool_name` text NOT NULL,
	`status` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`namespace_uuid`) REFERENCES `namespaces`(`uuid`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`api_key_uuid`) REFERENCES `api_keys`(`uuid`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`api_key_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`oauth_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`mcp_server_uuid`) REFERENCES `mcp_servers`(`uuid`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `mcp_request_audit_logs_created_at_idx` ON `mcp_request_audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `mcp_request_audit_logs_endpoint_name_idx` ON `mcp_request_audit_logs` (`endpoint_name`);--> statement-breakpoint
CREATE INDEX `mcp_request_audit_logs_namespace_uuid_idx` ON `mcp_request_audit_logs` (`namespace_uuid`);--> statement-breakpoint
CREATE INDEX `mcp_request_audit_logs_session_id_idx` ON `mcp_request_audit_logs` (`session_id`);--> statement-breakpoint
CREATE INDEX `mcp_request_audit_logs_api_key_uuid_idx` ON `mcp_request_audit_logs` (`api_key_uuid`);--> statement-breakpoint
CREATE INDEX `mcp_request_audit_logs_api_key_user_id_idx` ON `mcp_request_audit_logs` (`api_key_user_id`);--> statement-breakpoint
CREATE INDEX `mcp_request_audit_logs_oauth_user_id_idx` ON `mcp_request_audit_logs` (`oauth_user_id`);--> statement-breakpoint
CREATE INDEX `mcp_request_audit_logs_mcp_server_uuid_idx` ON `mcp_request_audit_logs` (`mcp_server_uuid`);--> statement-breakpoint
CREATE INDEX `mcp_request_audit_logs_mcp_server_name_idx` ON `mcp_request_audit_logs` (`mcp_server_name`);--> statement-breakpoint
CREATE INDEX `mcp_request_audit_logs_tool_name_idx` ON `mcp_request_audit_logs` (`tool_name`);--> statement-breakpoint
CREATE INDEX `mcp_request_audit_logs_status_idx` ON `mcp_request_audit_logs` (`status`);--> statement-breakpoint
CREATE INDEX `mcp_request_audit_logs_api_key_user_created_at_idx` ON `mcp_request_audit_logs` (`api_key_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `mcp_request_audit_logs_oauth_user_created_at_idx` ON `mcp_request_audit_logs` (`oauth_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `mcp_request_audit_logs_api_key_created_at_idx` ON `mcp_request_audit_logs` (`api_key_uuid`,`created_at`);--> statement-breakpoint
CREATE INDEX `mcp_request_audit_logs_namespace_created_at_idx` ON `mcp_request_audit_logs` (`namespace_uuid`,`created_at`);--> statement-breakpoint
CREATE INDEX `mcp_request_audit_logs_status_created_at_idx` ON `mcp_request_audit_logs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `mcp_servers` (
	`uuid` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`type` text DEFAULT 'STDIO' NOT NULL,
	`command` text,
	`args` text DEFAULT '[]' NOT NULL,
	`env` text DEFAULT '{}' NOT NULL,
	`url` text,
	`error_status` text DEFAULT 'NONE' NOT NULL,
	`created_at` integer NOT NULL,
	`bearer_token` text,
	`headers` text DEFAULT '{}' NOT NULL,
	`forward_headers` text DEFAULT '{}' NOT NULL,
	`user_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mcp_servers_type_idx` ON `mcp_servers` (`type`);--> statement-breakpoint
CREATE INDEX `mcp_servers_user_id_idx` ON `mcp_servers` (`user_id`);--> statement-breakpoint
CREATE INDEX `mcp_servers_error_status_idx` ON `mcp_servers` (`error_status`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_servers_name_user_unique_idx` ON `mcp_servers` (`name`,`user_id`);--> statement-breakpoint
CREATE TABLE `namespace_server_mappings` (
	`uuid` text PRIMARY KEY NOT NULL,
	`namespace_uuid` text NOT NULL,
	`mcp_server_uuid` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`namespace_uuid`) REFERENCES `namespaces`(`uuid`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mcp_server_uuid`) REFERENCES `mcp_servers`(`uuid`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `namespace_server_mappings_namespace_uuid_idx` ON `namespace_server_mappings` (`namespace_uuid`);--> statement-breakpoint
CREATE INDEX `namespace_server_mappings_mcp_server_uuid_idx` ON `namespace_server_mappings` (`mcp_server_uuid`);--> statement-breakpoint
CREATE INDEX `namespace_server_mappings_status_idx` ON `namespace_server_mappings` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `namespace_server_mappings_unique_idx` ON `namespace_server_mappings` (`namespace_uuid`,`mcp_server_uuid`);--> statement-breakpoint
CREATE TABLE `namespace_tool_mappings` (
	`uuid` text PRIMARY KEY NOT NULL,
	`namespace_uuid` text NOT NULL,
	`tool_uuid` text NOT NULL,
	`mcp_server_uuid` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`override_name` text,
	`override_title` text,
	`override_description` text,
	`override_annotations` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`namespace_uuid`) REFERENCES `namespaces`(`uuid`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tool_uuid`) REFERENCES `tools`(`uuid`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mcp_server_uuid`) REFERENCES `mcp_servers`(`uuid`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `namespace_tool_mappings_namespace_uuid_idx` ON `namespace_tool_mappings` (`namespace_uuid`);--> statement-breakpoint
CREATE INDEX `namespace_tool_mappings_tool_uuid_idx` ON `namespace_tool_mappings` (`tool_uuid`);--> statement-breakpoint
CREATE INDEX `namespace_tool_mappings_mcp_server_uuid_idx` ON `namespace_tool_mappings` (`mcp_server_uuid`);--> statement-breakpoint
CREATE INDEX `namespace_tool_mappings_status_idx` ON `namespace_tool_mappings` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `namespace_tool_mappings_unique_idx` ON `namespace_tool_mappings` (`namespace_uuid`,`tool_uuid`);--> statement-breakpoint
CREATE TABLE `namespaces` (
	`uuid` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `namespaces_user_id_idx` ON `namespaces` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `namespaces_name_user_unique_idx` ON `namespaces` (`name`,`user_id`);--> statement-breakpoint
CREATE TABLE `oauth_access_tokens` (
	`access_token` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`scope` text DEFAULT 'admin' NOT NULL,
	`expires_at` integer NOT NULL,
	`refresh_token` text,
	`refresh_token_expires_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_client_id_idx` ON `oauth_access_tokens` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_user_id_idx` ON `oauth_access_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_expires_at_idx` ON `oauth_access_tokens` (`expires_at`);--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_refresh_token_idx` ON `oauth_access_tokens` (`refresh_token`);--> statement-breakpoint
CREATE TABLE `oauth_authorization_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`scope` text DEFAULT 'admin' NOT NULL,
	`user_id` text NOT NULL,
	`code_challenge` text,
	`code_challenge_method` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_authorization_codes_client_id_idx` ON `oauth_authorization_codes` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_authorization_codes_user_id_idx` ON `oauth_authorization_codes` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauth_authorization_codes_expires_at_idx` ON `oauth_authorization_codes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`client_id` text PRIMARY KEY NOT NULL,
	`client_secret` text,
	`client_name` text NOT NULL,
	`redirect_uris` text DEFAULT '[]' NOT NULL,
	`grant_types` text DEFAULT '["authorization_code","refresh_token"]' NOT NULL,
	`response_types` text DEFAULT '["code"]' NOT NULL,
	`token_endpoint_auth_method` text DEFAULT 'none' NOT NULL,
	`scope` text DEFAULT 'admin',
	`client_uri` text,
	`logo_uri` text,
	`contacts` text,
	`tos_uri` text,
	`policy_uri` text,
	`software_id` text,
	`software_version` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_sessions` (
	`uuid` text PRIMARY KEY NOT NULL,
	`mcp_server_uuid` text NOT NULL,
	`client_information` text DEFAULT '{}' NOT NULL,
	`tokens` text,
	`code_verifier` text,
	`expected_state` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`mcp_server_uuid`) REFERENCES `mcp_servers`(`uuid`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_sessions_mcp_server_uuid_idx` ON `oauth_sessions` (`mcp_server_uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_sessions_unique_per_server_idx` ON `oauth_sessions` (`mcp_server_uuid`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE TABLE `tools` (
	`uuid` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`tool_schema` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`mcp_server_uuid` text NOT NULL,
	FOREIGN KEY (`mcp_server_uuid`) REFERENCES `mcp_servers`(`uuid`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tools_mcp_server_uuid_idx` ON `tools` (`mcp_server_uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `tools_unique_tool_name_per_server_idx` ON `tools` (`mcp_server_uuid`,`name`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
