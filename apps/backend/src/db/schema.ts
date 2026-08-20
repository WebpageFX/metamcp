import { OAuthClientInformation } from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  McpServerErrorStatusEnum,
  McpServerStatusEnum,
  McpServerTypeEnum,
  UpstreamTokenResponse,
} from "@repo/zod-types";
import {
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

function toEnumTuple<T extends string>(options: readonly T[]): [T, ...T[]] {
  return options as unknown as [T, ...T[]];
}

const uuidPk = (name = "uuid") =>
  text(name)
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = (name = "created_at") =>
  integer(name, { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

const updatedAt = (name = "updated_at") =>
  integer(name, { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

export const mcpServersTable = sqliteTable(
  "mcp_servers",
  {
    uuid: uuidPk(),
    name: text("name").notNull(),
    description: text("description"),
    type: text("type", { enum: toEnumTuple(McpServerTypeEnum.options) })
      .notNull()
      .default(McpServerTypeEnum.enum.STDIO),
    command: text("command"),
    args: text("args", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    env: text("env", { mode: "json" })
      .$type<{ [key: string]: string }>()
      .notNull()
      .default({}),
    url: text("url"),
    error_status: text("error_status", {
      enum: toEnumTuple(McpServerErrorStatusEnum.options),
    })
      .notNull()
      .default(McpServerErrorStatusEnum.enum.NONE),
    created_at: createdAt(),
    bearerToken: text("bearer_token"),
    headers: text("headers", { mode: "json" })
      .$type<{ [key: string]: string }>()
      .notNull()
      .default({}),
    forward_headers: text("forward_headers", { mode: "json" })
      .$type<{ [key: string]: string }>()
      .notNull()
      .default({}),
    user_id: text("user_id").references(() => usersTable.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    index("mcp_servers_type_idx").on(table.type),
    index("mcp_servers_user_id_idx").on(table.user_id),
    index("mcp_servers_error_status_idx").on(table.error_status),
    unique("mcp_servers_name_user_unique_idx").on(table.name, table.user_id),
  ],
);

export const oauthSessionsTable = sqliteTable(
  "oauth_sessions",
  {
    uuid: uuidPk(),
    mcp_server_uuid: text("mcp_server_uuid")
      .notNull()
      .references(() => mcpServersTable.uuid, { onDelete: "cascade" }),
    client_information: text("client_information", { mode: "json" })
      .$type<OAuthClientInformation>()
      .notNull()
      .default({} as OAuthClientInformation),
    tokens: text("tokens", { mode: "json" }).$type<UpstreamTokenResponse>(),
    code_verifier: text("code_verifier"),
    expected_state: text("expected_state"),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (table) => [
    index("oauth_sessions_mcp_server_uuid_idx").on(table.mcp_server_uuid),
    unique("oauth_sessions_unique_per_server_idx").on(table.mcp_server_uuid),
  ],
);

export const toolsTable = sqliteTable(
  "tools",
  {
    uuid: uuidPk(),
    name: text("name").notNull(),
    description: text("description"),
    toolSchema: text("tool_schema", { mode: "json" })
      .$type<{
        type: "object";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        properties?: Record<string, any>;
        required?: string[];
      }>()
      .notNull(),
    created_at: createdAt(),
    updated_at: updatedAt(),
    mcp_server_uuid: text("mcp_server_uuid")
      .notNull()
      .references(() => mcpServersTable.uuid, { onDelete: "cascade" }),
  },
  (table) => [
    index("tools_mcp_server_uuid_idx").on(table.mcp_server_uuid),
    unique("tools_unique_tool_name_per_server_idx").on(
      table.mcp_server_uuid,
      table.name,
    ),
  ],
);

export const usersTable = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: createdAt("created_at"),
  updatedAt: updatedAt("updated_at"),
});

export const sessionsTable = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: createdAt("created_at"),
  updatedAt: updatedAt("updated_at"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
});

export const accountsTable = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: createdAt("created_at"),
  updatedAt: updatedAt("updated_at"),
});

export const verificationsTable = sqliteTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: createdAt("created_at"),
  updatedAt: updatedAt("updated_at"),
});

export const namespacesTable = sqliteTable(
  "namespaces",
  {
    uuid: uuidPk(),
    name: text("name").notNull(),
    description: text("description"),
    created_at: createdAt(),
    updated_at: updatedAt(),
    user_id: text("user_id").references(() => usersTable.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    index("namespaces_user_id_idx").on(table.user_id),
    unique("namespaces_name_user_unique_idx").on(table.name, table.user_id),
  ],
);

export const endpointsTable = sqliteTable(
  "endpoints",
  {
    uuid: uuidPk(),
    name: text("name").notNull(),
    description: text("description"),
    namespace_uuid: text("namespace_uuid")
      .notNull()
      .references(() => namespacesTable.uuid, { onDelete: "cascade" }),
    enable_api_key_auth: integer("enable_api_key_auth", { mode: "boolean" })
      .notNull()
      .default(true),
    enable_oauth: integer("enable_oauth", { mode: "boolean" })
      .notNull()
      .default(false),
    enable_max_rate: integer("enable_max_rate", { mode: "boolean" })
      .notNull()
      .default(false),
    enable_client_max_rate: integer("enable_client_max_rate", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    max_rate: integer("max_rate"),
    max_rate_seconds: integer("max_rate_seconds"),
    client_max_rate: integer("client_max_rate"),
    client_max_rate_seconds: integer("client_max_rate_seconds"),
    client_max_rate_strategy: text("client_max_rate_strategy"),
    client_max_rate_strategy_key: text("client_max_rate_strategy_key"),
    use_query_param_auth: integer("use_query_param_auth", { mode: "boolean" })
      .notNull()
      .default(false),
    enable_metamcp_admin_tools: integer("enable_metamcp_admin_tools", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    created_at: createdAt(),
    updated_at: updatedAt(),
    user_id: text("user_id").references(() => usersTable.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    index("endpoints_namespace_uuid_idx").on(table.namespace_uuid),
    index("endpoints_user_id_idx").on(table.user_id),
    unique("endpoints_name_unique").on(table.name),
  ],
);

export const namespaceServerMappingsTable = sqliteTable(
  "namespace_server_mappings",
  {
    uuid: uuidPk(),
    namespace_uuid: text("namespace_uuid")
      .notNull()
      .references(() => namespacesTable.uuid, { onDelete: "cascade" }),
    mcp_server_uuid: text("mcp_server_uuid")
      .notNull()
      .references(() => mcpServersTable.uuid, { onDelete: "cascade" }),
    status: text("status", {
      enum: toEnumTuple(McpServerStatusEnum.options),
    })
      .notNull()
      .default(McpServerStatusEnum.enum.ACTIVE),
    created_at: createdAt(),
  },
  (table) => [
    index("namespace_server_mappings_namespace_uuid_idx").on(
      table.namespace_uuid,
    ),
    index("namespace_server_mappings_mcp_server_uuid_idx").on(
      table.mcp_server_uuid,
    ),
    index("namespace_server_mappings_status_idx").on(table.status),
    unique("namespace_server_mappings_unique_idx").on(
      table.namespace_uuid,
      table.mcp_server_uuid,
    ),
  ],
);

export const namespaceToolMappingsTable = sqliteTable(
  "namespace_tool_mappings",
  {
    uuid: uuidPk(),
    namespace_uuid: text("namespace_uuid")
      .notNull()
      .references(() => namespacesTable.uuid, { onDelete: "cascade" }),
    tool_uuid: text("tool_uuid")
      .notNull()
      .references(() => toolsTable.uuid, { onDelete: "cascade" }),
    mcp_server_uuid: text("mcp_server_uuid")
      .notNull()
      .references(() => mcpServersTable.uuid, { onDelete: "cascade" }),
    status: text("status", {
      enum: toEnumTuple(McpServerStatusEnum.options),
    })
      .notNull()
      .default(McpServerStatusEnum.enum.ACTIVE),
    override_name: text("override_name"),
    override_title: text("override_title"),
    override_description: text("override_description"),
    override_annotations: text("override_annotations", {
      mode: "json",
    }).$type<Record<string, unknown> | null>(),
    created_at: createdAt(),
  },
  (table) => [
    index("namespace_tool_mappings_namespace_uuid_idx").on(
      table.namespace_uuid,
    ),
    index("namespace_tool_mappings_tool_uuid_idx").on(table.tool_uuid),
    index("namespace_tool_mappings_mcp_server_uuid_idx").on(
      table.mcp_server_uuid,
    ),
    index("namespace_tool_mappings_status_idx").on(table.status),
    unique("namespace_tool_mappings_unique_idx").on(
      table.namespace_uuid,
      table.tool_uuid,
    ),
  ],
);

export const apiKeysTable = sqliteTable(
  "api_keys",
  {
    uuid: uuidPk(),
    name: text("name").notNull(),
    key: text("key").notNull().unique(),
    user_id: text("user_id").references(() => usersTable.id, {
      onDelete: "cascade",
    }),
    created_at: createdAt(),
    is_active: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [
    index("api_keys_user_id_idx").on(table.user_id),
    index("api_keys_key_idx").on(table.key),
    index("api_keys_is_active_idx").on(table.is_active),
    unique("api_keys_name_per_user_idx").on(table.user_id, table.name),
  ],
);

export const mcpRequestAuditLogsTable = sqliteTable(
  "mcp_request_audit_logs",
  {
    uuid: uuidPk(),
    endpoint_name: text("endpoint_name").notNull(),
    namespace_uuid: text("namespace_uuid").references(
      () => namespacesTable.uuid,
      {
        onDelete: "set null",
      },
    ),
    session_id: text("session_id").notNull(),
    auth_method: text("auth_method").notNull(),
    api_key_uuid: text("api_key_uuid").references(() => apiKeysTable.uuid, {
      onDelete: "set null",
    }),
    api_key_user_id: text("api_key_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    oauth_user_id: text("oauth_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    mcp_server_uuid: text("mcp_server_uuid").references(
      () => mcpServersTable.uuid,
      {
        onDelete: "set null",
      },
    ),
    mcp_server_name: text("mcp_server_name"),
    tool_name: text("tool_name").notNull(),
    status: text("status", { enum: ["SUCCESS", "ERROR"] }).notNull(),
    duration_ms: integer("duration_ms").notNull(),
    error_message: text("error_message"),
    created_at: createdAt(),
  },
  (table) => [
    index("mcp_request_audit_logs_created_at_idx").on(table.created_at),
    index("mcp_request_audit_logs_endpoint_name_idx").on(table.endpoint_name),
    index("mcp_request_audit_logs_namespace_uuid_idx").on(table.namespace_uuid),
    index("mcp_request_audit_logs_session_id_idx").on(table.session_id),
    index("mcp_request_audit_logs_api_key_uuid_idx").on(table.api_key_uuid),
    index("mcp_request_audit_logs_api_key_user_id_idx").on(
      table.api_key_user_id,
    ),
    index("mcp_request_audit_logs_oauth_user_id_idx").on(table.oauth_user_id),
    index("mcp_request_audit_logs_mcp_server_uuid_idx").on(
      table.mcp_server_uuid,
    ),
    index("mcp_request_audit_logs_mcp_server_name_idx").on(
      table.mcp_server_name,
    ),
    index("mcp_request_audit_logs_tool_name_idx").on(table.tool_name),
    index("mcp_request_audit_logs_status_idx").on(table.status),
    index("mcp_request_audit_logs_api_key_user_created_at_idx").on(
      table.api_key_user_id,
      table.created_at,
    ),
    index("mcp_request_audit_logs_oauth_user_created_at_idx").on(
      table.oauth_user_id,
      table.created_at,
    ),
    index("mcp_request_audit_logs_api_key_created_at_idx").on(
      table.api_key_uuid,
      table.created_at,
    ),
    index("mcp_request_audit_logs_namespace_created_at_idx").on(
      table.namespace_uuid,
      table.created_at,
    ),
    index("mcp_request_audit_logs_status_created_at_idx").on(
      table.status,
      table.created_at,
    ),
  ],
);

export const configTable = sqliteTable("config", {
  id: text("id").primaryKey(),
  value: text("value").notNull(),
  description: text("description"),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const oauthClientsTable = sqliteTable("oauth_clients", {
  client_id: text("client_id").primaryKey(),
  client_secret: text("client_secret"),
  client_name: text("client_name").notNull(),
  redirect_uris: text("redirect_uris", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  grant_types: text("grant_types", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(["authorization_code", "refresh_token"]),
  response_types: text("response_types", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(["code"]),
  token_endpoint_auth_method: text("token_endpoint_auth_method")
    .notNull()
    .default("none"),
  scope: text("scope").default("admin"),
  client_uri: text("client_uri"),
  logo_uri: text("logo_uri"),
  contacts: text("contacts", { mode: "json" }).$type<string[] | null>(),
  tos_uri: text("tos_uri"),
  policy_uri: text("policy_uri"),
  software_id: text("software_id"),
  software_version: text("software_version"),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const oauthAuthorizationCodesTable = sqliteTable(
  "oauth_authorization_codes",
  {
    code: text("code").primaryKey(),
    client_id: text("client_id")
      .notNull()
      .references(() => oauthClientsTable.client_id, { onDelete: "cascade" }),
    redirect_uri: text("redirect_uri").notNull(),
    scope: text("scope").notNull().default("admin"),
    user_id: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    code_challenge: text("code_challenge"),
    code_challenge_method: text("code_challenge_method"),
    expires_at: integer("expires_at", { mode: "timestamp" }).notNull(),
    created_at: createdAt(),
  },
  (table) => [
    index("oauth_authorization_codes_client_id_idx").on(table.client_id),
    index("oauth_authorization_codes_user_id_idx").on(table.user_id),
    index("oauth_authorization_codes_expires_at_idx").on(table.expires_at),
  ],
);

export const oauthAccessTokensTable = sqliteTable(
  "oauth_access_tokens",
  {
    access_token: text("access_token").primaryKey(),
    client_id: text("client_id")
      .notNull()
      .references(() => oauthClientsTable.client_id, { onDelete: "cascade" }),
    user_id: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    scope: text("scope").notNull().default("admin"),
    expires_at: integer("expires_at", { mode: "timestamp" }).notNull(),
    refresh_token: text("refresh_token"),
    refresh_token_expires_at: integer("refresh_token_expires_at", {
      mode: "timestamp",
    }),
    created_at: createdAt(),
  },
  (table) => [
    index("oauth_access_tokens_client_id_idx").on(table.client_id),
    index("oauth_access_tokens_user_id_idx").on(table.user_id),
    index("oauth_access_tokens_expires_at_idx").on(table.expires_at),
    index("oauth_access_tokens_refresh_token_idx").on(table.refresh_token),
  ],
);
