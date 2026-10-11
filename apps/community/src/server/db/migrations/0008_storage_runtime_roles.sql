CREATE TABLE "storage_runtime_roles" (
	"role" text PRIMARY KEY NOT NULL,
	"process_id" uuid NOT NULL,
	"backend_pid" integer NOT NULL,
	"heartbeat_at" timestamp with time zone NOT NULL,
	"pause_owner" uuid,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "storage_runtime_roles_role_check" CHECK ("storage_runtime_roles"."role" in ('web','media','control')),
	CONSTRAINT "storage_runtime_roles_check" CHECK ("storage_runtime_roles"."acknowledged_at" is null or "storage_runtime_roles"."pause_owner" is not null)
);
